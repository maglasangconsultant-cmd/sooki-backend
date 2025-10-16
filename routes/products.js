import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Product from '../models/Product.js';
import AddOn from '../models/AddOn.js';
import cacheService from '../services/cacheService.js';
import analyticsService from '../services/analyticsService.js';
import abTestingService from '../services/abTestingService.js';

const router = express.Router();

// Simple JWT auth middleware used by product management endpoints
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

    // Attach user if available
    const userId = payload.userId || payload.id || payload._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Invalid token payload' });

    req.userId = userId;

    try {
      const user = await User.findById(userId).lean();
      if (user) {
        req.user = user;
        if (user.sellerInfo && user.sellerInfo.sellerId) {
          req.sellerId = user.sellerInfo.sellerId;
        }
      }
    } catch (e) {
      // non-fatal: proceed without full user lookup
      console.warn('products.authenticate: user lookup failed', e.message);
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Unauthorized', error: err.message });
  }
}

// Helpers
function isValidObjectId(id) {
  if (!id) return false;
  try {
    return mongoose.Types.ObjectId.isValid(id);
  } catch (e) {
    return false;
  }
}

function parsePositiveInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || Number.isNaN(n) || n <= 0) return fallback;
  return Math.floor(n);
}

// Configure Cloudinary storage for product images
const productImageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'sooki/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 800, height: 600, crop: 'fill', quality: 'auto' }
    ]
  }
});

const uploadProductImage = multer({ storage: productImageStorage });

// ===== GET ALL PRODUCTS =====
router.get('/', async (req, res) => {
  try {
    const { 
      category, 
      minPrice, 
      maxPrice, 
      seller, 
      tags, 
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Enforce pagination limits for performance
  const maxLimit = 50; // Maximum products per page
  const safeLimit = Math.min(parsePositiveInt(limit, 20), maxLimit);
  const safePage = Math.max(parsePositiveInt(page, 1), 1);

    // Generate cache key
    const cacheKey = cacheService.generateProductKey({
      page: safePage,
      limit: safeLimit,
      category,
      sellerId: seller,
      search: tags,
      sortBy,
      sortOrder
    });

    // Try to get from cache first
    const cachedResult = await cacheService.get(cacheKey);
    if (cachedResult) {
      console.log(`🚀 [CACHE HIT] Products served from cache: ${cacheKey}`);
      return res.status(200).json(cachedResult);
    }

    console.log(`💾 [CACHE MISS] Fetching products from database: ${cacheKey}`);

    // Build filter object
    const filter = { isActive: true };

    if (category) filter.categories = { $in: [category] };
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }
    // Accept seller only as an ObjectId (sellerId). Avoid ambiguous 'seller' payloads.
    if (seller && isValidObjectId(seller)) filter.sellerId = mongoose.Types.ObjectId(seller);
    if (tags) filter.tags = { $in: tags.split(',').map(t => t.trim().toLowerCase()) };

    // Build sort object
    // sanitize sortBy to an allow-list to avoid accidental or malicious sort fields
    const allowedSort = new Set(['createdAt', 'price', 'rating', 'totalReviews', 'name']);
    const sortField = allowedSort.has(sortBy) ? sortBy : 'createdAt';
    const sort = {};
    sort[sortField] = sortOrder === 'desc' ? -1 : 1;

    const products = await Product.find(filter)
      .sort(sort)
      .limit(safeLimit)
      .skip((safePage - 1) * safeLimit)
      .populate({
        path: 'sellerId',
        select: 'businessName rating totalReviews'
      })
      .lean();

    const total = await Product.countDocuments(filter);

    const result = {
      success: true,
      products,
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalProducts: total,
        hasNext: safePage < Math.ceil(total / safeLimit),
        hasPrev: safePage > 1,
        limit: safeLimit,
        maxLimit: maxLimit
      },
      hints: {
        filters: "Use category, price range, seller, or tags to filter products, boss! 🔍",
        sorting: "Sort by price, rating, or date. Default is newest first! 📊",
        pagination: `Showing max ${maxLimit} products per page for optimal performance! 🚀`
      }
    };

    // Track product search/browse analytics
    await analyticsService.trackEvent({
      eventType: 'product_search',
      userId: req.user?.id || null,
      sessionId: req.sessionID || req.headers['x-session-id'],
      metadata: {
        category,
        searchQuery: tags,
        resultsCount: products.length,
        totalResults: total,
        page: safePage,
        sortBy: sortField,
        sortOrder,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      }
    });

    // Cache the result for 5 minutes
    await cacheService.set(cacheKey, result, 300);
    console.log(`💾 [CACHED] Products cached with key: ${cacheKey}`);

    res.status(200).json(result);

  } catch (error) {
    console.error('❌ [GET PRODUCTS ERROR]:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch products, boss! 😅", 
      error: error.message 
    });
  }
});

