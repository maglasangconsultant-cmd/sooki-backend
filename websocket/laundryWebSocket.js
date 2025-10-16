/**
 * WebSocket handlers for real-time laundry service updates
 * Provides live status tracking and instant notifications
 */

import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { LaundryOrder, LaundryShop } from '../models/LaundryModels.js';
import User from '../models/User.js';

let io;
const connectedUsers = new Map(); // userId -> socket.id
const shopOwners = new Map(); // shopId -> socket.id
const activeOrders = new Map(); // orderId -> Set of socket.ids tracking this order

/**
 * Initialize WebSocket server for laundry service
 * @param {Object} server - HTTP server instance
 */
export const initializeLaundryWebSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // Configure based on your frontend domain
      methods: ["GET", "POST"]
    },
    path: '/laundry-socket'
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('firstName lastName city province addresses userType');
      
      if (!user) {
        return next(new Error('User not found'));
      }

      // Verify user is from Compostela
      const isCompostelaResident = user.city === 'Compostela' && user.province === 'Davao de Oro' ||
        user.addresses?.some(addr => addr.city === 'Compostela' && addr.province === 'Davao de Oro');

      if (!isCompostelaResident) {
        return next(new Error('Access restricted to Compostela residents only'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      console.error('❌ WebSocket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ User ${socket.user.firstName} connected to laundry WebSocket`);
    
    // Store user connection
    connectedUsers.set(socket.userId, socket.id);

    // Handle different user types
    handleUserConnection(socket);

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`❌ User ${socket.user.firstName} disconnected from laundry WebSocket`);
      connectedUsers.delete(socket.userId);
      
      // Remove from shop owners if applicable
      for (const [shopId, socketId] of shopOwners.entries()) {
        if (socketId === socket.id) {
          shopOwners.delete(shopId);
          break;
        }
      }

      // Remove from active order tracking
      for (const [orderId, socketIds] of activeOrders.entries()) {
        socketIds.delete(socket.id);
        if (socketIds.size === 0) {
          activeOrders.delete(orderId);
        }
      }
    });
  });

  return io;
};

/**
 * Handle user connection based on user type
 * @param {Object} socket - Socket instance
 */
const handleUserConnection = async (socket) => {
  try {
    // Check if user is a shop owner
    const ownedShops = await LaundryShop.find({ ownerId: socket.userId });
    
    if (ownedShops.length > 0) {
      // User is a shop owner
      ownedShops.forEach(shop => {
        shopOwners.set(shop._id.toString(), socket.id);
        socket.join(`shop_${shop._id}`);
      });
      
      socket.emit('shop_owner_connected', {
        shops: ownedShops.map(shop => ({
          id: shop._id,
          name: shop.shopName,
          activeOrders: 0 // Will be updated
        }))
      });

      // Send current pending orders
      await sendPendingOrdersToShop(socket, ownedShops);
    }

    // Handle customer connections
    socket.join(`user_${socket.userId}`);

    // Send user's active orders
    await sendActiveOrdersToCustomer(socket);

    // Handle order tracking requests
    socket.on('track_order', async (data) => {
      await handleOrderTracking(socket, data);
    });

    // Handle shop owner order updates
    socket.on('update_order_status', async (data) => {
      await handleOrderStatusUpdate(socket, data);
    });

    // Handle location updates for delivery tracking
    socket.on('update_delivery_location', async (data) => {
      await handleDeliveryLocationUpdate(socket, data);
    });

    // Handle shop availability updates
    socket.on('update_shop_availability', async (data) => {
      await handleShopAvailabilityUpdate(socket, data);
    });

    // Handle weight confirmation
    socket.on('confirm_weight', async (data) => {
      await handleWeightConfirmation(socket, data);
    });

  } catch (error) {
    console.error('❌ Error handling user connection:', error);
    socket.emit('connection_error', { message: 'Failed to initialize connection' });
  }
};

/**
 * Send pending orders to shop owner
 * @param {Object} socket - Socket instance
 * @param {Array} shops - Shop objects
 */
const sendPendingOrdersToShop = async (socket, shops) => {
  try {
    for (const shop of shops) {
      const pendingOrders = await LaundryOrder.find({
        shopId: shop._id,
        status: { $in: ['pending', 'confirmed', 'pickup_scheduled', 'picked_up', 'in_process'] }
      })
      .populate('customerId', 'firstName lastName phone')
      .sort({ createdAt: -1 });

      socket.emit('pending_orders', {
        shopId: shop._id.toString(),
        orders: pendingOrders.map(formatOrderForSocket)
      });
    }
  } catch (error) {
    console.error('❌ Error sending pending orders:', error);
  }
};

/**
 * Send active orders to customer
 * @param {Object} socket - Socket instance
 */
const sendActiveOrdersToCustomer = async (socket) => {
  try {
    const activeOrders = await LaundryOrder.find({
      customerId: socket.userId,
      status: { $in: ['pending', 'confirmed', 'pickup_scheduled', 'picked_up', 'in_process', 'ready_for_delivery', 'out_for_delivery'] }
    })
    .populate('shopId', 'shopName phone address')
    .sort({ createdAt: -1 });

    socket.emit('active_orders', {
      orders: activeOrders.map(formatOrderForSocket)
    });
  } catch (error) {
    console.error('❌ Error sending active orders:', error);
  }
};

