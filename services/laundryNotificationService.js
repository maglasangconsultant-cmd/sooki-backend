/**
 * Laundry Notification Service
 * Handles real-time notifications for laundry status updates
 */

import { sendPushNotification, sendMulticastNotification } from '../firebase-config.js';
import { LaundryNotification, LaundryOrder, LaundryShop } from '../models/LaundryModels.js';
import User from '../models/User.js'; // Assuming User model exists

/**
 * Send notification for laundry status updates
 * @param {string} orderId - Laundry order ID
 * @param {string} newStatus - New order status
 * @param {string} updatedBy - Who updated the status
 * @param {string} notes - Additional notes
 */
export const sendLaundryStatusNotification = async (orderId, newStatus, updatedBy = 'system', notes = '') => {
  try {
    const order = await LaundryOrder.findById(orderId)
      .populate('customerId', 'firstName lastName fcmToken')
      .populate('shopId', 'shopName ownerId fcmToken');

    if (!order) {
      throw new Error('Order not found');
    }

    const customer = order.customerId;
    const shop = order.shopId;

    // Define notification messages for different statuses
    const notificationConfig = {
      pickup_scheduled: {
        customerTitle: 'Pickup Scheduled',
        customerMessage: `Your laundry pickup has been scheduled for ${order.pickup.scheduledTime}`,
        shopTitle: 'Pickup Scheduled',
        shopMessage: `Pickup scheduled for order ${order.orderNumber}`
      },
      picked_up: {
        customerTitle: 'Laundry Picked Up',
        customerMessage: `Your laundry has been picked up and is being processed at ${shop.shopName}`,
        shopTitle: 'Items Picked Up',
        shopMessage: `Items picked up for order ${order.orderNumber}`
      },
      weight_confirmed: {
        customerTitle: 'Weight Confirmed',
        customerMessage: `Actual weight: ${order.weightTracking.actualWeight}kg. ${order.weightTracking.weightDifference > 0 ? 'Additional charges may apply.' : 'No additional charges.'}`,
        shopTitle: 'Weight Confirmed',
        shopMessage: `Weight confirmed for order ${order.orderNumber}: ${order.weightTracking.actualWeight}kg`
      },
      in_process: {
        customerTitle: 'Laundry in Process',
        customerMessage: `Your laundry is being processed at ${shop.shopName}. Estimated completion: ${order.estimatedCompletion?.toLocaleDateString()}`,
        shopTitle: 'Order in Process',
        shopMessage: `Order ${order.orderNumber} is now being processed`
      },
      ready_for_delivery: {
        customerTitle: 'Ready for Delivery',
        customerMessage: `Your laundry is ready! We'll deliver it soon to ${order.delivery?.address || order.pickup.address}`,
        shopTitle: 'Order Ready',
        shopMessage: `Order ${order.orderNumber} is ready for delivery`
      },
      out_for_delivery: {
        customerTitle: 'Out for Delivery',
        customerMessage: `Your laundry is on the way! Expected delivery: ${order.delivery?.scheduledTime || 'Soon'}`,
        shopTitle: 'Out for Delivery',
        shopMessage: `Order ${order.orderNumber} is out for delivery`
      },
      delivered: {
        customerTitle: 'Laundry Delivered',
        customerMessage: `Your laundry has been delivered! Please rate your experience with ${shop.shopName}`,
        shopTitle: 'Order Delivered',
        shopMessage: `Order ${order.orderNumber} has been successfully delivered`
      },
      cancelled: {
        customerTitle: 'Order Cancelled',
        customerMessage: `Your laundry order ${order.orderNumber} has been cancelled. ${notes}`,
        shopTitle: 'Order Cancelled',
        shopMessage: `Order ${order.orderNumber} has been cancelled`
      }
    };

    const config = notificationConfig[newStatus];
    if (!config) {
      console.warn(`No notification configuration for status: ${newStatus}`);
      return;
    }

    // Send notification to customer
    if (customer && customer.fcmToken) {
      const customerNotification = new LaundryNotification({
        recipientId: customer._id,
        recipientType: 'customer',
        orderId: order._id,
        orderNumber: order.orderNumber,
        type: newStatus,
        title: config.customerTitle,
        message: config.customerMessage,
        data: {
          shopName: shop.shopName,
          estimatedCompletion: order.estimatedCompletion,
          totalAmount: order.pricing.total,
          pickupTime: order.pickup.scheduledTime,
          deliveryTime: order.delivery?.scheduledTime
        }
      });

      try {
        const fcmResponse = await sendPushNotification(customer.fcmToken, {
          title: config.customerTitle,
          body: config.customerMessage,
          data: {
            type: 'laundry_status_update',
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            status: newStatus,
            shopId: shop._id.toString(),
            shopName: shop.shopName
          }
        });

        customerNotification.status = 'sent';
        customerNotification.sentAt = new Date();
        customerNotification.fcmResponse = fcmResponse;
        
        if (fcmResponse.success) {
          customerNotification.status = 'delivered';
          customerNotification.deliveredAt = new Date();
          customerNotification.fcmMessageId = fcmResponse.messageId;
        }
      } catch (fcmError) {
        console.error('❌ Error sending FCM to customer:', fcmError);
        customerNotification.status = 'failed';
        customerNotification.fcmResponse = { error: fcmError.message };
      }

      await customerNotification.save();
    }

    // Send notification to shop owner (for certain statuses)
    const shopNotificationStatuses = ['pickup_scheduled', 'delivered', 'cancelled'];
    if (shopNotificationStatuses.includes(newStatus) && shop.fcmToken) {
      const shopOwner = await User.findById(shop.ownerId);
      
      if (shopOwner) {
        const shopNotification = new LaundryNotification({
          recipientId: shopOwner._id,
          recipientType: 'shop_owner',
          orderId: order._id,
          orderNumber: order.orderNumber,
          type: newStatus,
          title: config.shopTitle,
          message: config.shopMessage,
          data: {
            customerName: `${customer.firstName} ${customer.lastName}`,
            totalAmount: order.pricing.total,
            pickupTime: order.pickup.scheduledTime,
            deliveryTime: order.delivery?.scheduledTime
          }
        });

        try {
          const fcmResponse = await sendPushNotification(shop.fcmToken, {
            title: config.shopTitle,
            body: config.shopMessage,
            data: {
              type: 'laundry_shop_update',
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              status: newStatus,
              customerId: customer._id.toString()
            }
          });

          shopNotification.status = 'sent';
          shopNotification.sentAt = new Date();
          shopNotification.fcmResponse = fcmResponse;
          
          if (fcmResponse.success) {
            shopNotification.status = 'delivered';
            shopNotification.deliveredAt = new Date();
            shopNotification.fcmMessageId = fcmResponse.messageId;
          }
        } catch (fcmError) {
          console.error('❌ Error sending FCM to shop:', fcmError);
          shopNotification.status = 'failed';
          shopNotification.fcmResponse = { error: fcmError.message };
        }

        await shopNotification.save();
      }
    }

    console.log(`✅ Laundry notification sent for order ${order.orderNumber} - Status: ${newStatus}`);
    
  } catch (error) {
    console.error('❌ Error sending laundry status notification:', error);
    throw error;
  }
};

