import express from 'express';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { v2 as cloudinary } from 'cloudinary';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import AnalyticsEvent from '../models/Analytics.js'; // Assuming AnalyticsEvent is defined in Analytics.js
import { verifyCompostelaLocation } from '../middleware/locationMiddleware.js';

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for Cloudinary uploads with organized folder structure
const createCloudinaryStorage = (folderName) => {
  return new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: `sooki/${folderName}`,
      format: async (req, file) => 'webp', // supports promises as well
      public_id: (req, file) => {
        const originalname = file.originalname.split('.')[0];
        return `${originalname}-${Date.now()}`;
      },
    },
  });
};

const readyPhotoStorage = createCloudinaryStorage('ready_photos');
const uploadReadyPhoto = multer({ storage: readyPhotoStorage });

// Upload ready photo for order
router.post('/orders/:orderId/ready-photo', uploadReadyPhoto.single('readyPhoto'), async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No photo file provided'
      });
    }
    
    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    // Check if order is in ready_to_ship status
    if (order.status !== 'ready_to_ship') {
      return res.status(400).json({
        success: false,
        error: 'Order must be in ready_to_ship status to upload photo'
      });
    }
    
    // If there's an existing photo, we'll replace it
    if (order.readyPhoto && order.readyPhoto.publicId) {
      try {
        // Delete old photo from Cloudinary
        await cloudinary.uploader.destroy(order.readyPhoto.publicId);
        console.log(`🗑️ Deleted old ready photo: ${order.readyPhoto.publicId}`);
      } catch (deleteError) {
        console.error('❌ Error deleting old photo:', deleteError.message);
      }
    }
    
    // Calculate deletion date (24 hours from now)
    const scheduledForDeletion = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    // Update order with new photo info
    order.readyPhoto = {
      url: req.file.path,
      publicId: req.file.filename,
      uploadedAt: new Date(),
      scheduledForDeletion: scheduledForDeletion
    };
    
    await order.save();
    
    console.log(`📸 Ready photo uploaded for order ${orderId}:`, {
      url: req.file.path,
      publicId: req.file.filename,
      scheduledForDeletion: scheduledForDeletion
    });
    
    res.json({
      success: true,
      message: 'Ready photo uploaded successfully',
      photo: {
        url: order.readyPhoto.url,
        uploadedAt: order.readyPhoto.uploadedAt,
        scheduledForDeletion: order.readyPhoto.scheduledForDeletion
      }
    });
    
  } catch (err) {
    console.error('❌ Error uploading ready photo:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


// Driver GPS: update product order location (no auth for beta; validates assigned driver)
router.post('/:id/location', async (req, res) => {
  try {
    const { id } = req.params;
    const { driverId, lat, lng, accuracy } = req.body || {};
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

    // Notify customer room if available
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
    console.error('❌ Error updating order location:', err);
    res.status(500).json({ success: false, message: 'Error updating order location', error: err.message });
  }
});


// Create a new order
router.post('/', async (req, res) => {
  try {
    console.log('📦 Received order data:', JSON.stringify(req.body, null, 2));
    
    const { userId, sellerId, items, status } = req.body;
    
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
    sellerId,
    items: transformedItems,
    status: status || 'pending',
    totalAmount: calculatedTotal, // Add totalAmount field for frontend compatibility
    paymentMethod: req.body.paymentMethod,
    paymentReceiptUrl: req.body.paymentReceiptUrl,
    deliveryAddress: req.body.deliveryAddress,
    summary: {
      subtotal: calculatedTotal,
      shippingFee: 0,
      tax: 0,
      discount: 0,
      total: calculatedTotal
    }
  };

  // Backward compatibility: populate legacy required fields if schema still enforces them
  const primaryItem = transformedItems[0] || {};
  orderData.buyerName = req.body.buyerName || 'Test Buyer';
  orderData.productName = primaryItem.product?.name || req.body.productName || 'Unknown Product';
  orderData.productImageUrl = primaryItem.product?.productImage || req.body.productImageUrl || 'https://via.placeholder.com/300x300.png?text=Product';
    
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
          // await logAnalyticsEvent('order_placed', userId, {
          //   productId,
          //   quantityOrdered: quantity,
          //   remainingStock: updatedProduct.stock,
          //   orderValue: item.totalPrice
          // });
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
    
    // Send real-time notification to sellers
    try {
      // Get unique sellers from the order items
      const sellers = new Set();
      savedOrder.items.forEach(item => {
        if (item.product.seller && item.product.seller._id) {
          sellers.add(item.product.seller._id.toString());
        }
      });

      // Send notification to each seller
      for (const sellerId of sellers) {
        const sellerItems = savedOrder.items.filter(item => 
          item.product.seller && item.product.seller._id.toString() === sellerId
        );
        
        const sellerTotal = sellerItems.reduce((sum, item) => sum + item.totalPrice, 0);
        
        const notificationData = {
          orderId: savedOrder._id.toString(),
          customerName: savedOrder.customerInfo?.name || 'Unknown Customer',
          totalAmount: sellerTotal,
          itemCount: sellerItems.length,
          items: sellerItems.map(item => ({
            productName: item.product.name,
            quantity: item.quantity,
            price: item.totalPrice
          }))
        };

        // Emit to seller's room
        // io.to(`seller_${sellerId}`).emit('newOrderNotification', notificationData);
        console.log(`🔔 [SELLER NOTIFICATION] Sent to seller ${sellerId}:`, notificationData);
      }
    } catch (notificationError) {
      console.error('❌ [NOTIFICATION ERROR] Failed to send seller notifications:', notificationError.message);
    }
    
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

router.get('/orders/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    // Get seller's products first (needed for both approaches)
    const products = await Product.find({ 'seller._id': sellerId });
    const productIds = products.map(p => p._id);
    
    // First try to find orders by sellerId field (new approach)
    let orders = await Order.find({ sellerId }).sort({ createdAt: -1 });
    
    // If no orders found by sellerId, fall back to product-based filtering (legacy approach)
    if (orders.length === 0) {
      // Get orders containing seller's products
      orders = await Order.find({
        'items.product._id': { $in: productIds }
      }).sort({ createdAt: -1 });
    }
    
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
            name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer',
            email: customer.email,
            phone: customer.phone || 'N/A'
          };
        }
      } catch (userError) {
        console.error(`❌ Error fetching customer details for user ${order.userId}:`, userError.message);
      }
      
      return {
        id: `#ORD${order._id.toString().slice(-6).toUpperCase()}`,
        _id: order._id,
        customer: order.userId,
        customerName: customerInfo?.name || 'Unknown Customer',
        customerEmail: customerInfo?.email || 'N/A',
        customerPhone: customerInfo?.phone || 'N/A',
        amount: sellerTotal,
        total: sellerTotal,
        status: order.status,
        date: order.createdAt.toISOString().split('T')[0],
        createdAt: order.createdAt,
        deliveryAddress: order.shippingAddress ? 
          `${order.shippingAddress.address || ''}, ${order.shippingAddress.city || ''}, ${order.shippingAddress.province || ''}`.replace(/^,\s*|,\s*$/g, '') || 'N/A' 
          : 'N/A',
        items: enhancedSellerItems,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        shippingFee: order.summary?.shippingFee || 0,
        tax: order.summary?.tax || 0,
        discount: order.summary?.discount || 0,
        notes: order.notes,
        processingDeadline: order.processingDeadline,
        processingExtensions: order.processingExtensions,
        driverAssignment: order.driverAssignment,
        readyPhotoUrl: order.readyPhotoUrl,
        receiptPhotoUrl: order.receiptPhotoUrl,
        cancellationReason: order.cancellationReason,
        refundDetails: order.refundDetails,
        deliveryDetails: order.deliveryDetails,
        pickupDetails: order.pickupDetails,
        trackingNumber: order.trackingNumber,
        estimatedDeliveryDate: order.estimatedDeliveryDate,
        deliveryInstructions: order.deliveryInstructions,
        customerFeedback: order.customerFeedback,
        sellerFeedback: order.sellerFeedback,
        rating: order.rating,
        issueReported: order.issueReported,
        issueDetails: order.issueDetails,
        issueResolution: order.issueResolution,
        issueStatus: order.issueStatus,
        lastModifiedBy: order.lastModifiedBy,
        version: order.__v
      };
    }));
    
    res.json(sellerOrders);
    
  } catch (err) {
    console.error('❌ Error fetching seller orders:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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


// Delete all orders endpoint (for development/testing only)
router.delete('/orders/all', async (req, res) => {
  try {
    console.log('🗑️  [DEV] Deleting all orders from database...');
    
    const result = await Order.deleteMany({});
    
    console.log(`🗑️  [DEV] Successfully deleted ${result.deletedCount} orders`);
    
    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} orders`,
      deletedCount: result.deletedCount
    });
    
  } catch (error) {
    console.error('❌ [DEV] Error deleting orders:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete orders: ' + error.message
    });
  }
});


// Payment verification endpoint
router.put('/orders/:orderId/payment-verification', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { action, declineReason, sellerId } = req.body;
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: "Invalid action. Must be 'approve' or 'reject'"
      });
    }
    
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    // Check if order is in payment_uploaded status
    if (order.status !== 'payment_uploaded') {
      return res.status(400).json({
        success: false,
        error: 'Order must be in payment_uploaded status for verification'
      });
    }
    
    // Update order based on action
    if (action === 'approve') {
      order.status = 'payment_verified';
      order.paymentStatus = 'verified';
      order.paymentVerifiedAt = new Date();
      order.paymentVerifiedBy = sellerId;
    } else {
      order.status = 'payment_rejected';
      order.paymentStatus = 'rejected';
      order.paymentRejectedAt = new Date();
      order.paymentRejectedBy = sellerId;
      order.paymentDeclineReason = declineReason;
    }
    
    await order.save();
    
    // Send real-time notification to customer
    if (global.io) {
      const notificationData = {
        orderId: order._id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        orderNumber: `#ORD${order._id.toString().slice(-6).toUpperCase()}`,
        message: action === 'approve' 
          ? 'Your payment has been verified and your order is confirmed!'
          : `Your payment was rejected. Reason: ${declineReason || 'No reason provided'}`
      };
      
      global.io.to(`user_${order.userId}`).emit('paymentVerificationUpdate', notificationData);
      console.log(`📡 Payment verification update sent to user_${order.userId}`);
    }
    
    res.json({
      success: true,
      message: `Payment ${action}d successfully`,
      order: {
        _id: order._id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        orderNumber: `#ORD${order._id.toString().slice(-6).toUpperCase()}`
      }
    });
    
  } catch (err) {
    console.error('❌ Error processing payment verification:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/orders/:id/location', async (req, res) => {
  try {
    const { id } = req.params;
    const { driverId, lat, lng, accuracy } = req.body || {};
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

    // Notify customer room if available
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
    console.error('❌ Error updating order location:', err);
    res.status(500).json({ success: false, message: 'Failed to update location', error: err.message });
  }
});

router.post('/api/laundry/orders', verifyCompostelaLocation, async (req, res) => {
  try {
    const {
      shopId,
      services,
      pickup,
      delivery,
      specialRequirements,
      weightTracking
    } = req.body;

    // Validate required fields
    if (!shopId || !services || !pickup) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: shopId, services, pickup'
      });
    }

    // Verify shop exists and is active
    const shop = await LaundryShop.findById(shopId);
    if (!shop || !shop.isActive || !shop.isVerified) {
      return res.status(404).json({
        success: false,
        message: 'Laundry shop not found or not available'
      });
    }

    // Calculate pricing
    let subtotal = 0;
    const processedServices = services.map(service => {
      const shopService = shop.services.find(s => s.name === service.serviceType);
      if (!shopService) {
        throw new Error(`Service type "${service.serviceType}" not available at this shop`);
      }
      
      const serviceSubtotal = service.weight * shopService.pricePerKg;
      subtotal += serviceSubtotal;
      
      return {
        serviceType: service.serviceType,
        weight: service.weight,
        pricePerKg: shopService.pricePerKg,
        subtotal: serviceSubtotal,
        specialInstructions: service.specialInstructions || ''
      };
    });

    const pickupFee = 20; // Fixed pickup fee
    const deliveryFee = delivery ? 20 : 0; // Delivery fee if delivery requested
    const total = subtotal + pickupFee + deliveryFee;

    // Create new order
    const newOrder = new LaundryOrder({
      customerId: req.user._id,
      customerName: req.user.firstName + ' ' + req.user.lastName,
      customerPhone: req.user.phone,
      shopId,
      services: processedServices,
      pickup,
      delivery,
      weightTracking,
      pricing: {
        subtotal,
        pickupFee,
        deliveryFee,
      },
      totalAmount: total,
      specialRequirements,
      status: 'pending',
      orderNumber: `LAUNDRY-${Date.now()}`,
      paymentStatus: 'pending',
      orderType: 'laundry'
    });

    await newOrder.save();

    res.status(201).json({
      success: true,
      message: 'Laundry order created successfully',
      order: newOrder
    });

  } catch (error) {
    console.error('❌ Error creating laundry order:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.put('/api/laundry/orders/:orderId/status', verifyCompostelaLocation, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes, actualWeight, staffName } = req.body;

    const validStatuses = [
      'pending', 'pickup_scheduled', 'picked_up', 'in_process', 
      'ready', 'out_for_delivery', 'delivered', 'cancelled'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
        validStatuses
      });
    }

    const order = await LaundryOrder.findById(orderId).populate('shopId');
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify user owns the shop or is the customer
    const isShopOwner = order.shopId.ownerId.toString() === req.user._id.toString();
    const isCustomer = order.customerId.toString() === req.user._id.toString();

    if (!isShopOwner && !isCustomer) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update orders for your shop or your own orders.'
      });
    }

    // Update order status
    order.status = status;
    
    // Add to status history
    order.statusHistory.push({
      status,
      timestamp: new Date(),
      updatedBy: staffName || req.user.firstName,
      notes: notes || ''
    });

    // Handle weight confirmation
    if (actualWeight && status === 'picked_up') {
      order.weightTracking.actualWeight = actualWeight;
      order.weightTracking.weightDifference = actualWeight - (order.weightTracking.estimatedWeight || 0);
      
      // Recalculate pricing if weight changed significantly
      if (Math.abs(order.weightTracking.weightDifference) > 0.5) {
        let newSubtotal = 0;
        order.services.forEach(service => {
          const newServiceTotal = actualWeight * service.pricePerKg;
          service.subtotal = newServiceTotal;
          newSubtotal += newServiceTotal;
        });
        
        order.pricing.subtotal = newSubtotal;
        order.pricing.total = newSubtotal + order.pricing.pickupFee + order.pricing.deliveryFee;
      }
    }

    // Set completion time for delivered orders
    if (status === 'delivered') {
      order.actualCompletion = new Date();
      order.shopId.totalOrders += 1;
      await order.shopId.save();
    }

    await order.save();

    // Send enhanced notification using laundry notification service
    try {
      await sendLaundryStatusNotification(order._id, status, staffName || req.user.firstName, notes);
    } catch (notifError) {
      console.error('❌ Error sending laundry status notification:', notifError);
    }

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        weightTracking: order.weightTracking,
        pricing: order.pricing,
        statusHistory: order.statusHistory.slice(-3) // Last 3 status updates
      }
    });

  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message
    });
  }
});

