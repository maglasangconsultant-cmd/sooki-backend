/**
 * Mongoose Models for Laundry Service Module
 * Based on the schemas defined in laundry_service_schemas.md
 */

import mongoose from 'mongoose';

// Laundry Shop Schema
const laundryShopSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shopName: { type: String, required: true },
  businessLicense: { type: String, required: true },
  
  // Location-based restrictions
  location: {
    address: { type: String, required: true },
    city: { type: String, required: true }, // Must be "Compostela"
    province: { type: String, required: true }, // Must be "Davao de Oro"
    country: { type: String, default: "Philippines" },
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    serviceRadius: { type: Number, default: 5 } // km radius for pickup/delivery
  },
  
  // Contact Information
  contact: {
    phone: { type: String, required: true },
    email: String,
    whatsapp: String
  },
  
  // Business Details
  services: [{
    name: { type: String, required: true }, // "Wash & Fold", "Dry Cleaning", "Ironing"
    pricePerKg: { type: Number, required: true },
    minimumKg: { type: Number, default: 1 },
    estimatedHours: { type: Number, required: true } // Processing time in hours
  }],
  
  // Operating Hours
  operatingHours: {
    monday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    tuesday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    wednesday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    thursday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    friday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    saturday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    sunday: { open: String, close: String, isOpen: { type: Boolean, default: false } }
  },
  
  // Ratings and Reviews
  rating: { type: Number, default: 0, min: 0, max: 5 },
  totalReviews: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  
  // Status
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  verificationDate: Date,
  
  // FCM for notifications
  fcmToken: String,
  
}, { timestamps: true });

// Indexes for location-based queries
laundryShopSchema.index({ ownerId: 1 });
laundryShopSchema.index({ shopName: 1 });
laundryShopSchema.index({ "location.city": 1, "location.province": 1 });
laundryShopSchema.index({ "location.coordinates": "2dsphere" });
laundryShopSchema.index({ isActive: 1, isVerified: 1 });

// Laundry Shop Branch Schema
const laundryBranchSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'LaundryShop', required: true },
  branchName: { type: String, required: true },
  
  // Location
  location: {
    address: { type: String, required: true },
    city: { type: String, required: true },
    province: { type: String, required: true },
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  
  // Branch-specific details
  capacity: {
    maxOrdersPerDay: { type: Number, default: 50 },
    currentOrders: { type: Number, default: 0 }
  },
  
  // Staff
  staff: [{
    name: String,
    role: { type: String, enum: ['manager', 'washer', 'delivery'] },
    phone: String,
    isActive: { type: Boolean, default: true }
  }],
  
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

laundryBranchSchema.index({ shopId: 1 });
laundryBranchSchema.index({ "location.city": 1, "location.province": 1 });

// Laundry Order Schema
const laundryOrderSchema = new mongoose.Schema({
  orderNumber: { type: String }, // "LND-2024-001"
  
  // Customer Information
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  
  // Laundry Shop Information
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'LaundryShop', required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'LaundryBranch' },
  
  // Service Details
  services: [{
    serviceType: { type: String, required: true }, // "Wash & Fold", "Dry Cleaning"
    weight: { type: Number, required: true }, // in kg
    pricePerKg: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    specialInstructions: String
  }],
  
  // Pickup & Delivery
  pickup: {
    address: { type: String, required: true },
    scheduledDate: { type: Date, required: true },
    scheduledTime: String, // "9:00 AM - 11:00 AM"
    actualPickupTime: Date,
    pickedUpBy: String, // Staff name
    notes: String
  },
  
  delivery: {
    address: { type: String, required: true },
    scheduledDate: Date,
    scheduledTime: String,
    actualDeliveryTime: Date,
    deliveredBy: String,
    receivedBy: String,
    notes: String
  },
  
  // Weight Tracking
  weightTracking: {
    estimatedWeight: Number, // Customer's estimate
    actualWeight: Number, // Measured at shop
    weightDifference: Number, // Actual - Estimated
    weightConfirmedByCustomer: { type: Boolean, default: false }
  },
  
  // Pricing
  pricing: {
    subtotal: { type: Number, required: true },
    pickupFee: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    additionalCharges: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true }
  },
  
  // Status Tracking
  status: {
    type: String,
    enum: [
      'pending',           // Order placed, waiting for pickup
      'pickup_scheduled',  // Pickup time confirmed
      'picked_up',        // Items collected from customer
      'in_process',       // Being washed/cleaned
      'ready',            // Finished, ready for delivery
      'out_for_delivery', // On the way to customer
      'delivered',        // Completed successfully
      'cancelled',        // Order cancelled
      'disputed'          // Issue with order
    ],
    default: 'pending'
  },

  // Driver Assignment
  driverAssignment: {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
    assignedAt: { type: Date },
    notes: String
  },
  
  // Status History for tracking
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    updatedBy: String, // Staff name or system
    notes: String
  }],
  
  // Payment
  payment: {
    method: { type: String, enum: ['cash', 'gcash', 'bank_transfer'], default: 'cash' },
    status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
    paidAt: Date,
    receiptUrl: String
  },
  
  // Special Requirements
  specialRequirements: {
    fragileItems: { type: Boolean, default: false },
    allergyNotes: String,
    preferredDetergent: String,
    rushOrder: { type: Boolean, default: false }
  },
  
  // Estimated completion
  estimatedCompletion: Date,
  actualCompletion: Date,
  
  // Customer feedback
  customerRating: { type: Number, min: 1, max: 5 },
  customerReview: String,
  reviewDate: Date,
  
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Indexes for efficient queries
laundryOrderSchema.index({ customerId: 1, createdAt: -1 });
laundryOrderSchema.index({ shopId: 1, status: 1 });
laundryOrderSchema.index({ 'driverAssignment.driverId': 1, status: 1 });
laundryOrderSchema.index({ status: 1, "pickup.scheduledDate": 1 });
laundryOrderSchema.index({ orderNumber: 1 }, { unique: true });

