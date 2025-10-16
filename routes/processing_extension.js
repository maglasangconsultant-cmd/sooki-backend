const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Extend processing time endpoint
router.put('/orders/:orderId/extend-processing', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { additionalHours, reason } = req.body;
    
    if (!additionalHours || additionalHours <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Additional hours must be a positive number'
      });
    }
    
    // Get Order model from the main app
    const Order = mongoose.model('Order');
    
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    if (order.status !== 'processing') {
      return res.status(400).json({
        success: false,
        error: 'Can only extend processing time for orders in processing status'
      });
    }
    
    // Add extension record
    order.processingExtensions.push({
      requestedAt: new Date(),
      additionalHours: additionalHours,
      reason: reason || 'Additional processing time needed'
    });
    
    // Extend the deadline
    order.processingDeadline = new Date(order.processingDeadline.getTime() + (additionalHours * 60 * 60 * 1000));
    
    await order.save();
    
    res.json({
      success: true,
      order: {
        _id: order._id,
        processingDeadline: order.processingDeadline,
        processingExtensions: order.processingExtensions
      }
    });
    
  } catch (err) {
    console.error('❌ Error extending processing time:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;