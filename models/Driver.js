import mongoose from 'mongoose';

const driverSchema = new mongoose.Schema({
  email: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phone: { type: String },
  password: { type: String }, // NOTE: plain for now to match existing user auth pattern
  vehicleType: { type: String, enum: ['motorcycle', 'car', 'van', 'bicycle'], default: 'motorcycle' },
  plateNumber: { type: String },
  licenseNumber: { type: String },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
}, { timestamps: true });

driverSchema.index({ email: 1, status: 1 });

const Driver = mongoose.model('Driver', driverSchema);
export default Driver;