/**
 * Send new order notification to shop owner
 * @param {string} orderId - Laundry order ID
 */
export const sendNewOrderNotification = async (orderId) => {
  try {
    const order = await LaundryOrder.findById(orderId)
      .populate('customerId', 'firstName lastName phone')
      .populate('shopId', 'shopName ownerId fcmToken');

    if (!order) {
      throw new Error('Order not found');
    }

    const customer = order.customerId;
    const shop = order.shopId;
    const shopOwner = await User.findById(shop.ownerId);

    if (!shopOwner || !shop.fcmToken) {
      console.warn('Shop owner not found or no FCM token available');
      return;
    }

    const notification = new LaundryNotification({
      recipientId: shopOwner._id,
      recipientType: 'shop_owner',
      orderId: order._id,
      orderNumber: order.orderNumber,
      type: 'order_confirmed',
      title: 'New Laundry Order',
      message: `New order from ${customer.firstName} ${customer.lastName} - ₱${order.pricing.total}`,
      data: {
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerPhone: customer.phone,
        totalAmount: order.pricing.total,
        pickupAddress: order.pickup.address,
        pickupTime: order.pickup.scheduledTime,
        services: order.services.map(s => `${s.serviceType} (${s.weight}kg)`).join(', ')
      }
    });

    try {
      const fcmResponse = await sendPushNotification(shop.fcmToken, {
        title: 'New Laundry Order',
        body: `New order from ${customer.firstName} ${customer.lastName} - ₱${order.pricing.total}`,
        data: {
          type: 'new_laundry_order',
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          customerId: customer._id.toString(),
          customerName: `${customer.firstName} ${customer.lastName}`,
          totalAmount: order.pricing.total.toString()
        }
      });

      notification.status = 'sent';
      notification.sentAt = new Date();
      notification.fcmResponse = fcmResponse;
      
      if (fcmResponse.success) {
        notification.status = 'delivered';
        notification.deliveredAt = new Date();
        notification.fcmMessageId = fcmResponse.messageId;
      }
    } catch (fcmError) {
      console.error('❌ Error sending new order FCM:', fcmError);
      notification.status = 'failed';
      notification.fcmResponse = { error: fcmError.message };
    }

    await notification.save();
    console.log(`✅ New order notification sent for order ${order.orderNumber}`);
    
  } catch (error) {
    console.error('❌ Error sending new order notification:', error);
    throw error;
  }
};

