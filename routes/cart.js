import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Cart from '../models/Cart.js';
import { JWT_SECRET } from '../config/authConfig.js';

const router = express.Router();

// Simple JWT auth middleware (customer tokens)
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.split(' ')[1];
  const payload = jwt.verify(token, JWT_SECRET);
    // Common payload shapes: userId, id, _id
    req.userId = payload.userId || payload.id || payload._id;
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Invalid token payload' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Unauthorized', error: err.message });
  }
}

// POST /api/cart/sync
router.post('/sync', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { items } = req.body || {};

    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Invalid payload: items must be an array' });
    }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    for (const item of items) {
      const rawProductId = item?.product?._id || item?.product;
      if (!rawProductId) continue;

      let productId;
      try {
        productId = new mongoose.Types.ObjectId(rawProductId);
      } catch {
        continue; // skip invalid id
      }

      const existingItem = cart.items.find(
        (i) => i.product.toString() === productId.toString()
      );

      const quantity = Number(item?.quantity || 1);
      const unitPrice = Number(item?.unitPrice || 0);

      if (existingItem) {
        existingItem.quantity += quantity > 0 ? quantity : 0;
        existingItem.unitPrice = unitPrice || existingItem.unitPrice || 0;
        existingItem.totalPrice = (existingItem.unitPrice || 0) * (existingItem.quantity || 0);
      } else {
        cart.items.push({
          product: productId,
          quantity: quantity > 0 ? quantity : 1,
          unitPrice,
          totalPrice: unitPrice * (quantity > 0 ? quantity : 1)
        });
      }
    }

    await cart.save();
    return res.json({ success: true, cart });
  } catch (error) {
    console.error('Cart sync error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;