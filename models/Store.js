import mongoose from 'mongoose';

const storeSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  description: String,
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  logoUrl: String,
  bannerUrl: String,
  address: {
    street: String,
    city: String,
    province: String,
    postalCode: String,
    country: { type: String, default: 'Philippines' }
  },
  contactInfo: {
    phone: String,
    email: String,
    website: String
  },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  totalReviews: { type: Number, default: 0 },
  totalSales: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  categories: [String],
  bestSellers: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    imageUrl: String,
    price: Number,
    salesCount: Number
  }],
  storeType: { type: String, enum: ['individual', 'business'], default: 'business' }
}, { timestamps: true });

const Store = mongoose.model('Store', storeSchema);

export default Store;