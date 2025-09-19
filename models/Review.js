import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    required: true,
    maxlength: 1000
  },
  // Additional fields for better functionality
  userName: {
    type: String,
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  verified: {
    type: Boolean,
    default: false // Set to true only if user has purchased the product
  },
  helpful: {
    type: Number,
    default: 0 // Count of users who found this review helpful
  },
  orderId: {
    type: String,
    required: false // Optional field to link review to specific order
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Remove the unique constraint on productId + userId to allow multiple reviews per product per user (for different orders)
// Instead, create a compound index for orderId-based uniqueness when orderId is present
reviewSchema.index({ productId: 1, userId: 1, orderId: 1 }, { 
  unique: true, 
  partialFilterExpression: { orderId: { $exists: true, $ne: null } }
});

// Keep the original index for backward compatibility with reviews without orderId
reviewSchema.index({ productId: 1, userId: 1 }, { 
  unique: true, 
  partialFilterExpression: { orderId: { $exists: false } }
});

// Index for efficient querying
reviewSchema.index({ productId: 1, createdAt: -1 });
reviewSchema.index({ rating: -1 });

// Update the updatedAt field before saving
reviewSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Review', reviewSchema);