router.get('/api/laundry/orders/customer/:customerId', verifyCompostelaLocation, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { page = 1, limit = 10, status } = req.query;

    // Verify user can access these orders
    if (req.user._id.toString() !== customerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own orders.'
      });
    }

    let query = { customerId };
    if (status) {
      query.status = status;
    }

    const orders = await LaundryOrder.find(query)
      .populate('shopId', 'shopName location contact')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LaundryOrder.countDocuments(query);

    res.json({
      success: true,
      orders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      }
    });

  } catch (error) {
    console.error('❌ Error fetching customer orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
});

router.get('/api/laundry/orders/shop/:shopId', verifyCompostelaLocation, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { page = 1, limit = 10, status, date } = req.query;

    // Verify user owns the shop
    const shop = await LaundryShop.findById(shopId);
    if (!shop || shop.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view orders for your own shop.'
      });
    }

    let query = { shopId };
    if (status) {
      query.status = status;
    }
    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      query.createdAt = { $gte: startDate, $lt: endDate };
    }

    const orders = await LaundryOrder.find(query)
      .populate('customerId', 'firstName lastName phone')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LaundryOrder.countDocuments(query);

    res.json({
      success: true,
      orders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalOrders: total
      }
    });

  } catch (error) {
    console.error('❌ Error fetching shop orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
});

export default router;