/**
 * Handle order tracking requests
 * @param {Object} socket - Socket instance
 * @param {Object} data - Tracking data
 */
const handleOrderTracking = async (socket, data) => {
  try {
    const { orderId } = data;
    
    const order = await LaundryOrder.findById(orderId)
      .populate('customerId', 'firstName lastName')
      .populate('shopId', 'shopName phone address');

    if (!order) {
      socket.emit('tracking_error', { message: 'Order not found' });
      return;
    }

    // Verify user can track this order
    if (order.customerId._id.toString() !== socket.userId) {
      const userShops = await LaundryShop.find({ ownerId: socket.userId });
      const canTrack = userShops.some(shop => shop._id.toString() === order.shopId._id.toString());
      
      if (!canTrack) {
        socket.emit('tracking_error', { message: 'Access denied' });
        return;
      }
    }

    // Add socket to order tracking
    if (!activeOrders.has(orderId)) {
      activeOrders.set(orderId, new Set());
    }
    activeOrders.get(orderId).add(socket.id);

    // Send current order status
    socket.emit('order_status', {
      orderId,
      order: formatOrderForSocket(order),
      realTimeTracking: true
    });

  } catch (error) {
    console.error('❌ Error handling order tracking:', error);
    socket.emit('tracking_error', { message: 'Failed to start tracking' });
  }
};

/**
 * Handle order status updates from shop owners
 * @param {Object} socket - Socket instance
 * @param {Object} data - Update data
 */
const handleOrderStatusUpdate = async (socket, data) => {
  try {
    const { orderId, newStatus, notes, estimatedCompletion } = data;
    
    const order = await LaundryOrder.findById(orderId)
      .populate('customerId', 'firstName lastName')
      .populate('shopId', 'shopName ownerId');

    if (!order) {
      socket.emit('update_error', { message: 'Order not found' });
      return;
    }

    // Verify shop owner can update this order
    if (order.shopId.ownerId.toString() !== socket.userId) {
      socket.emit('update_error', { message: 'Access denied' });
      return;
    }

    // Update order status
    order.status = newStatus;
    if (notes) order.notes = notes;
    if (estimatedCompletion) order.estimatedCompletion = new Date(estimatedCompletion);
    order.statusHistory.push({
      status: newStatus,
      timestamp: new Date(),
      updatedBy: socket.userId,
      notes
    });

    await order.save();

    // Broadcast to all tracking this order
    const trackingSockets = activeOrders.get(orderId);
    if (trackingSockets) {
      trackingSockets.forEach(socketId => {
        io.to(socketId).emit('order_status_updated', {
          orderId,
          newStatus,
          notes,
          estimatedCompletion,
          timestamp: new Date(),
          order: formatOrderForSocket(order)
        });
      });
    }

    // Send to customer's room
    io.to(`user_${order.customerId._id}`).emit('order_status_updated', {
      orderId,
      newStatus,
      notes,
      estimatedCompletion,
      timestamp: new Date(),
      order: formatOrderForSocket(order)
    });

    // Send to shop room
    io.to(`shop_${order.shopId._id}`).emit('order_status_updated', {
      orderId,
      newStatus,
      notes,
      estimatedCompletion,
      timestamp: new Date(),
      order: formatOrderForSocket(order)
    });

    socket.emit('update_success', { orderId, newStatus });

  } catch (error) {
    console.error('❌ Error handling order status update:', error);
    socket.emit('update_error', { message: 'Failed to update order status' });
  }
};

/**
 * Handle delivery location updates
 * @param {Object} socket - Socket instance
 * @param {Object} data - Location data
 */
const handleDeliveryLocationUpdate = async (socket, data) => {
  try {
    const { orderId, latitude, longitude, address } = data;
    
    const order = await LaundryOrder.findById(orderId);
    if (!order) {
      socket.emit('location_error', { message: 'Order not found' });
      return;
    }

    // Update delivery location
    if (!order.delivery) order.delivery = {};
    order.delivery.currentLocation = {
      latitude,
      longitude,
      address,
      timestamp: new Date()
    };

    await order.save();

    // Broadcast to customer
    io.to(`user_${order.customerId}`).emit('delivery_location_updated', {
      orderId,
      location: {
        latitude,
        longitude,
        address,
        timestamp: new Date()
      }
    });

    // Broadcast to tracking sockets
    const trackingSockets = activeOrders.get(orderId);
    if (trackingSockets) {
      trackingSockets.forEach(socketId => {
        io.to(socketId).emit('delivery_location_updated', {
          orderId,
          location: {
            latitude,
            longitude,
            address,
            timestamp: new Date()
          }
        });
      });
    }

  } catch (error) {
    console.error('❌ Error handling delivery location update:', error);
    socket.emit('location_error', { message: 'Failed to update location' });
  }
};

