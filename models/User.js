import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true },
  firstName: String,
  lastName: String,
  phone: String,
  // Secure password storage
  passwordHash: { type: String },
  dateOfBirth: { type: Date },
  userType: { type: String, enum: ['buyer', 'seller'], default: 'buyer' },
  isVerified: { type: Boolean, default: false },
  fcmToken: { type: String }, // For push notifications
  addresses: [{
    type: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
    firstName: String,
    lastName: String,
    phone: String,
    address: String,
    city: String,
    province: String,
    postalCode: String,
    country: String,
    isDefault: { type: Boolean, default: false }
  }],
  // Seller-specific fields
  sellerInfo: {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  }
  ,
  // Biometric enrollment flag and optional device bindings (no sensitive data)
  biometricEnabled: { type: Boolean, default: false },
  biometricDevices: { type: [String], default: [] },
  securityMethod: {
    type: String,
    enum: ['biometric', 'pin', 'none'],
    default: 'none'
  },
  pinHash: { type: String },
  pinSetAt: { type: Date },
  // Refresh token store (hashed)
  refreshTokens: { type: [String], default: [] }
}, { timestamps: true });





const User = mongoose.model('User', userSchema);

export default User;