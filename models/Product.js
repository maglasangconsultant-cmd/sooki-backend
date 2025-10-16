import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema({
  sellerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Seller", 
    required: [true, "Seller is required, boss! 👨‍💼"],
    index: true
  },
  name: { 
    type: String, 
    required: [true, "Product name is required, boss! 📝"], 
    trim: true, 
    maxlength: [100, "Product name too long, boss! 📏"],
    index: true
  },
  description: { 
    type: String, 
    default: "",
    maxlength: [1000, "Description too long, boss! Keep it concise 📝"]
  },
  price: { 
    type: Number, 
    required: [true, "Price is required, boss! 💰"], 
    min: [0, "Price cannot be negative, boss 😅"],
    index: true
  },
  originalPrice: {
    type: Number,
    min: [0, "Original price cannot be negative, boss 😅"]
  },
  discount: {
    type: Number,
    min: [0, "Discount cannot be negative, boss 😅"],
    max: [100, "Discount cannot exceed 100%, boss! 🤯"]
  },
  stock: { 
    type: Number, 
    default: 0, 
    min: [0, "Stock cannot be negative, boss 😅"] 
  },
  images: [{
    type: String,
    validate: {
      validator: function(v) {
        return !v || v.startsWith('http') || v.startsWith('data:');
      },
      message: "Image must be a valid URL or data URI, boss! 🖼️"
    }
  }],
  categories: [{
    type: String,
    trim: true,
    index: true
  }],
  addOns: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "AddOn" 
  }],
  relatedProducts: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Product" 
  }],
  rating: {
    type: Number,
    default: 0,
    min: [0, "Rating cannot be negative, boss! ⭐"],
    max: [5, "Rating cannot exceed 5 stars, boss! ⭐"]
  },
  totalReviews: {
    type: Number,
    default: 0,
    min: [0, "Total reviews cannot be negative, boss! 📊"]
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    index: true
  }],
  isActive: { 
    type: Boolean, 
    default: true,
    index: true
  },
  // Legacy support for migration
  seller: {
    _id: String,
    businessName: String,
    rating: Number,
    totalReviews: Number
  },
  category: {
    _id: String,
    name: String,
    slug: String
  }
}, { 
  timestamps: true,
  // Add compound indexes for better query performance
  index: [
    { sellerId: 1, isActive: 1 },
    { categories: 1, isActive: 1 },
    { price: 1, isActive: 1 },
    { tags: 1, isActive: 1 }
  ]
});

// Pre-save middleware to calculate discount if originalPrice is provided
ProductSchema.pre('save', function(next) {
  if (this.originalPrice && this.price && this.originalPrice > this.price) {
    this.discount = Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
  }
  next();
});

// Virtual for formatted price
ProductSchema.virtual('formattedPrice').get(function() {
  return `₱${this.price.toLocaleString()}`;
});

// Virtual for discount percentage
ProductSchema.virtual('discountPercentage').get(function() {
  if (this.originalPrice && this.price && this.originalPrice > this.price) {
    return Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
  }
  return 0;
});

// Method to check if product has active add-ons
ProductSchema.methods.hasActiveAddOns = async function() {
  if (!this.addOns || this.addOns.length === 0) return false;
  
  const AddOn = mongoose.model('AddOn');
  const activeAddOns = await AddOn.find({
    _id: { $in: this.addOns },
    isActive: true
  });
  
  return activeAddOns.length > 0;
};

// Static method to find products with add-ons
ProductSchema.statics.findWithAddOns = function(filter = {}) {
  return this.find({ ...filter, isActive: true })
    .populate({
      path: 'addOns',
      match: { isActive: true },
      select: 'name price image maxQuantity category'
    })
    .populate({
      path: 'relatedProducts',
      match: { isActive: true },
      select: 'name price images rating'
    });
};

export default mongoose.model("Product", ProductSchema);