/**
 * Handle shop availability updates
 * @param {Object} socket - Socket instance
 * @param {Object} data - Availability data
 */
const handleShopAvailabilityUpdate = async (socket, data) => {
  try {
    const { shopId, isOpen, message } = data;
    
    const shop = await LaundryShop.findById(shopId);
    if (!shop || shop.ownerId.toString() !== socket.userId) {
      socket.emit('availability_error', { message: 'Access denied' });
      return;
    }

    shop.isOpen = isOpen;
    if (message) shop.statusMessage = message;
    await shop.save();

    // Broadcast to all Compostela users
    io.emit('shop_availability_updated', {
      shopId,
      shopName: shop.shopName,
      isOpen,
      message,
      timestamp: new Date()
    });

    socket.emit('availability_updated', { shopId, isOpen, message });

  } catch (error) {
    console.error('❌ Error handling shop availability update:', error);
    socket.emit('availability_error', { message: 'Failed to update availability' });
  }
};

/**
 * Handle weight confirmation
 * @param {Object} socket - Socket instance
 * @param {Object} data - Weight data
 */
const handleWeightConfirmation = async (socket, data) => {
  try {
    const { orderId, actualWeight, notes } = data;
    
    const order = await LaundryOrder.findById(orderId)
      .populate('shopId', 'ownerId');

    if (!order || order.shopId.ownerId.toString() !== socket.userId) {
      socket.emit('weight_error', { message: 'Access denied' });
      return;
    }

    // Update weight tracking
    const estimatedWeight = order.weightTracking.estimatedWeight;
    const weightDifference = actualWeight - estimatedWeight;
    
    order.weightTracking.actualWeight = actualWeight;
    order.weightTracking.weightDifference = weightDifference;
    order.weightTracking.confirmedAt = new Date();
    order.weightTracking.confirmedBy = socket.userId;
    if (notes) order.weightTracking.notes = notes;

    // Recalculate pricing if needed
    if (Math.abs(weightDifference) > 0.5) { // 0.5kg tolerance
      const pricePerKg = order.pricing.subtotal / estimatedWeight;
      const additionalCost = weightDifference * pricePerKg;
      order.pricing.subtotal += additionalCost;
      order.pricing.total = order.pricing.subtotal + order.pricing.deliveryFee;
    }

    await order.save();

    // Notify customer about weight confirmation
    io.to(`user_${order.customerId}`).emit('weight_confirmed', {
      orderId,
      actualWeight,
      estimatedWeight,
      weightDifference,
      additionalCost: order.pricing.total - (order.pricing.subtotal - (actualWeight - estimatedWeight) * (order.pricing.subtotal / estimatedWeight)),
      newTotal: order.pricing.total,
      notes
    });

    socket.emit('weight_confirmation_success', { orderId, actualWeight });

  } catch (error) {
    console.error('❌ Error handling weight confirmation:', error);
    socket.emit('weight_error', { message: 'Failed to confirm weight' });
  }
};

/**
 * Format order object for socket transmission
 * @param {Object} order - Order object
 * @returns {Object} Formatted order
 */
const formatOrderForSocket = (order) => {
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    customer: order.customerId ? {
      id: order.customerId._id,
      name: `${order.customerId.firstName} ${order.customerId.lastName}`,
      phone: order.customerId.phone
    } : null,
    shop: order.shopId ? {
      id: order.shopId._id,
      name: order.shopId.shopName,
      phone: order.shopId.phone,
      address: order.shopId.address
    } : null,
    services: order.services,
    pricing: order.pricing,
    pickup: order.pickup,
    delivery: order.delivery,
    weightTracking: order.weightTracking,
    estimatedCompletion: order.estimatedCompletion,
    createdAt: order.createdAt,
    statusHistory: order.statusHistory
  };
};

/**
 * Broadcast order update to all relevant parties
 * @param {string} orderId - Order ID
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 */
export const broadcastOrderUpdate = async (orderId, eventType, data) => {
  if (!io) return;

  try {
    const order = await LaundryOrder.findById(orderId)
      .populate('customerId', '_id')
      .populate('shopId', '_id');

    if (!order) return;

    // Broadcast to customer
    io.to(`user_${order.customerId._id}`).emit(eventType, { orderId, ...data });

    // Broadcast to shop
    io.to(`shop_${order.shopId._id}`).emit(eventType, { orderId, ...data });

    // Broadcast to tracking sockets
    const trackingSockets = activeOrders.get(orderId);
    if (trackingSockets) {
      trackingSockets.forEach(socketId => {
        io.to(socketId).emit(eventType, { orderId, ...data });
      });
    }

  } catch (error) {
    console.error('❌ Error broadcasting order update:', error);
  }
};

/**
 * Get WebSocket connection statistics
 * @returns {Object} Connection stats
 */
export const getConnectionStats = () => {
  return {
    connectedUsers: connectedUsers.size,
    connectedShops: shopOwners.size,
    activeOrderTracking: activeOrders.size,
    totalSockets: io ? io.sockets.sockets.size : 0
  };
};