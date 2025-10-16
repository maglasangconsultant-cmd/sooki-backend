import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subtitle: String,
  imageUrl: String,
  targetUrl: String, // Where the banner should redirect
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' }, // Optional - for store-specific banners
  isActive: { type: Boolean, default: true },
  startDate: { type: Date, default: Date.now },
  endDate: Date,
  priority: { type: Number, default: 0 }, // Higher priority banners show first
  clickCount: { type: Number, default: 0 },
  impressionCount: { type: Number, default: 0 },
  bannerType: { 
    type: String, 
    enum: ['promotional', 'store_feature', 'product_highlight', 'seasonal'], 
    default: 'promotional' 
  }
}, { timestamps: true });

const Banner = mongoose.model('Banner', bannerSchema);

export default Banner;