// ===== GET SINGLE PRODUCT WITH ADD-ONS =====
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Generate cache key for single product
    const cacheKey = cacheService.generateSingleProductKey(id);
    
    // Try to get from cache first
    const cachedResult = await cacheService.get(cacheKey);
    if (cachedResult) {
      console.log(`🚀 [CACHE HIT] Single product served from cache: ${id}`);
      return res.status(200).json(cachedResult);
    }
    

    
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id' });
    }

    const product = await Product.findById(id)
      .populate({
        path: 'addOns',
        match: { isActive: true },
        select: 'name price image maxQuantity category description'
      })
      .populate({
        path: 'relatedProducts',
        match: { isActive: true },
        select: 'name price images rating totalReviews'
      })
      .populate({
        path: 'sellerId',
        model: 'Seller',
        select: 'businessName rating totalReviews contactInfo'
      });



    if (!product || !product.isActive) {
      return res.status(404).json({ 
        success: false,
        message: "Product not found or inactive, boss! 🤔"
      });
    }

    // Get A/B testing configuration for displayAddOns
    const abConfig = await abTestingService.getDisplayAddOnsConfig(
      id,
      req.user?.id || null,
      req.sessionID || req.headers['x-session-id'],
      {
        category: product.categories?.[0],
        segment: req.user?.segment || 'anonymous'
      }
    );

    // Apply A/B testing logic to displayAddOns
    let displayAddOns;
    let displayType;

    if (abConfig.algorithm === 'revenue_first' && product.addOns && product.addOns.length > 0) {
      // Sort add-ons by price (revenue optimization)
      displayAddOns = product.addOns
        .sort((a, b) => b.price - a.price)
        .slice(0, abConfig.maxAddOns || 4);
      displayType = 'addon';
    } else if (abConfig.algorithm === 'popularity_first' && product.addOns && product.addOns.length > 0) {
      // Sort by popularity (would need popularity field in real implementation)
      displayAddOns = product.addOns.slice(0, abConfig.maxAddOns || 4);
      displayType = 'addon';
    } else if (product.addOns && product.addOns.length > 0) {
      // Default hybrid approach
      displayAddOns = product.addOns.slice(0, abConfig.maxAddOns || 4);
      displayType = 'addon';
    } else if (abConfig.showRelatedProducts && product.relatedProducts && product.relatedProducts.length > 0) {
      // Fallback to related products
      displayAddOns = product.relatedProducts.slice(0, abConfig.maxAddOns || 4);
      displayType = 'related_product';
    } else {
      displayAddOns = [];
      displayType = 'fallback';
    }



    const result = {
      success: true,
      product,
      displayAddOns,
      abTestInfo: {
        variant: abConfig.variant,
        algorithm: abConfig.algorithm,
        displayType
      },
      hints: {
        addOns: displayAddOns.length > 0 && displayType === 'addon'
          ? "Add-ons available! Let your customers customize 🧑‍🍳"
          : displayAddOns.length > 0 && displayType === 'related_product'
          ? "No add-ons? Displaying related products as ads 🛍️"
          : "No add-ons or related products available 🤷‍♂️",
        seller: "Contact seller for custom requests or bulk orders! 📞"
      }
    };

    // Cache the result for 10 minutes (single products change less frequently)
    await cacheService.set(cacheKey, result, 600);
    console.log(`💾 [CACHED] Single product cached: ${id}`);

    res.status(200).json(result);

  } catch (error) {
    console.error('❌ [PRODUCT FETCH ERROR]:', error);
    console.error('❌ [PRODUCT FETCH ERROR STACK]:', error.stack);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch product, boss! 😅',
      error: error.message
    });
  }
});

