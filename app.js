
import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { initializeFirebase } from './firebase-config.js';
import User from './models/User.js';
import orderRoutes from './routes/orderRoutes.js';
import fcmRoutes from './fcmRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import psgcRoutes from './psgcRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin SDK
const firebaseInitialized = initializeFirebase();
if (firebaseInitialized) {
  console.log('🔥 Firebase Admin SDK initialized');
} else {
  console.warn('⚠️  Firebase Admin SDK initialization failed - push notifications may not work');
}

app.use(cors());
app.use(bodyParser.json());

// Health check endpoint (works even if DB is down)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Database connection
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  console.error('Details:', err);
});

// Placeholder for routes - we will add them back as we remember them

// ==================== AUTH ENDPOINTS ====================
// Login endpoint
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // For now, accept any password (TODO: implement proper password verification)
    // TODO: In production, use bcrypt to hash and verify passwords
    
    // Generate JWT tokens
    const accessToken = jwt.sign(
      { userId: user._id, email: user.email, userType: user.userType },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '8h' }
    );

    const refreshToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    console.log(`✅ User ${email} logged in successfully`);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isVerified: user.isVerified,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 8 * 3600
      }
    });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Register endpoint
app.post('/auth/register', async (req, res) => {
  try {
    const { email, firstName, lastName, phone, address, dateOfBirth, fcmToken, userType = 'buyer' } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Create new user
    const newUser = new User({
      email,
      firstName,
      lastName,
      phone,
      address,
      dateOfBirth,
      userType,
      fcmToken,
      isVerified: false
    });

    await newUser.save();

    // Generate JWT tokens
    const accessToken = jwt.sign(
      { userId: newUser._id, email: newUser.email, userType: newUser.userType },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '8h' }
    );

    const refreshToken = jwt.sign(
      { userId: newUser._id, email: newUser.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    console.log(`✅ User ${email} registered successfully`);

    res.json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          _id: newUser._id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          userType: newUser.userType,
          isVerified: newUser.isVerified,
        }
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 8 * 3600
      }
    });
  } catch (err) {
    console.error('❌ Registration error:', err.message);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Get current user profile (protected)
app.get('/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          isVerified: user.isVerified,
          phone: user.phone,
          addresses: user.addresses
        }
      }
    });
  } catch (err) {
    console.error('❌ Auth/me error:', err.message);
    res.status(401).json({ success: false, message: 'Unauthorized', error: err.message });
  }
});

// Alias for /api/users/me (Flutter app expects this path)
app.get('/api/users/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          isVerified: user.isVerified,
          phone: user.phone,
          addresses: user.addresses,
          isSeller: user.isSeller || user.userType === 'seller',
          isDriver: user.isDriver || user.userType === 'driver'
        }
      }
    });
  } catch (err) {
    console.error('❌ API/users/me error:', err.message);
    res.status(401).json({ success: false, message: 'Unauthorized', error: err.message });
  }
});

// Placeholder for routes - we will add them back as we remember them

// Debug/Verification Endpoint (reconstructed)
app.get('/api/debug-info', async (req, res) => {
  try {
    const users = await User.find({});
    res.json({
      database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
      connectionState: mongoose.connection.readyState,
      totalUsers: users.length,
      users: users.map(user => ({
        id: user._id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching debug info:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.use('/api/orders', orderRoutes);
app.use('/api/fcm', fcmRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/psgc', psgcRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);

// 404 Not Found Middleware
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});