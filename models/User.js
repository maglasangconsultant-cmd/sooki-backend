import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, trim: true, lowercase: true },
  firstName: String,
  lastName: String,
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  // Secure password storage
  passwordHash: { type: String },
  dateOfBirth: { type: Date },
  age: { type: Number, required: false }, // Optional: can be calculated from dateOfBirth
  gender: { type: String, enum: ['male', 'female', 'other'], required: false },
  userType: { type: String, enum: ['buyer', 'seller'], default: 'buyer' },
  isVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
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
    enum: ['biometric', 'mpin', 'pin', 'none'],
    default: 'none'
  },
  mpinHash: { type: String },
  mpinSetAt: { type: Date },
  // Legacy compatibility: retain pinHash while rolling out mpinHash
  pinHash: { type: String },
  pinSetAt: { type: Date },
  mpinFailedAttempts: { type: Number, default: 0 },
  mpinLockedUntil: { type: Date },
  lastMpinLoginAt: { type: Date },
  lastFailedMpinAt: { type: Date },
  // Refresh token store (hashed)
  refreshTokens: { type: [String], default: [] }
}, { timestamps: true });



userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });

// Virtual field: Calculate age from dateOfBirth dynamically
userSchema.virtual('calculatedAge').get(function() {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  let age = today.getFullYear() - this.dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - this.dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < this.dateOfBirth.getDate())) {
    age--;
  }
  return age;
});

// Include virtuals in JSON responses
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });




const User = mongoose.model('User', userSchema);

export default User;