// Pre-save middleware to generate order number
laundryOrderSchema.pre('save', async function(next) {
  if (this.isNew && !this.orderNumber) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('LaundryOrder').countDocuments({
      createdAt: {
        $gte: new Date(year, 0, 1),
        $lt: new Date(year + 1, 0, 1)
      }
    });
    this.orderNumber = `LND-${year}-${String(count + 1).padStart(3, '0')}`;
  }
  next();
});

// Laundry Notification Schema
const laundryNotificationSchema = new mongoose.Schema({
  // Recipients
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipientType: { type: String, enum: ['customer', 'shop_owner'], required: true },
  
  // Related Order
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'LaundryOrder', required: true },
  orderNumber: String,
  
  // Notification Content
  type: {
    type: String,
    enum: [
      'order_confirmed',
      'pickup_scheduled',
      'picked_up',
      'weight_confirmed',
      'in_process',
      'ready_for_delivery',
      'out_for_delivery',
      'delivered',
      'payment_reminder',
      'review_request'
    ],
    required: true
  },
  
  title: { type: String, required: true },
  message: { type: String, required: true },
  
  // Notification Status
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending'
  },
  
  // Delivery Details
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  
  // FCM Details
  fcmMessageId: String,
  fcmResponse: Object,
  
  // Additional Data
  data: {
    shopName: String,
    estimatedCompletion: Date,
    totalAmount: Number,
    pickupTime: String,
    deliveryTime: String
  }
}, { timestamps: true });

// Indexes
laundryNotificationSchema.index({ recipientId: 1, createdAt: -1 });
laundryNotificationSchema.index({ orderId: 1 });
laundryNotificationSchema.index({ type: 1, status: 1 });

// Create and export models
const LaundryShop = mongoose.model('LaundryShop', laundryShopSchema);
const LaundryBranch = mongoose.model('LaundryBranch', laundryBranchSchema);
const LaundryOrder = mongoose.model('LaundryOrder', laundryOrderSchema);
const LaundryNotification = mongoose.model('LaundryNotification', laundryNotificationSchema);

export {
  LaundryShop,
  LaundryBranch,
  LaundryOrder,
  LaundryNotification
};