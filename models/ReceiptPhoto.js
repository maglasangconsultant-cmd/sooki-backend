import mongoose from 'mongoose';

const receiptsPhotosSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  photoUrl: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending',
    index: true
  },
  uploadedAt: { type: Date, default: Date.now, index: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

receiptsPhotosSchema.index({ orderId: 1, status: 1 });
receiptsPhotosSchema.index({ userId: 1, uploadedAt: -1 });

const ReceiptPhoto = mongoose.model('ReceiptPhoto', receiptsPhotosSchema, 'receipts_photos');

export default ReceiptPhoto;