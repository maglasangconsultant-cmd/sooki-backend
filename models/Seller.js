import mongoose from 'mongoose';

const sellerSchema = new mongoose.Schema({
  // Link to user account (required to satisfy unique index and relations)
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Basic info
  email: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phoneNumber: {
    type: String,
    match: /^09\d{9}$/, // Philippine mobile number 11 digits starting with 09
    required: true
  },

  // Business info (legal entity)
  businessName: { type: String },
  businessAddress: {
    street: { type: String, required: true },
    barangay: { type: String, required: true },
    city: { type: String, required: true },
    province: { type: String, required: true },
    zipCode: { type: String },
    country: { type: String, default: "Philippines" }
  },

  // Shop info (physical store)
  hasPhysicalStore: { type: Boolean, default: false },
  shopName: { type: String, required: function () { return this.hasPhysicalStore; } },
  shopAddress: {
    street: { type: String },
    barangay: { type: String },
    city: { type: String },
    province: { type: String },
    zipCode: { type: String },
    country: { type: String, default: "Philippines" }
  },

  // Categories & description
  categories: [String],
  bio: String,

  // Geolocation for fast driver matching (optional)
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined } // [lng, lat]
  },

  // Seller auth code (hashed)
  sellerAuthCodeHash: { type: String, default: null },

  // Device binding for seller security
  deviceBindings: [{
    deviceId: { type: String },
    boundAt: { type: Date, default: Date.now },
    lastAuthAt: { type: Date }
  }],
  lastDeviceAuthAt: { type: Date },

  // Payment info (bank, GCash, Maya)
  paymentMethods: [{
    type: { type: String, enum: ['bank', 'gcash', 'maya'], required: true },
    accountName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    bankName: { type: String } // only required if type === 'bank'
  }],

  // Add-ons (optional quick access array for small sellers)
  addOns: [{
    name: String,
    price: Number,
    image: String,
    category: String,
    isActive: { type: Boolean, default: true }
  }],

  // System info
  registrationDate: { type: Date, default: Date.now },
  isVerified: { type: Boolean, default: false },
  fcmToken: { type: String }      // for push notifications
}, { timestamps: true });

// Indexes for faster queries
sellerSchema.index({ userId: 1 });

sellerSchema.index({ 'deviceBindings.deviceId': 1 });

// Geospatial index for location-based queries
sellerSchema.index({ location: '2dsphere' });

const Seller = mongoose.model('Seller', sellerSchema);
export default Seller;