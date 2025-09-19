import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cloudinary from './config/cloudinary.js';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// Load environment variables
dotenv.config();

// ---------- Environment Variable Validation ----------
if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI environment variable is required');
  process.exit(1);
}

// Validate that we're connecting to the correct database
const mongoUri = process.env.MONGO_URI;
if (!mongoUri.includes('sookiDB')) {
  console.error('❌ Database connection must point to sookiDB');
  console.error('Current URI:', mongoUri);
  process.exit(1);
}

// Prevent connection to test or sample databases
const forbiddenDatabases = ['test', 'sample', 'mflix', 'demo'];
const hasInvalidDb = forbiddenDatabases.some(db => mongoUri.toLowerCase().includes(db.toLowerCase()));
if (hasInvalidDb) {
  console.error('❌ Connection to test/sample databases is not allowed');
  console.error('Forbidden databases:', forbiddenDatabases.join(', '));
  process.exit(1);
}

console.log('✅ Environment variables validated');
console.log('🔗 Connecting to:', mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials in logs

// ---------- MongoDB Connection ----------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas (sookiDB)');
    console.log('🗄️  Using database: sookiDB');
    console.log('📊 Real-time monitoring enabled for collections: users, products, orders');
  })
  .catch(err => console.error('❌ Connection error:', err));

// Enable real-time monitoring for database operations
mongoose.set('debug', (collectionName, method, query, doc) => {
  console.log(`🔍 [${new Date().toISOString()}] ${collectionName}.${method}`, 
    JSON.stringify(query), doc ? JSON.stringify(doc) : '');
});

// ---------- Models ----------
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  firstName: String,
  lastName: String,
  phone: String,
  dateOfBirth: { type: Date },
  userType: { type: String, enum: ['buyer', 'seller'] },
  isVerified: { type: Boolean, default: false },
  // Seller-specific fields
  sellerInfo: {
    phoneNumber: String,
    shopName: String,
    shopAddress: String,
    bankDetails: String,
    categories: [String],
    bio: String,
    registrationDate: Date,
  }
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, index: true },
  description: String,
  price: Number,
  originalPrice: Number,
  discount: Number,
  category: { 
    _id: { type: String, index: true }, 
    name: String, 
    slug: String 
  },
  seller: { 
    _id: String, 
    businessName: String, 
    rating: Number, 
    totalReviews: Number 
  },
  images: [String],
  stock: Number,
  rating: Number,
  totalReviews: Number,
  tags: [String],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  orderNumber: String,
  userId: { type: String, index: true },
  status: String,
  items: [{
    product: { _id: String, name: String },
    quantity: Number,
    unitPrice: Number,
    totalPrice: Number
  }],
  summary: {
    subtotal: Number,
    shippingFee: Number,
    tax: Number,
    discount: Number,
    total: Number
  },
  shippingAddress: {
    firstName: String,
    lastName: String,
    phone: String,
    address: String,
    city: String,
    province: String,
    postalCode: String,
    country: String
  },
  paymentMethod: String,
  paymentStatus: String,
  transactionId: String,
  trackingNumber: String,
  deliveredAt: Date
}, { timestamps: true });

const photoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', index: true }, // Optional - for product photos
  url: { type: String, required: true }, // CDN, S3, or local storage URL
  uploadedAt: { type: Date, default: Date.now, index: true },
  status: { 
    type: String, 
    enum: ['active', 'deleted', 'flagged'], 
    default: 'active',
    index: true 
  },
  deletedAt: { type: Date }, // Only set when status = 'deleted'
  notes: { type: String } // For helpdesk remarks
}, { timestamps: true });

// Index for efficient queries
photoSchema.index({ userId: 1, status: 1 });
photoSchema.index({ productId: 1, status: 1 });
photoSchema.index({ uploadedAt: -1 });

const User = mongoose.model('User', userSchema);
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Photo = mongoose.model('Photo', photoSchema);

// ---------- Express Setup ----------
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  
  // Join user to their personal room for order updates
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`👤 User ${userId} joined their room`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// Make io available globally for order updates
global.io = io;

// Create uploads directory if it doesn't exist
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Configure multer for Cloudinary uploads
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'sooki_uploads',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

const upload = multer({ storage: storage });

// ---------- Endpoints ----------

// ---------- Analytics Collection ----------
import Analytics from './models/Analytics.js';

// Analytics helper function to log unique events
async function logAnalyticsEvent(eventType, userId, data = {}) {
  try {
    // Check if similar event exists in last 5 minutes to avoid duplicates
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingEvent = await Analytics.findOne({
      eventType,
      userId,
      createdAt: { $gte: fiveMinutesAgo },
      'data.productId': data.productId // For product-specific events
    });

    if (!existingEvent) {
      await Analytics.create({
        eventType,
        userId,
        data,
        createdAt: new Date()
      });
    }
  } catch (err) {
    console.error('Analytics logging error:', err.message);
  }
}

