import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Driver from '../models/Driver.js';
import { LaundryOrder } from '../models/LaundryModels.js';
import { JWT_SECRET } from '../config/authConfig.js';
// Defer resolving the Order model until runtime to avoid import-time MissingSchemaError
function getOrderModel() {
  return mongoose.models.Order || mongoose.model('Order');
}

const router = express.Router();

// Simple auth middleware for drivers
function authenticateDriver(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
  const decoded = jwt.verify(token, JWT_SECRET);
    req.driverId = decoded.driverId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

// Register driver
router.post('/register', async (req, res) => {
  try {
    const { email, firstName, lastName, phone, password, vehicleType, plateNumber, licenseNumber } = req.body;
    const existing = await Driver.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Driver already exists' });

    const driver = new Driver({ email, firstName, lastName, phone, password, vehicleType, plateNumber, licenseNumber });
    const saved = await driver.save();
    res.status(201).json({
      success: true,
      message: 'Driver registered successfully',
      data: { driver: { _id: saved._id, email: saved.email, firstName: saved.firstName, lastName: saved.lastName, status: saved.status } }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Login driver
router.post('/login', async (req, res) => {
  try {
    let email, password;
    if (req.body && typeof req.body === 'object') {
      ({ email, password } = req.body);
    } else if (req.is('application/json')) {
      try {
        const buffers = [];
        for await (const chunk of req) buffers.push(chunk);
        const raw = Buffer.concat(buffers).toString('utf8');
        const parsed = JSON.parse(raw || '{}');
        email = parsed.email;
        password = parsed.password;
      } catch (e) {
        // fallthrough
      }
    }
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const driver = await Driver.findOne({ email });
    if (!driver) return res.status(401).json({ message: 'Invalid email or password' });
    // NOTE: Following existing user login pattern (no hash verification for now)
    const accessToken = jwt.sign(
      { driverId: driver._id, email: driver.email, role: 'driver' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    const refreshToken = jwt.sign(
      { driverId: driver._id, email: driver.email, role: 'driver' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        driver: { _id: driver._id, email: driver.email, firstName: driver.firstName, lastName: driver.lastName, status: driver.status }
      },
      tokens: { accessToken, refreshToken, expiresIn: 8 * 3600 }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get current driver profile
router.get('/me', authenticateDriver, async (req, res) => {
  try {
    const driver = await Driver.findById(req.driverId);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json({ success: true, data: { driver } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// List orders assigned to driver
router.get('/orders', authenticateDriver, async (req, res) => {
  try {
    const orders = await LaundryOrder.find({ 'driverAssignment.driverId': new mongoose.Types.ObjectId(req.driverId) })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Assign order to current driver
router.post('/orders/:id/assign', authenticateDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await LaundryOrder.findById(id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.driverAssignment = { driverId: req.driverId, assignedAt: new Date(), notes: req.body?.notes };
    order.statusHistory.push({ status: 'pickup_scheduled', updatedBy: 'driver:' + req.driverId, notes: 'Assigned to driver' });
    await order.save();
    res.json({ success: true, message: 'Order assigned', order });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Update order status by driver
router.patch('/orders/:id/status', authenticateDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const allowed = ['picked_up', 'in_process', 'ready', 'out_for_delivery', 'delivered'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status update' });
    }
    const order = await LaundryOrder.findById(id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.driverAssignment?.driverId || String(order.driverAssignment.driverId) !== String(req.driverId)) {
      return res.status(403).json({ message: 'Order not assigned to this driver' });
    }
    order.status = status;
    order.statusHistory.push({ status, updatedBy: 'driver:' + req.driverId, notes });
    await order.save();
    res.json({ success: true, message: 'Status updated', order });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

export default router;

// ================= Product Delivery Endpoints =================
// List product orders assigned to driver
router.get('/product-orders', authenticateDriver, async (req, res) => {
  try {
    const Order = getOrderModel();
    const orders = await Order.find({ 'driverAssignment.driverId': new mongoose.Types.ObjectId(req.driverId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Assign a product order to current driver
router.post('/product-orders/:id/assign', authenticateDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const Order = getOrderModel();
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    order.driverAssignment = { driverId: req.driverId, assignedAt: new Date(), notes: req.body?.notes };
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status: 'processing', updatedBy: 'driver:' + req.driverId, notes: 'Assigned to driver' });
    await order.save();

    res.json({ success: true, message: 'Order assigned', order });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Update product order status by driver
router.patch('/product-orders/:id/status', authenticateDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const allowed = ['processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status update' });
    }

    const Order = getOrderModel();
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.driverAssignment?.driverId || String(order.driverAssignment.driverId) !== String(req.driverId)) {
      return res.status(403).json({ message: 'Order not assigned to this driver' });
    }

    order.status = status;
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status, updatedBy: 'driver:' + req.driverId, notes });
    await order.save();

    res.json({ success: true, message: 'Status updated', order });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Update product order GPS location (beta, optional auth)
router.post('/product-orders/:id/location', async (req, res) => {
  try {
    const { id } = req.params;
    const { driverId, lat, lng, accuracy } = req.body || {};
    const Order = getOrderModel();
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (!order.driverAssignment?.driverId) {
      return res.status(400).json({ success: false, message: 'Order has no assigned driver' });
    }
    if (driverId && String(order.driverAssignment.driverId) !== String(driverId)) {
      return res.status(403).json({ success: false, message: 'Driver does not match assignment' });
    }
    order.driverAssignment.lastKnownLocation = {
      lat: Number(lat),
      lng: Number(lng),
      accuracy: accuracy != null ? Number(accuracy) : undefined,
      updatedAt: new Date()
    };
    await order.save();

    try {
      if (global.io && order.userId) {
        global.io.to(`user-${order.userId}`).emit('driver_location_updated', {
          orderId: order._id.toString(),
          lat: Number(lat),
          lng: Number(lng),
          accuracy: accuracy != null ? Number(accuracy) : undefined,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('Socket emit failed:', e.message);
    }

    res.json({ success: true, message: 'Location updated', location: order.driverAssignment.lastKnownLocation });
  } catch (err) {
    console.error('❌ Error updating driver location:', err);
    res.status(500).json({ success: false, message: 'Failed to update location', error: err.message });
  }
});