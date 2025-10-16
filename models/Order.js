import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true },
        imageUrl: { type: String }
    }],
    status: {
        type: String,
        enum: ['pending', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'],
        default: 'pending',
        index: true
    },
    statusHistory: [{
        status: String,
        updatedBy: String,
        notes: String,
        updatedAt: { type: Date, default: Date.now }
    }],
    driverAssignment: {
        driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', index: true },
        assignedAt: { type: Date },
        notes: String,
        lastKnownLocation: {
            lat: { type: Number },
            lng: { type: Number },
            accuracy: { type: Number },
            updatedAt: { type: Date }
        }
    },
    buyerName: { type: String },
    productName: { type: String },
    productImageUrl: { type: String },
    quantity: { type: Number },
    totalAmount: { type: Number }
}, { timestamps: true });

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ sellerId: 1, status: 1 });
orderSchema.index({ 'driverAssignment.driverId': 1, status: 1 });

const Order = mongoose.model('Order', orderSchema);

export default Order;