import mongoose from 'mongoose';

// AddOn Schema - For product add-ons and extras
const addOnSchema = new mongoose.Schema({
  sellerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Seller', 
    required: true, 
    index: true 
  },
  name: {
    type: String,
    required: [true, "Add-on name is required, boss 😅"],
    trim: true,
    maxlength: [50, "Add-on name too long, boss! 📏"]
  },
  price: {
    type: Number,
    required: [true, "Add-on price is required, boss 😅"],
    min: [0, "Price cannot be negative, boss 😅"],
    max: [5000, "Add-on price too high, boss! Keep it reasonable 😱"]
  },
  category: { 
    type: String, 
    default: "general" 
  }, // Optional grouping (Food, Accessories, Services)
  image: {
    type: String,
    default: null,
    validate: {
      validator: function(v) {
        return !v || v.startsWith('http'); // URL validation if provided
      },
      message: "Image must be a valid URL, boss! 🖼️"
    }
  },
  maxQuantity: { 
    type: Number, 
    default: 10 
  }, // Max units per order
  isActive: { 
    type: Boolean, 
    default: true 
  }, // Enable/disable without deleting
}, { 
  timestamps: true 
});

// Index for efficient queries
addOnSchema.index({ sellerId: 1, isActive: 1 });
addOnSchema.index({ category: 1, isActive: 1 });
addOnSchema.index({ price: 1 });

// Virtual for formatted price
addOnSchema.virtual('formattedPrice').get(function() {
  return `₱${this.price.toFixed(2)}`;
});

// Method to check if add-on is available
addOnSchema.methods.isAvailable = function() {
  return this.isActive && this.maxQuantity > 0;
};

// Static method to find active add-ons by seller
addOnSchema.statics.findActiveBySeller = function(sellerId) {
  return this.find({ 
    sellerId: sellerId, 
    isActive: true 
  }).sort({ name: 1 });
};

// Static method to find add-ons by category
addOnSchema.statics.findByCategory = function(category, isActive = true) {
  const query = { category };
  if (isActive !== null) {
    query.isActive = isActive;
  }
  return this.find(query).sort({ price: 1 });
};

const AddOn = mongoose.model('AddOn', addOnSchema);

export default AddOn;