/**
 * Send bulk notifications to all Compostela customers about shop updates
 * @param {string} shopId - Laundry shop ID
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {Object} data - Additional data
 */
export const sendShopUpdateToCompostelaCustomers = async (shopId, title, message, data = {}) => {
  try {
    const shop = await LaundryShop.findById(shopId);
    if (!shop) {
      throw new Error('Shop not found');
    }

    // Find all users in Compostela with FCM tokens
    const compostelaUsers = await User.find({
      $or: [
        { 'addresses.city': 'Compostela', 'addresses.province': 'Davao de Oro' },
        { city: 'Compostela', province: 'Davao de Oro' }
      ],
      fcmToken: { $exists: true, $ne: null },
      isActive: true
    }).select('_id fcmToken firstName lastName');

    if (compostelaUsers.length === 0) {
      console.warn('No Compostela users with FCM tokens found');
      return;
    }

    const fcmTokens = compostelaUsers.map(user => user.fcmToken);
    
    // Send multicast notification
    const fcmResponse = await sendMulticastNotification(fcmTokens, {
      title,
      body: message,
      data: {
        type: 'laundry_shop_update',
        shopId: shop._id.toString(),
        shopName: shop.shopName,
        ...data
      }
    });

    // Save notification records for each user
    const notifications = compostelaUsers.map(user => ({
      recipientId: user._id,
      recipientType: 'customer',
      orderId: null, // No specific order
      type: 'shop_announcement',
      title,
      message,
      status: 'sent',
      sentAt: new Date(),
      fcmResponse: fcmResponse,
      data: {
        shopName: shop.shopName,
        ...data
      }
    }));

    await LaundryNotification.insertMany(notifications);
    
    console.log(`✅ Shop update notification sent to ${compostelaUsers.length} Compostela customers`);
    return {
      success: true,
      recipientCount: compostelaUsers.length,
      fcmResponse
    };
    
  } catch (error) {
    console.error('❌ Error sending shop update to Compostela customers:', error);
    throw error;
  }
};

/**
 * Send reminder notifications for pending payments
 * @param {string} orderId - Laundry order ID
 */
export const sendPaymentReminder = async (orderId) => {
  try {
    const order = await LaundryOrder.findById(orderId)
      .populate('customerId', 'firstName lastName fcmToken')
      .populate('shopId', 'shopName');

    if (!order || order.payment.status === 'paid') {
      return; // No reminder needed
    }

    const customer = order.customerId;
    const shop = order.shopId;

    if (!customer || !customer.fcmToken) {
      console.warn('Customer not found or no FCM token available');
      return;
    }

    const notification = new LaundryNotification({
      recipientId: customer._id,
      recipientType: 'customer',
      orderId: order._id,
      orderNumber: order.orderNumber,
      type: 'payment_reminder',
      title: 'Payment Reminder',
      message: `Please complete payment for your laundry order ${order.orderNumber} - ₱${order.pricing.total}`,
      data: {
        shopName: shop.shopName,
        totalAmount: order.pricing.total,
        paymentMethod: order.payment.method
      }
    });

    try {
      const fcmResponse = await sendPushNotification(customer.fcmToken, {
        title: 'Payment Reminder',
        body: `Please complete payment for your laundry order ${order.orderNumber} - ₱${order.pricing.total}`,
        data: {
          type: 'laundry_payment_reminder',
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          totalAmount: order.pricing.total.toString()
        }
      });

      notification.status = 'sent';
      notification.sentAt = new Date();
      notification.fcmResponse = fcmResponse;
      
      if (fcmResponse.success) {
        notification.status = 'delivered';
        notification.deliveredAt = new Date();
        notification.fcmMessageId = fcmResponse.messageId;
      }
    } catch (fcmError) {
      console.error('❌ Error sending payment reminder FCM:', fcmError);
      notification.status = 'failed';
      notification.fcmResponse = { error: fcmError.message };
    }

    await notification.save();
    console.log(`✅ Payment reminder sent for order ${order.orderNumber}`);
    
  } catch (error) {
    console.error('❌ Error sending payment reminder:', error);
    throw error;
  }
};

/**
 * Get notification history for a user
 * @param {string} userId - User ID
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 */
export const getUserNotificationHistory = async (userId, page = 1, limit = 20) => {
  try {
    const notifications = await LaundryNotification.find({ recipientId: userId })
      .populate('orderId', 'orderNumber status pricing.total')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LaundryNotification.countDocuments({ recipientId: userId });

    return {
      notifications,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalNotifications: total
      }
    };
  } catch (error) {
    console.error('❌ Error fetching notification history:', error);
    throw error;
  }
};

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID (for verification)
 */
export const markNotificationAsRead = async (notificationId, userId) => {
  try {
    const notification = await LaundryNotification.findOneAndUpdate(
      { _id: notificationId, recipientId: userId },
      { readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      throw new Error('Notification not found or access denied');
    }

    return notification;
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    throw error;
  }
};