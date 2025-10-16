import mongoose from 'mongoose';

const photoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', index: true }, // Optional - for product photos
  url: { type: String, required: true }, // CDN, S3, or local storage URL
  uploadedAt: { type: Date, default: Date.now, index: true },
  status: { 
    type: String, 
    enum: ['active', 'deleted', 'flagged'], 
    default: 'active',
    index: true 
  },
  deletedAt: { type: Date }, // Only set when status = 'deleted'
  notes: { type: String } // For helpdesk remarks
}, { timestamps: true });

photoSchema.index({ userId: 1, status: 1 });
photoSchema.index({ productId: 1, status: 1 });
photoSchema.index({ uploadedAt: -1 });

const Photo = mongoose.model('Photo', photoSchema);

export default Photo;