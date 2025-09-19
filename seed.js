import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// MongoDB Atlas connection URI
const uri = process.env.MONGO_URI;

mongoose.connect(uri)
  .then(() => console.log('✅ Connected to MongoDB Atlas!'))
  .catch(err => console.error('❌ Connection error:', err));

// ====== SCHEMAS ======

// Users
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  password: String,
  firstName: String,
  lastName: String,
  phone: String,
  userType: { type: String, enum: ['buyer', 'seller'] },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

// Products
const productSchema = new mongoose.Schema({
  name: { type: String, index: true },
  description: String,
  price: Number,
  originalPrice: Number,
  discount: Number,
  category: { 
    _id: { type: String, index: true }, 
    name: String, 
    slug: String 
  },
  seller: { 
    _id: String, 
    businessName: String, 
    rating: Number, 
    totalReviews: Number 
  },
  images: [String],
  stock: Number,
  rating: Number,
  totalReviews: Number,
  tags: [String],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
const Product = mongoose.model('Product', productSchema);

// Orders
const orderSchema = new mongoose.Schema({
  orderNumber: String,
  userId: { type: String, index: true },
  status: String,
  items: [{
    product: { _id: String, name: String },
    quantity: Number,
    unitPrice: Number,
    totalPrice: Number
  }],
  summary: {
    subtotal: Number,
    shippingFee: Number,
    tax: Number,
    discount: Number,
    total: Number
  },
  shippingAddress: {
    firstName: String,
    lastName: String,
    phone: String,
    address: String,
    city: String,
    province: String,
    postalCode: String,
    country: String
  },
  paymentMethod: String,
  paymentStatus: String,
  transactionId: String,
  trackingNumber: String,
  deliveredAt: Date
}, { timestamps: true });
const Order = mongoose.model('Order', orderSchema);

// ====== SEED DATA ======

async function seed() {
  try {
    await User.deleteMany({});
    await Product.deleteMany({});
    await Order.deleteMany({});

    // Sample Users
    const users = await User.insertMany([
      {
        email: 'buyer1@sooki.com',
        password: 'hashedpassword1',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+639123456789',
        userType: 'buyer',
        isVerified: true
      },
      {
        email: 'seller1@sooki.com',
        password: 'hashedpassword2',
        firstName: 'Alice',
        lastName: 'Smith',
        phone: '+639987654321',
        userType: 'seller',
        isVerified: true
      }
    ]);

    // Sample Products
    const products = await Product.insertMany([
      {
        name: 'iPhone 15 Pro Max',
        description: 'Latest iPhone with advanced features',
        price: 65999,
        originalPrice: 69999,
        discount: 5.71,
        category: { _id: 'electronics', name: 'Electronics', slug: 'electronics' },
        seller: { _id: users[1]._id, businessName: 'TechStore PH', rating: 4.8, totalReviews: 1250 },
        images: [
          'https://cdn.sooki.com/products/iphone15-1.webp',
          'https://cdn.sooki.com/products/iphone15-2.webp'
        ],
        stock: 25,
        rating: 4.7,
        totalReviews: 89,
        tags: ['smartphone', 'apple', '5g'],
        isActive: true
      }
    ]);

    // Sample Orders
    await Order.insertMany([
      {
        orderNumber: 'SK-2024-001234',
        userId: users[0]._id,
        status: 'delivered',
        items: [
          {
            product: { _id: products[0]._id, name: products[0].name },
            quantity: 1,
            unitPrice: products[0].price,
            totalPrice: products[0].price
          }
        ],
        summary: {
          subtotal: 65999,
          shippingFee: 0,
          tax: 7919.88,
          discount: 0,
          total: 73918.88
        },
        shippingAddress: {
          firstName: 'John',
          lastName: 'Doe',
          phone: '+639123456789',
          address: '123 Main St, Barangay Sample',
          city: 'Manila',
          province: 'Metro Manila',
          postalCode: '1000',
          country: 'Philippines'
        },
        paymentMethod: 'gcash',
        paymentStatus: 'completed',
        transactionId: 'gcash_txn_xyz123',
        trackingNumber: 'TRK123456789',
        deliveredAt: new Date()
      }
    ]);

    console.log('✅ Database seeded successfully!');
    process.exit();
  } catch (err) {
    console.error('❌ Seeding error:', err);
    process.exit(1);
  }
}

seed();