// ---------- Debug/Verification Endpoints ----------
app.get('/debug/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).limit(20);
    
    res.json({
      success: true,
      database: mongoose.connection.name,
      connectionState: mongoose.connection.readyState,
      totalUsers: users.length,
      users: users.map(user => ({
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug/user/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const user = await User.findOne({ email });
    
    if (user) {
      res.json({
        success: true,
        found: true,
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          sellerInfo: user.sellerInfo
        }
      });
    } else {
      res.json({
        success: true,
        found: false,
        message: 'User not found'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth endpoints
app.post('/auth/register', async (req, res) => {
  try {
    console.log('🔄 [REGISTRATION] Starting user registration process...');
    console.log('📊 [DATABASE] Using database: sookiDB');
    console.log('📊 [DATABASE] Target collection: users');
    console.log('🔍 [DEBUG] Request body received:', req.body);
    
    const { email, firstName, lastName, phone, userType, dateOfBirth } = req.body;
    console.log('🔍 [DEBUG] Extracted dateOfBirth:', dateOfBirth);
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('❌ [REGISTRATION] User already exists:', email);
      return res.status(400).json({ error: 'User already exists with this email' });
    }
    
    // Create new user
    const user = new User({
      email,
      firstName,
      lastName,
      phone,
      userType: userType || 'buyer',
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined
    });
    
    // Save to sookiDB.users collection
    const savedUser = await user.save();
    
    // Enhanced logging for database operations
    console.log('✅ [REGISTRATION] User successfully saved to sookiDB.users');
    console.log('👤 [USER REGISTRATION] New user registered:', {
      timestamp: new Date().toISOString(),
      userId: savedUser._id,
      email: savedUser.email,
      name: `${savedUser.firstName} ${savedUser.lastName}`,
      userType: savedUser.userType,
      phone: savedUser.phone,
      dateOfBirth: savedUser.dateOfBirth,
      database: 'sookiDB',
      collection: 'users',
      mongooseConnection: mongoose.connection.name
    });
    
    // Verify the user was actually saved by querying it back
    const verifyUser = await User.findById(savedUser._id);
    if (verifyUser) {
      console.log('✅ [VERIFICATION] User confirmed in sookiDB.users collection');
    } else {
      console.log('❌ [VERIFICATION] User not found after save - potential DB issue');
    }
    
    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully',
      data: {
        user: {
          _id: savedUser._id,
          email: savedUser.email,
          firstName: savedUser.firstName,
          lastName: savedUser.lastName,
          phone: savedUser.phone,
          userType: savedUser.userType,
          dateOfBirth: savedUser.dateOfBirth
        }
      }
    });
  } catch (err) {
    console.log('❌ [REGISTRATION ERROR] Database insert failed:', err.message);
    console.log('❌ [DATABASE ERROR] Full error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Registration failed: ' + err.message 
    });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('Login attempt:', { email, password: password ? '[PROVIDED]' : '[MISSING]' });
    
    // Find user by email
    const user = await User.findOne({ email });
    console.log('User found:', user ? 'YES' : 'NO');
    
    if (!user) {
      console.log('Login failed: User not found for email:', email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // For now, we'll accept any password (in production, you'd verify hashed password)
    console.log('Login successful for:', email);
    res.json({ 
      success: true,
      message: 'Login successful',
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType
      }
    });
  } catch (err) {
    console.log('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all users
app.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register as seller endpoint
app.post('/auth/register-seller', async (req, res) => {
  try {
    const { email, sellerData } = req.body;
    
    console.log('Seller registration attempt for email:', email);
    console.log('Seller data:', sellerData);
    
    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('User not found for seller registration:', email);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update user type to seller and add seller info
    user.userType = 'seller';
    user.sellerInfo = {
      phoneNumber: sellerData?.phoneNumber || '',
      shopName: sellerData?.shopName || '',
      shopAddress: sellerData?.shopAddress || '',
      bankDetails: sellerData?.bankDetails || '',
      categories: sellerData?.categories || [],
      bio: sellerData?.bio || '',
      registrationDate: new Date(),
    };
    
    await user.save();
    
    console.log('User successfully registered as seller:', email);
    console.log('Updated user:', user);
    
    res.json({ 
      success: true,
      message: 'Successfully registered as seller',
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        sellerInfo: user.sellerInfo
      }
    });
  } catch (err) {
    console.log('Seller registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all products
app.get('/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new product
app.post('/products', upload.single('image'), async (req, res) => {
  try {
    console.log('🛍️ Received product data:', JSON.stringify(req.body, null, 2));
    console.log('📸 Received file:', req.file);
    
    // Parse JSON fields from multipart form data
    const productData = {
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      stock: parseInt(req.body.stock),
      category: req.body.category ? JSON.parse(req.body.category) : null,
      seller: req.body.seller ? JSON.parse(req.body.seller) : null
    };
    
    // Validate required fields
    if (!productData.name || productData.name.trim() === '') {
      return res.status(400).json({ error: 'Product name is required' });
    }
    
    if (!productData.price || productData.price <= 0) {
      return res.status(400).json({ error: 'Valid price is required' });
    }
    
    // Handle image upload
    let images = [];
    if (req.file) {
      const imageUrl = req.file.path; // Cloudinary URL
      images = [imageUrl];
    }

    // Create new product
    const product = new Product({
      name: productData.name.trim(),
      description: productData.description || '',
      price: productData.price,
      originalPrice: productData.originalPrice || productData.price,
      discount: productData.discount || 0,
      category: productData.category || {
        _id: 'general',
        name: 'General',
        slug: 'general'
      },
      seller: productData.seller || {
        _id: 'default_seller',
        businessName: 'Sooki Seller',
        rating: 4.5,
        totalReviews: 0
      },
      images: images,
      stock: productData.stock || 0,
      rating: productData.rating || 0,
      totalReviews: productData.totalReviews || 0,
      tags: productData.tags || [],
      isActive: productData.isActive !== undefined ? productData.isActive : true
    });

    const savedProduct = await product.save();

    // Create Photo document for manage photos section
    if (req.file && productData.seller && productData.seller._id) {
      try {
        console.log('🔍 [PHOTO DEBUG] Creating photo document with data:', {
          userId: productData.seller._id,
          productId: savedProduct._id,
          url: req.file.path,
          hasFile: !!req.file,
          hasSeller: !!productData.seller,
          hasUserId: !!productData.seller._id
        });
        
        const photo = new Photo({
          userId: new mongoose.Types.ObjectId(productData.seller._id),
          productId: savedProduct._id,
          url: req.file.path, // Cloudinary URL
          status: 'active'
        });
        
        const savedPhoto = await photo.save();
        
        console.log('📸 [PHOTO CREATED] Photo document created successfully:', {
          photoId: savedPhoto._id,
          productId: savedProduct._id,
          userId: productData.seller._id,
          url: req.file.path,
          savedPhotoData: savedPhoto
        });
      } catch (photoErr) {
        console.error('⚠️ [PHOTO ERROR] Failed to create photo document:', {
          error: photoErr.message,
          stack: photoErr.stack,
          userId: productData.seller._id,
          productId: savedProduct._id,
          url: req.file?.path
        });
        // Don't fail the product creation if photo document creation fails
      }
    } else {
      console.log('⚠️ [PHOTO SKIP] Skipping photo creation:', {
        hasFile: !!req.file,
        hasSeller: !!productData.seller,
        hasUserId: !!productData.seller?._id,
        fileData: req.file ? { path: req.file.path, filename: req.file.filename } : null
      });
    }
    
    console.log('📦 [PRODUCT CREATED] New product added:', {
      timestamp: new Date().toISOString(),
      productId: savedProduct._id,
      name: savedProduct.name,
      price: savedProduct.price,
      stock: savedProduct.stock,
      database: 'sookiDB',
      collection: 'products'
    });
    
    res.status(201).json({
      message: 'Product created successfully',
      product: savedProduct
    });
    
  } catch (err) {
    console.error('❌ Product creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete a product
app.delete('/products/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    console.log(`🗑️ [PRODUCT DELETE] Deleting product: ${productId}`);
    
    // Find the product first
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Delete all photos associated with this product
    const deletedPhotos = await Photo.deleteMany({ productId: productId });
    console.log(`📸 [PHOTOS DELETED] Removed ${deletedPhotos.deletedCount} photos for product ${productId}`);
    
    // Delete the product
    await Product.findByIdAndDelete(productId);
    
    console.log('✅ [PRODUCT DELETED] Product and associated photos removed:', {
      timestamp: new Date().toISOString(),
      productId: productId,
      productName: product.name,
      photosDeleted: deletedPhotos.deletedCount,
      database: 'sookiDB'
    });
    
    res.json({
      success: true,
      message: 'Product and associated photos deleted successfully',
      deletedPhotos: deletedPhotos.deletedCount
    });
    
  } catch (err) {
    console.error('❌ [PRODUCT DELETE ERROR] Failed to delete product:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Get all orders
app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new order
app.post('/orders', async (req, res) => {
  try {
    console.log('📦 Received order data:', JSON.stringify(req.body, null, 2));
    
    const { userId, items, status } = req.body;
    
    // Validate required fields
    if (!userId || userId.trim() === '') {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required and must not be empty' });
    }
    
    // Validate items structure
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.productId && !item.product) {
        return res.status(400).json({ error: `Item ${i + 1}: productId or product is required` });
      }
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: `Item ${i + 1}: quantity must be greater than 0` });
      }
      if (!item.price && !item.unitPrice) {
        return res.status(400).json({ error: `Item ${i + 1}: price or unitPrice is required` });
      }
    }
    
    // Calculate total on backend
    const calculatedTotal = req.body.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    
    // Transform items to match schema structure
    const transformedItems = items.map(item => ({
      product: {
        _id: item.productId || item.product?._id,
        name: item.name || item.product?.name || 'Unknown Product'
      },
      quantity: item.quantity,
      unitPrice: item.price || item.unitPrice,
      totalPrice: (item.price || item.unitPrice) * item.quantity
    }));

    // Create order with calculated total and default status
    const orderData = {
      userId,
      items: transformedItems,
      status: status || 'pending',
      summary: {
        subtotal: calculatedTotal,
        shippingFee: 0,
        tax: 0,
        discount: 0,
        total: calculatedTotal
      }
    };
    
    const order = new Order(orderData);
    const savedOrder = await order.save();
    
    // Automatic stock decrement after order confirmation
    for (const item of transformedItems) {
      try {
        const productId = item.product._id;
        const quantity = item.quantity;
        
        // Update product stock atomically
        const updatedProduct = await Product.findByIdAndUpdate(
          productId,
          { $inc: { stock: -quantity } },
          { new: true }
        );
        
        if (updatedProduct) {
          console.log(`📦 [INVENTORY UPDATE] Stock decremented for product ${productId}: ${updatedProduct.stock} remaining`);
          
          // Log analytics event for inventory change
          await logAnalyticsEvent('order_placed', userId, {
            productId,
            quantityOrdered: quantity,
            remainingStock: updatedProduct.stock,
            orderValue: item.totalPrice
          });
        }
      } catch (stockError) {
        console.error(`❌ [INVENTORY ERROR] Failed to update stock for product ${item.product._id}:`, stockError.message);
      }
    }
    
    // Enhanced real-time monitoring log for order creation
    console.log('🛒 [ORDER TRANSACTION] New order created:', {
      timestamp: new Date().toISOString(),
      orderId: savedOrder._id,
      userId: savedOrder.userId,
      itemCount: savedOrder.items?.length || 0,
      total: savedOrder.summary?.total,
      status: savedOrder.status,
      database: 'sookiDB',
      collection: 'orders',
      items: savedOrder.items.map(item => ({
        productId: item.product._id,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice
      }))
    });
    
    console.log('✅ Order saved successfully to sookiDB.orders');
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: {
        _id: savedOrder._id,
        userId: savedOrder.userId,
        items: savedOrder.items,
        total: savedOrder.summary?.total,
        status: savedOrder.status,
        createdAt: savedOrder.createdAt,
        updatedAt: savedOrder.updatedAt
      }
    });
  } catch (err) {
    console.error('❌ Error creating order:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Seller Dashboard Analytics Endpoints ----------

// Get seller analytics overview
app.get('/seller/analytics/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    // Get seller's products
    const products = await Product.find({ 'seller._id': sellerId });
    const productIds = products.map(p => p._id);
    
    // Get orders containing seller's products
    const orders = await Order.find({
      'items.product._id': { $in: productIds },
      status: { $ne: 'cancelled' }
    });
    
    // Calculate analytics
    const totalRevenue = orders.reduce((sum, order) => {
      const sellerItems = order.items.filter(item => 
        productIds.some(pid => pid.toString() === item.product._id.toString())
      );
      return sum + sellerItems.reduce((itemSum, item) => itemSum + item.totalPrice, 0);
    }, 0);
    
    const totalOrders = orders.length;
    const totalProducts = products.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    // Get sales data for chart (last 7 days)
    const salesData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const dayOrders = orders.filter(order => {
        const orderDate = new Date(order.createdAt);
        return orderDate >= date && orderDate < nextDate;
      });
      
      const dayRevenue = dayOrders.reduce((sum, order) => {
        const sellerItems = order.items.filter(item => 
          productIds.some(pid => pid.toString() === item.product._id.toString())
        );
        return sum + sellerItems.reduce((itemSum, item) => itemSum + item.totalPrice, 0);
      }, 0);
      
      salesData.push({ day: i, revenue: dayRevenue });
    }
    
    res.json({
      totalRevenue,
      totalOrders,
      totalProducts,
      averageOrderValue,
      salesData
    });
    
  } catch (err) {
    console.error('❌ Error fetching seller analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get seller's top performing products
app.get('/seller/top-products/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    // Get seller's products
    const products = await Product.find({ 'seller._id': sellerId });
    const productIds = products.map(p => p._id);
    
    // Get orders containing seller's products
    const orders = await Order.find({
      'items.product._id': { $in: productIds },
      status: { $ne: 'cancelled' }
    });
    
    // Calculate product performance
    const productStats = {};
    
    orders.forEach(order => {
      order.items.forEach(item => {
        if (productIds.some(pid => pid.toString() === item.product._id.toString())) {
          const productId = item.product._id.toString();
          if (!productStats[productId]) {
            productStats[productId] = {
              name: item.product.name,
              sales: 0,
              revenue: 0
            };
          }
          productStats[productId].sales += item.quantity;
          productStats[productId].revenue += item.totalPrice;
        }
      });
    });
    
    // Convert to array and sort by revenue
    const topProducts = Object.values(productStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(product => ({
        ...product,
        trend: 'up' // Simplified - could be calculated based on time periods
      }));
    
    res.json(topProducts);
    
  } catch (err) {
    console.error('❌ Error fetching top products:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get seller's inventory with low stock alerts
app.get('/seller/inventory/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    console.log('🔍 Looking for products with seller._id:', sellerId);
    const products = await Product.find({ 'seller._id': sellerId });
    console.log('📦 Found products:', products.length);
    
    const inventory = products.map(product => ({
      _id: product._id,
      name: product.name,
      stock: product.stock || 0,
      lowStock: (product.stock || 0) < 10, // Consider low stock if less than 10
      reorderPoint: 10,
      price: product.price
    }));
    
    res.json(inventory);
    
  } catch (err) {
    console.error('❌ Error fetching inventory:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Adjust inventory (add or subtract stock)
app.put('/seller/inventory/:productId/adjust', async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, isAdding } = req.body;
    
    // Validate input
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Quantity must be a positive number' 
      });
    }
    
    if (typeof isAdding !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        message: 'isAdding must be a boolean value' 
      });
    }
    
    console.log(`📦 [INVENTORY ADJUST] ${isAdding ? 'Adding' : 'Removing'} ${quantity} units for product ${productId}`);
    
    // Find the product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }
    
    // Calculate new stock
    const currentStock = product.stock || 0;
    let newStock;
    
    if (isAdding) {
      newStock = currentStock + quantity;
    } else {
      // Check if we have enough stock to remove
      if (currentStock < quantity) {
        return res.status(400).json({ 
          success: false, 
          message: `Cannot remove ${quantity} units. Only ${currentStock} units available.` 
        });
      }
      newStock = currentStock - quantity;
    }
    
    // Update the product stock
    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      { stock: newStock },
      { new: true }
    );
    
    console.log(`📦 [INVENTORY ADJUST] Stock ${isAdding ? 'increased' : 'decreased'} for product ${productId}: ${currentStock} → ${newStock}`);
    
    // Log analytics event for inventory adjustment
    try {
      await Analytics.create({
        event: 'inventory_adjustment',
        productId: productId,
        sellerId: product.seller._id,
        data: {
          action: isAdding ? 'add' : 'subtract',
          quantity: quantity,
          previousStock: currentStock,
          newStock: newStock,
          timestamp: new Date()
        }
      });
    } catch (analyticsError) {
      console.error('❌ Failed to log inventory adjustment analytics:', analyticsError.message);
    }
    
    res.json({
      success: true,
      message: `Successfully ${isAdding ? 'added' : 'removed'} ${quantity} units`,
      product: {
        _id: updatedProduct._id,
        name: updatedProduct.name,
        stock: updatedProduct.stock,
        previousStock: currentStock
      }
    });
    
  } catch (err) {
    console.error('❌ Error adjusting inventory:', err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get seller's orders (both endpoints for compatibility)
app.get('/seller/orders/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    // Get seller's products
    const products = await Product.find({ 'seller._id': sellerId });
    const productIds = products.map(p => p._id);
    
    // Get orders containing seller's products
    const orders = await Order.find({
      'items.product._id': { $in: productIds }
    }).sort({ createdAt: -1 });
    
    // Transform orders to include only seller's items
    const sellerOrders = orders.map(order => {
      const sellerItems = order.items.filter(item => 
        productIds.some(pid => pid.toString() === item.product._id.toString())
      );
      
      const sellerTotal = sellerItems.reduce((sum, item) => sum + item.totalPrice, 0);
      
      return {
        id: `#ORD${order._id.toString().slice(-6).toUpperCase()}`,
        _id: order._id,
        customer: order.userId, // In real app, you'd populate user details
        amount: sellerTotal,
        status: order.status,
        date: order.createdAt.toISOString().split('T')[0],
        items: sellerItems
      };
    });
    
    res.json({
      success: true,
      orders: sellerOrders
    });
    
  } catch (err) {
    console.error('❌ Error fetching seller orders:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Alternative endpoint for frontend compatibility
app.get('/orders/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    // Get seller's products
    const products = await Product.find({ 'seller._id': sellerId });
    const productIds = products.map(p => p._id);
    
    // Get orders containing seller's products
    const orders = await Order.find({
      'items.product._id': { $in: productIds }
    }).sort({ createdAt: -1 });
    
    // Transform orders to include only seller's items
    const sellerOrders = orders.map(order => {
      const sellerItems = order.items.filter(item => 
        productIds.some(pid => pid.toString() === item.product._id.toString())
      );
      
      const sellerTotal = sellerItems.reduce((sum, item) => sum + item.totalPrice, 0);
      
      return {
        id: `#ORD${order._id.toString().slice(-6).toUpperCase()}`,
        _id: order._id,
        customer: order.userId, // In real app, you'd populate user details
        amount: sellerTotal,
        status: order.status,
        date: order.createdAt.toISOString().split('T')[0],
        items: sellerItems
      };
    });
    
    res.json({
      success: true,
      orders: sellerOrders
    });
    
  } catch (err) {
    console.error('❌ Error fetching seller orders:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get user's order history
app.get('/user/orders/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user's orders
    const orders = await Order.find({ userId: userId })
      .sort({ createdAt: -1 })
      .populate('items.product._id', 'name images price');
    
    // Transform orders for frontend
    const userOrders = orders.map(order => {
      return {
        _id: order._id,
        orderNumber: `#ORD${order._id.toString().slice(-6).toUpperCase()}`,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
        items: order.items.map(item => ({
          _id: item._id,
          product: {
            _id: item.product._id,
            name: item.product.name,
            images: item.product.images,
            price: item.product.price
          },
          quantity: item.quantity,
          price: item.price,
          totalPrice: item.totalPrice
        })),
        // Add flag to show if user can rate products in this order
        canRate: order.status === 'delivered' && order.deliveredAt,
        // Check if rating period is still valid (e.g., within 30 days of delivery)
        ratingDeadline: order.deliveredAt ? 
          new Date(order.deliveredAt.getTime() + (30 * 24 * 60 * 60 * 1000)) : null
      };
    });
    
    res.json({
      success: true,
      orders: userOrders
    });
    
  } catch (err) {
    console.error('❌ Error fetching user orders:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Update order status endpoint
app.put('/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, sellerId } = req.body;
    
    // Validate status
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Valid statuses: ' + validStatuses.join(', ')
      });
    }
    
    // Find and update the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    // Update status and delivery date if delivered
    order.status = status;
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }
    
    await order.save();
    
    // Emit real-time update to the user
    if (global.io) {
      global.io.to(`user_${order.userId}`).emit('orderStatusUpdate', {
        orderId: order._id,
        status: status,
        deliveredAt: order.deliveredAt,
        orderNumber: `#ORD${order._id.toString().slice(-6).toUpperCase()}`
      });
      
      console.log(`📡 Real-time update sent to user_${order.userId} for order ${orderId}`);
    }
    
    res.json({
      success: true,
      order: {
        _id: order._id,
        status: order.status,
        deliveredAt: order.deliveredAt,
        orderNumber: `#ORD${order._id.toString().slice(-6).toUpperCase()}`
      }
    });
    
  } catch (err) {
    console.error('❌ Error updating order status:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ---------- MongoDB Connection Debug Endpoints ----------
// Debug endpoint to check MongoDB connection details
app.get('/debug/connection', async (req, res) => {
  try {
    console.log('🔍 [DEBUG] Connection details requested');
    
    const mongoUri = process.env.MONGO_URI;
    const connectionType = mongoUri.includes('mongodb+srv://') ? 'Atlas' : 
                          mongoUri.includes('mongodb://localhost') ? 'Local' : 'Unknown';
    
    // Get user count
    const userCount = await User.countDocuments();
    
    // Get last 3 users
    const lastUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(3)
      .select('email firstName lastName userType createdAt updatedAt');
    
    const response = {
      success: true,
      connection: {
        uri: mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'), // Hide credentials
        type: connectionType,
        database: 'sookiDB',
        status: 'Connected'
      },
      users: {
        totalCount: userCount,
        lastThreeUsers: lastUsers
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ [DEBUG] Connection details:', JSON.stringify(response, null, 2));
    res.json(response);
    
  } catch (err) {
    console.error('❌ [DEBUG] Error getting connection details:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      connection: {
        uri: process.env.MONGO_URI ? process.env.MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : 'Not set',
        type: 'Error',
        status: 'Failed'
      }
    });
  }
});

// ---------- Photo Management Endpoints ----------

// Get all photos (for user's photo library)
app.get('/photos', async (req, res) => {
  try {
    const { userId, status = 'active', limit = 50 } = req.query;
    
    console.log(`📸 [PHOTO FETCH] Getting photos for user: ${userId}, status: ${status}`);
    
    // If no userId provided or invalid ObjectId, return empty result
    if (!userId) {
      return res.json({
        success: true,
        data: {
          count: 0,
          photos: []
        }
      });
    }
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.log(`⚠️ [PHOTO FETCH] Invalid userId format: ${userId}`);
      return res.json({
        success: true,
        data: {
          count: 0,
          photos: []
        }
      });
    }
    
    const photos = await Photo.find({ 
      userId: new mongoose.Types.ObjectId(userId),
      status: status 
    })
    .populate('productId', 'name')
    .sort({ uploadedAt: -1 })
    .limit(parseInt(limit));
    
    console.log(`🔍 [PHOTO FETCH] Found ${photos.length} photos for user ${userId}:`, 
      photos.map(p => ({ id: p._id, url: p.url, productId: p.productId }))
    );
    
    res.json({
      success: true,
      data: {
        count: photos.length,
        photos: photos
      }
    });
    
  } catch (err) {
    console.error('❌ [PHOTO FETCH] Error:', err.message);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// Upload photo endpoint
app.post('/photos/upload', upload.single('photo'), async (req, res) => {
  try {
    console.log('📸 [PHOTO UPLOAD] Starting photo upload process...');
    
    const { userId, productId, notes } = req.body;
    
    // Validate required fields
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Photo file is required' });
    }
    
    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // If productId provided, verify product exists and belongs to user (for sellers)
    if (productId) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      // For sellers, ensure they own the product
      if (user.userType === 'seller' && product.seller._id !== userId) {
        return res.status(403).json({ error: 'Not authorized to upload photo for this product' });
      }
    }
    
    // Create photo record
    const photoUrl = req.file.path; // Cloudinary URL
    const photo = new Photo({
      userId: userId,
      productId: productId || null,
      url: photoUrl,
      notes: notes || null
    });
    
    const savedPhoto = await photo.save();
    
    console.log('✅ [PHOTO UPLOAD] Photo successfully saved:', {
      photoId: savedPhoto._id,
      userId: userId,
      productId: productId || 'none',
      url: photoUrl,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      data: {
        photo: {
          _id: savedPhoto._id,
          userId: savedPhoto.userId,
          productId: savedPhoto.productId,
          url: savedPhoto.url,
          uploadedAt: savedPhoto.uploadedAt,
          status: savedPhoto.status,
          notes: savedPhoto.notes
        }
      }
    });
    
  } catch (err) {
    console.error('❌ [PHOTO UPLOAD] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get photos by user
app.get('/photos/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status = 'active', limit = 50 } = req.query;
    
    console.log(`📸 [PHOTO FETCH] Getting photos for user: ${userId}, status: ${status}`);
    
    const photos = await Photo.find({ 
      userId: userId,
      status: status 
    })
    .populate('productId', 'name')
    .sort({ uploadedAt: -1 })
    .limit(parseInt(limit));
    
    res.json({
      success: true,
      count: photos.length,
      photos: photos
    });
    
  } catch (err) {
    console.error('❌ [PHOTO FETCH] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get photos by product
app.get('/photos/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { status = 'active' } = req.query;
    
    console.log(`📸 [PHOTO FETCH] Getting photos for product: ${productId}, status: ${status}`);
    
    const photos = await Photo.find({ 
      productId: productId,
      status: status 
    })
    .populate('userId', 'firstName lastName email')
    .sort({ uploadedAt: -1 });
    
    res.json({
      success: true,
      count: photos.length,
      photos: photos
    });
    
  } catch (err) {
    console.error('❌ [PHOTO FETCH] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Soft delete photo (seller can delete their own photos)
app.patch('/photos/:photoId/delete', async (req, res) => {
  try {
    const { photoId } = req.params;
    const { notes } = req.body;
    const userId = req.headers['user-id']; // Get user ID from headers
    
    console.log(`🗑️ [PHOTO DELETE] Soft deleting photo: ${photoId} by user: ${userId}`);
    
    const photo = await Photo.findById(photoId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    // Check if user owns this photo (sellers can only delete their own photos)
    if (userId && photo.userId && photo.userId.toString() !== userId) {
      return res.status(403).json({ error: 'You can only delete your own photos' });
    }
    
    if (photo.status === 'deleted') {
      return res.status(400).json({ error: 'Photo already deleted' });
    }
    
    // Soft delete
    photo.status = 'deleted';
    photo.deletedAt = new Date();
    if (notes) {
      photo.notes = notes;
    }
    
    const updatedPhoto = await photo.save();
    
    console.log('✅ [PHOTO DELETE] Photo soft deleted:', {
      photoId: photoId,
      userId: userId,
      deletedAt: updatedPhoto.deletedAt,
      notes: notes || 'none'
    });
    
    res.json({
      success: true,
      message: 'Photo deleted successfully',
      photo: {
        _id: updatedPhoto._id,
        status: updatedPhoto.status,
        deletedAt: updatedPhoto.deletedAt,
        notes: updatedPhoto.notes
      }
    });
    
  } catch (err) {
    console.error('❌ [PHOTO DELETE] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Helpdesk Photo Management Endpoints ----------

// Get all photos for helpdesk (with filters)
app.get('/helpdesk/photos', async (req, res) => {
  try {
    const { 
      userId, 
      productId, 
      status, 
      limit = 100, 
      page = 1,
      sortBy = 'uploadedAt',
      sortOrder = 'desc'
    } = req.query;
    
    console.log('🎧 [HELPDESK] Fetching photos with filters:', req.query);
    
    // Build query
    const query = {};
    if (userId) query.userId = userId;
    if (productId) query.productId = productId;
    if (status) query.status = status;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const photos = await Photo.find(query)
      .populate('userId', 'firstName lastName email userType')
      .populate('productId', 'name')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));
    
    const totalCount = await Photo.countDocuments(query);
    
    res.json({
      success: true,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      },
      photos: photos
    });
    
  } catch (err) {
    console.error('❌ [HELPDESK] Error fetching photos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Flag photo for review (helpdesk function)
app.patch('/helpdesk/photos/:photoId/flag', async (req, res) => {
  try {
    const { photoId } = req.params;
    const { notes } = req.body;
    
    console.log(`🚩 [HELPDESK] Flagging photo: ${photoId}`);
    
    const photo = await Photo.findById(photoId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    photo.status = 'flagged';
    if (notes) {
      photo.notes = notes;
    }
    
    const updatedPhoto = await photo.save();
    
    console.log('✅ [HELPDESK] Photo flagged:', {
      photoId: photoId,
      notes: notes || 'none'
    });
    
    res.json({
      success: true,
      message: 'Photo flagged for review',
      photo: {
        _id: updatedPhoto._id,
        status: updatedPhoto.status,
        notes: updatedPhoto.notes
      }
    });
    
  } catch (err) {
    console.error('❌ [HELPDESK] Error flagging photo:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Restore photo (helpdesk function)
app.patch('/helpdesk/photos/:photoId/restore', async (req, res) => {
  try {
    const { photoId } = req.params;
    const { notes } = req.body;
    
    console.log(`🔄 [HELPDESK] Restoring photo: ${photoId}`);
    
    const photo = await Photo.findById(photoId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    photo.status = 'active';
    photo.deletedAt = null;
    if (notes) {
      photo.notes = notes;
    }
    
    const updatedPhoto = await photo.save();
    
    console.log('✅ [HELPDESK] Photo restored:', {
      photoId: photoId,
      notes: notes || 'none'
    });
    
    res.json({
      success: true,
      message: 'Photo restored successfully',
      photo: {
        _id: updatedPhoto._id,
        status: updatedPhoto.status,
        deletedAt: updatedPhoto.deletedAt,
        notes: updatedPhoto.notes
      }
    });
    
  } catch (err) {
    console.error('❌ [HELPDESK] Error restoring photo:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Reviews System ----------
import Review from './models/Review.js';

// Add a new review (only after purchase verification)
app.post('/reviews/add', async (req, res) => {
  try {
    const { productId, userId, rating, comment, userName, orderId } = req.body;
    
    // Validate required fields
    if (!productId || !userId || !rating || !comment) {
      return res.status(400).json({ error: 'All fields (productId, userId, rating, comment) are required' });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    // Check if user has purchased this product
    const hasPurchased = await Order.findOne({
      userId,
      'items.product._id': productId,
      status: { $in: ['completed', 'delivered'] }
    });
    
    if (!hasPurchased) {
      return res.status(403).json({ error: 'You can only review products you have purchased' });
    }
    
    // Check if user has already reviewed this product for this order (if orderId provided)
    if (orderId) {
      const existingReview = await Review.findOne({
        productId,
        userId,
        orderId
      });
      
      if (existingReview) {
        return res.status(400).json({ error: 'You have already reviewed this product for this order' });
      }
    }
    
    // Get user and product details
    const user = await User.findById(userId);
    const product = await Product.findById(productId);
    
    if (!user || !product) {
      return res.status(404).json({ error: 'User or product not found' });
    }
    
    // Create review
    const reviewData = {
      productId,
      userId,
      rating,
      comment,
      userName: userName || `${user.firstName} ${user.lastName}`,
      productName: product.name,
      verified: true,
      orderId: orderId || null
    };
    
    const review = new Review(reviewData);
    const savedReview = await review.save();
    
    // Log analytics event
    await logAnalyticsEvent('review_added', userId, {
      productId,
      rating,
      reviewId: savedReview._id,
      orderId: orderId || null
    });
    
    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      review: savedReview
    });
    
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'You have already reviewed this product' });
    }
    console.error('❌ Error adding review:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get reviews for a product
app.get('/reviews/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Get reviews with pagination
    const reviews = await Review.find({ productId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    // Get review statistics
    const stats = await Review.aggregate([
      { $match: { productId } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          ratingDistribution: {
            $push: '$rating'
          }
        }
      }
    ]);
    
    // Calculate rating distribution
    let ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (stats.length > 0) {
      stats[0].ratingDistribution.forEach(rating => {
        ratingCounts[rating]++;
      });
    }
    
    res.json({
      success: true,
      reviews,
      pagination: {
        page,
        limit,
        total: stats[0]?.totalReviews || 0
      },
      statistics: {
        totalReviews: stats[0]?.totalReviews || 0,
        averageRating: stats[0]?.averageRating || 0,
        ratingDistribution: ratingCounts
      }
    });
    
  } catch (err) {
    console.error('❌ Error fetching reviews:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get user's reviews
app.get('/reviews/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const reviews = await Review.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalReviews = await Review.countDocuments({ userId });
    
    res.json({
      success: true,
      reviews,
      pagination: {
        page,
        limit,
        total: totalReviews
      }
    });
    
  } catch (err) {
    console.error('❌ Error fetching user reviews:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ New endpoint using Cloudinary
app.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        url: req.file.path,
        public_id: req.file.filename
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API server running at http://0.0.0.0:${PORT}`);
  console.log(`📱 Mobile devices can connect to: http://192.168.1.x:${PORT}`);
  console.log(`💻 Local access: http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO enabled for real-time updates`);
});
