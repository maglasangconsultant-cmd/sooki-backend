import express from 'express';
import Order from './models/Order.js';
import Product from './models/Product.js';
import User from './models/User.js';

const router = express.Router();

// Get all orders
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Driver GPS: get product order last location
router.get('/:id/location', async (req, res) => {
  try {
    const { id } = req.params;
    const Order = mongoose.models.Order || mongoose.model('Order');
    const order = await Order.findById(id).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const loc = order?.driverAssignment?.lastKnownLocation || null;
    res.json({ success: true, orderId: id, location: loc });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get location', error: err.message });
  }
});

// Get seller's orders (both endpoints for compatibility)
router.get('/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    console.log(`🔍 [API] Fetching orders for seller: ${sellerId}`);
    
    // Get seller's products
    const products = await Product.find({ 'seller._id': sellerId });
    const productIds = products.map(p => p._id);
    console.log(`📦 [API] Found ${products.length} products for seller`);
    
    // Get orders containing seller's products
    const orders = await Order.find({
      'items.product._id': { $in: productIds }
    }).select('+totalAmount +paymentReceiptUrl').sort({ createdAt: -1 });
    console.log(`📋 [API] Found ${orders.length} total orders for seller`);
    
    // Log order statuses
    const statusCounts = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});
    console.log(`📊 [API] Order status breakdown:`, statusCounts);
    
    // Transform orders to include only seller's items and populate customer details
    const sellerOrders = await Promise.all(orders.map(async (order) => {
      const sellerItems = order.items.filter(item => 
        productIds.some(pid => pid.toString() === item.product._id.toString())
      );
      
      // Enhance seller items with product details including images
      const enhancedSellerItems = await Promise.all(sellerItems.map(async (item) => {
        try {
          const product = await Product.findById(item.product._id);
          return {
            ...item,
            product: {
              ...item.product,
              image: product?.images?.[0] || product?.image || null,
              images: product?.images || []
            },
            name: item.product.name || product?.name || 'Unknown Product',
            image: product?.images?.[0] || product?.image || null,
            price: item.unitPrice,
            totalPrice: item.totalPrice
          };
        } catch (productError) {
          console.error(`❌ Error fetching product details for ${item.product._id}:`, productError.message);
          return {
            ...item,
            name: item.product.name || 'Unknown Product',
            image: null,
            price: item.unitPrice,
            totalPrice: item.totalPrice
          };
        }
      }));
      
      const sellerTotal = enhancedSellerItems.reduce((sum, item) => sum + item.totalPrice, 0);
      
      // Populate customer details
      let customerInfo = null;
      try {
        const customer = await User.findById(order.userId);
        if (customer) {
          customerInfo = {
            _id: customer._id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
            profilePicture: customer.profilePicture
          };
        }
      } catch (customerError) {
        console.error(`❌ Error fetching customer details for ${order.userId}:`, customerError.message);
      }

      return {
        ...order.toObject(),
        items: enhancedSellerItems,
        sellerTotal: sellerTotal,
        customer: customerInfo
      };
    }));

    res.json(sellerOrders);
  } catch (err) {
    console.error('❌ Error fetching seller orders:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch seller orders', error: err.message });
  }
});


// Get user's order history
router.get('/user/orders/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user's orders
    const orders = await Order.find({ userId: userId })
      .sort({ createdAt: -1 });
    
    // Transform orders for frontend with complete product details
    const userOrders = await Promise.all(orders.map(async (order) => {
      // Enhance items with complete product details
      const enhancedItems = await Promise.all(order.items.map(async (item) => {
        try {
          // Fetch complete product details from Product collection
          const product = await Product.findById(item.product._id);
          return {
            _id: item._id,
            product: {
              _id: item.product._id,
              name: product?.name || item.product.name || 'Unknown Product',
              images: product?.images || [],
              price: product?.price || item.unitPrice || 0
            },
            quantity: item.quantity,
            price: item.price || item.unitPrice,
            totalPrice: item.totalPrice,
            unitPrice: item.unitPrice
          };
        } catch (productError) {
          console.error(`❌ Error fetching product details for ${item.product._id}:`, productError.message);
          return {
            _id: item._id,
            product: {
              _id: item.product._id,
              name: item.product.name || 'Unknown Product',
              images: [],
              price: item.unitPrice || 0
            },
            quantity: item.quantity,
            price: item.price || item.unitPrice,
            totalPrice: item.totalPrice,
            unitPrice: item.unitPrice
          };
        }
      }));

      return {
        _id: order._id,
        orderNumber: `#ORD${order._id.toString().slice(-6).toUpperCase()}`,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
        items: enhancedItems,
        // Add ready photo information
        readyPhoto: order.readyPhoto,
        readyPhotoUrl: order.readyPhoto?.url,
        // Add flag to show if user can rate products in this order
        canRate: order.status === 'delivered' && order.deliveredAt,
        // Check if rating period is still valid (e.g., within 30 days of delivery)
        ratingDeadline: order.deliveredAt ? 
          new Date(order.deliveredAt.getTime() + (30 * 24 * 60 * 60 * 1000)) : null
      };
    }));
    
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
router.put('/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, sellerId } = req.body;
    
    // Validate status
    const validStatuses = ['pending', 'accepted', 'confirmed', 'processing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'payment_uploaded', 'payment_verified', 'payment_rejected'];
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

    // If status is 'accepted' or 'confirmed', set processing start time and deadline
    if (status === 'accepted' || status === 'confirmed') {
      order.processingStartedAt = new Date();
      // Set deadline to 24 hours from now
      order.processingDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    await order.save();
    
    // Log analytics event for order status update
    try {
      await AnalyticsEvent.create({
        event: 'order_status_update',
        orderId: order._id,
        userId: order.userId,
        sellerId: sellerId, // Assuming sellerId is passed in req.body for analytics
        data: {
          status: order.status,
          deliveredAt: order.deliveredAt,
          processingStartedAt: order.processingStartedAt,
          processingDeadline: order.processingDeadline
        }
      });
    } catch (analyticsError) {
      console.error('❌ Failed to log order status update analytics:', analyticsError.message);
    }

    res.json({
      success: true,
      message: `Order ${orderId} status updated to ${status}`,
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

export default router;