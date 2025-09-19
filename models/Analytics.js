import mongoose from 'mongoose';

const analyticsSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      'user_registration',
      'user_login',
      'product_view',
      'product_purchase',
      'order_placed',
      'order_completed',
      'seller_registration',
      'photo_upload',
      'review_added',
      'age_bracket_analysis'
    ]
  },
  userId: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Additional fields for specific analytics
  userAge: Number,
  ageBracket: {
    type: String,
    enum: ['18-25', '26-35', '36-45', '46-55', '56+']
  },
  orderValue: Number,
  productCategory: String
});

// Index for efficient querying
analyticsSchema.index({ eventType: 1, userId: 1, createdAt: -1 });
analyticsSchema.index({ ageBracket: 1, createdAt: -1 });

export default mongoose.model('Analytics', analyticsSchema);