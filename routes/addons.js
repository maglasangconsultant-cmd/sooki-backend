import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';
import AddOn from '../models/AddOn.js';
import User from '../models/User.js';

const router = express.Router();

// Simple JWT auth middleware (aligns with existing token structure)
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing Authorization header' });
  }
  const token = authHeader.replace('Bearer ', '').trim();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(payload.userId || payload.id || payload._id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    req.user = user;
    req.userId = user._id;
    if (user.sellerInfo && user.sellerInfo.sellerId) {
      req.sellerId = user.sellerInfo.sellerId;
    }
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

// Cloudinary storage for add-on images
const addOnImageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'sooki/addons',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 600, height: 600, crop: 'fill', quality: 'auto' }]
  }
});

const uploadAddOnImage = multer({ storage: addOnImageStorage });

// List add-ons for the authenticated seller
router.get('/', authenticate, async (req, res) => {
  try {
    const addOns = await AddOn.find({ sellerId: req.sellerId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, addOns });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create add-on (supports image file or URL)
router.post('/', authenticate, uploadAddOnImage.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, maxQuantity, isActive, image: imageUrlFromBody } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ success: false, error: 'Name and price are required' });
    }

    const imageUrl = req.file?.path || imageUrlFromBody || '';
    const addOn = new AddOn({
      sellerId: req.sellerId,
      name: name.trim(),
      description: description || '',
      price: parseFloat(price),
      category: category || 'general',
      maxQuantity: maxQuantity ? parseInt(maxQuantity) : 1,
      isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true,
      image: imageUrl
    });
    const saved = await addOn.save();
    res.status(201).json({ success: true, addOn: saved });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update add-on
router.put('/:id', authenticate, uploadAddOnImage.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await AddOn.findById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Add-on not found' });
    if (existing.sellerId.toString() !== req.userId.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this add-on' });
    }

    const { name, description, price, category, maxQuantity, isActive, image: imageUrlFromBody } = req.body;
    const update = {};
    if (name) update.name = name.trim();
    if (description !== undefined) update.description = description;
    if (price !== undefined) update.price = parseFloat(price);
    if (category) update.category = category;
    if (maxQuantity !== undefined) update.maxQuantity = parseInt(maxQuantity);
    if (isActive !== undefined) update.isActive = isActive === 'true' || isActive === true;
    if (req.file?.path || imageUrlFromBody) update.image = req.file?.path || imageUrlFromBody;

    const saved = await AddOn.findByIdAndUpdate(id, update, { new: true });
    res.status(200).json({ success: true, addOn: saved });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete add-on
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await AddOn.findById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Add-on not found' });
    if (existing.sellerId.toString() !== req.userId.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this add-on' });
    }
    await AddOn.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: 'Add-on deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle active state
router.patch('/:id/toggle', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await AddOn.findById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Add-on not found' });
    if (existing.sellerId.toString() !== req.userId.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this add-on' });
    }
    existing.isActive = !existing.isActive;
    await existing.save();
    res.status(200).json({ success: true, addOn: existing });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;