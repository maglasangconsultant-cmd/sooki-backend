import mongoose from 'mongoose';

const receiptsSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // Optional for backward compatibility
  customerInfo: {
    name: { type: String },
    phone: { type: String },
    email: { type: String }
  },
  receiptUrl: { type: String, required: true }, // gikan sa Cloudinary
  cloudinaryId: { type: String, required: true, unique: true, index: true }, // For deduplication
  totalAmount: { type: Number, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // Who uploaded the receipt
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'declined'], 
    default: 'pending',
    index: true 
  },
  uploadedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

receiptsSchema.index({ orderId: 1 });
receiptsSchema.index({ customerId: 1, status: 1 });
receiptsSchema.index({ uploadedAt: -1 });
receiptsSchema.index({ orderId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

const Receipt = mongoose.model('Receipt', receiptsSchema);

export default Receipt;