// ===== CREATE PRODUCT =====
router.post('/', authenticate, uploadProductImage.array('images', 5), async (req, res) => {
  try {
    console.log('🛍️ [CREATE PRODUCT] Received data:', JSON.stringify(req.body, null, 2));
    console.log('📸 [CREATE PRODUCT] Received files:', req.files);

    const { 
      name, 
      description, 
      price, 
      originalPrice,
      stock, 
      categories, 
      addOns, 
      relatedProducts,
      tags
    } = req.body;

    // Validation
    if (!req.sellerId || !name || price == null) {
      return res.status(400).json({ 
        success: false,
        message: "Fill seller, name, and price, boss 😅" 
      });
    }

    // Handle image uploads
    let images = [];
    if (req.files && req.files.length > 0) {
      images = req.files.map(file => file.path);
    }

    // Parse arrays if they come as strings
    const parsedCategories = typeof categories === 'string' 
      ? categories.split(',').map(c => c.trim()) 
      : categories || [];
    
    const parsedTags = typeof tags === 'string' 
      ? tags.split(',').map(t => t.trim().toLowerCase()) 
      : tags || [];

    const parsedAddOns = typeof addOns === 'string' 
      ? addOns.split(',').filter(id => id.trim()) 
      : addOns || [];

    const parsedRelatedProducts = typeof relatedProducts === 'string' 
      ? relatedProducts.split(',').filter(id => id.trim()) 
      : relatedProducts || [];

    // ensure sellerId exists on request (set by auth middleware)
    if (!req.sellerId || !isValidObjectId(req.sellerId)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing sellerId' });
    }

    const product = new Product({
      sellerId: mongoose.Types.ObjectId(req.sellerId),
      name: name.trim(),
      description: description || "",
      price: parseFloat(price),
      originalPrice: originalPrice ? parseFloat(originalPrice) : undefined,
      stock: stock ? parseInt(stock) : 0,
      images,
      categories: parsedCategories,
      addOns: parsedAddOns,
      relatedProducts: parsedRelatedProducts,
      tags: parsedTags,
      isActive: true
    });

    const savedProduct = await product.save();

    // Invalidate product caches after creating new product
    await cacheService.invalidateProductCaches(null, req.sellerId);


    // Populate the saved product for response
    const populatedProduct = await Product.findById(savedProduct._id)
      .populate({
        path: 'addOns',
        match: { isActive: true },
        select: 'name price'
      })
      .populate({
        path: 'sellerId',
        select: 'businessName'
      });

    return res.status(201).json({
      success: true,
      message: "Product registered successfully! 🎉",
      product: populatedProduct,
      hints: {
        addOns: "Tip boss: Add-ons help boost sales. No add-ons? Show related products as ads! 🚀",
        images: "Upload multiple images to showcase your product better! 📸",
        seo: "Use relevant tags and categories for better discoverability! 🔍"
      }
    });

  } catch (error) {
    console.error("❌ [CREATE PRODUCT ERROR]:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server error 😱", 
      error: error.message 
    });
  }
});

// ===== UPDATE PRODUCT =====
router.put('/:id', uploadProductImage.array('images', 5), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Handle new image uploads
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => file.path);
      updateData.images = updateData.images 
        ? [...updateData.images, ...newImages] 
        : newImages;
    }

    // Parse arrays if they come as strings
    if (typeof updateData.categories === 'string') {
      updateData.categories = updateData.categories.split(',').map(c => c.trim());
    }
    if (typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags.split(',').map(t => t.trim().toLowerCase());
    }

    // Prevent updating immutable fields via this endpoint
    const forbidden = ['sellerId', '_id', 'createdAt', 'updatedAt'];
    forbidden.forEach(f => delete updateData[f]);

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate({
      path: 'sellerId',
      select: 'businessName'
    }).lean();

    if (!updatedProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found, boss! 🤔"
      });
    }

    // Invalidate product caches after updating
    await cacheService.invalidateProductCaches(id, updatedProduct.sellerId);
    console.log(`🗑️ [CACHE INVALIDATED] Product caches cleared for product: ${id}`);

    res.status(200).json({
      success: true,
      message: "Product updated successfully! ✨",
      product: updatedProduct,
      hints: {
        optimization: "Keep your product info fresh for better sales! 📈"
      }
    });

  } catch (error) {
    console.error("❌ [UPDATE PRODUCT ERROR]:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update product, boss! 😅",
      error: error.message
    });
  }
});

// ===== DELETE PRODUCT (SOFT DELETE) =====
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found, boss! 🤔"
      });
    }

    // Invalidate product caches after soft delete
    await cacheService.invalidateProductCaches(id, product.sellerId);
    console.log(`🗑️ [CACHE INVALIDATED] Product caches cleared for deleted product: ${id}`);

    res.status(200).json({
      success: true,
      message: "Product deactivated successfully! 🗑️",
      hints: {
        recovery: "Product is soft-deleted. Contact admin to restore if needed! 🔄"
      }
    });

  } catch (error) {
    console.error("❌ [DELETE PRODUCT ERROR]:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete product, boss! 😅",
      error: error.message
    });
  }
});

// ===== GET PRODUCTS BY SELLER =====
router.get('/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { page = 1, limit = 10, includeInactive = false } = req.query;

    // Enforce pagination limits for seller products
    const maxLimit = 30; // Lower limit for seller-specific queries
    const safeLimit = Math.min(parseInt(limit), maxLimit);
    const safePage = Math.max(parseInt(page), 1);



    const filter = { sellerId };
    if (!includeInactive) filter.isActive = true;

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .skip((safePage - 1) * safeLimit)
      .populate({
        path: 'addOns',
        match: { isActive: true },
        select: 'name price'
      })
      .lean();

    const total = await Product.countDocuments(filter);

    const result = {
      success: true,
      products,
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalProducts: total,
        limit: safeLimit,
        maxLimit: maxLimit
      },
      hints: {
        management: "Manage your products efficiently, boss! 📊",
        pagination: `Showing max ${maxLimit} products per page for seller dashboard! 🏪`
      }
    };



    res.status(200).json(result);

  } catch (error) {
    console.error("❌ [GET SELLER PRODUCTS ERROR]:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch seller products, boss! 😅",
      error: error.message
    });
  }
});

export default router;