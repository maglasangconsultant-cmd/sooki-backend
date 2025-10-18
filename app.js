
import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { initializeFirebase } from './firebase-config.js';
import { JWT_SECRET } from './config/authConfig.js';
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

const MPIN_MAX_ATTEMPTS = parseInt(process.env.MPIN_MAX_ATTEMPTS || '5', 10);
const MPIN_LOCK_MINUTES = parseInt(process.env.MPIN_LOCK_MINUTES || '15', 10);

const normalizePhoneNumber = (input = '') => {
  if (!input) return '';
  // Strip non-digits, keep last 11 digits for PH format
  const digitsOnly = input.replace(/\D/g, '');
  if (!digitsOnly) return '';
  if (digitsOnly.startsWith('63') && digitsOnly.length === 12) {
    return `0${digitsOnly.slice(2)}`;
  }
  if (digitsOnly.startsWith('9') && digitsOnly.length === 10) {
    return `0${digitsOnly}`;
  }
  return digitsOnly.length === 11 && digitsOnly.startsWith('0')
    ? digitsOnly
    : input.trim();
};

const buildUserPayload = (user) => ({
  _id: user._id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  userType: user.userType,
  isVerified: user.isVerified,
  phone: user.phone,
  phoneVerified: user.phoneVerified,
  securityMethod: user.securityMethod,
  biometricEnabled: user.biometricEnabled,
  mpinFailedAttempts: user.mpinFailedAttempts,
  mpinLockedUntil: user.mpinLockedUntil,
  addresses: user.addresses,
});

const issueTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user._id, email: user.email, phone: user.phone, userType: user.userType },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  const refreshToken = jwt.sign(
    { userId: user._id, email: user.email, phone: user.phone },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: 8 * 3600,
  };
};

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
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const passwordIsValid = user.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : true;

    if (!passwordIsValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const tokens = issueTokens(user);

    console.log(`✅ User ${email} logged in successfully`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: buildUserPayload(user),
      },
      tokens,
    });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

app.post('/auth/login-mpin', async (req, res) => {
  try {
    const { phone, mpin } = req.body;

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone || !mpin) {
      return res.status(400).json({ success: false, message: 'Phone and MPIN are required' });
    }

    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid phone or MPIN' });
    }

    if (user.mpinLockedUntil && user.mpinLockedUntil > new Date()) {
      return res.status(423).json({
        success: false,
        message: 'MPIN temporarily locked. Please try again later.',
        unlockAt: user.mpinLockedUntil,
      });
    }

    const mpinHash = user.mpinHash || user.pinHash;
    if (!mpinHash) {
      return res.status(409).json({ success: false, message: 'MPIN not set for this account' });
    }

    const isValidMpin = await bcrypt.compare(mpin, mpinHash);
    if (!isValidMpin) {
      const failedAttempts = (user.mpinFailedAttempts || 0) + 1;
      user.mpinFailedAttempts = failedAttempts;
      user.lastFailedMpinAt = new Date();

      if (failedAttempts >= MPIN_MAX_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + MPIN_LOCK_MINUTES * 60 * 1000);
        user.mpinLockedUntil = lockUntil;
        user.mpinFailedAttempts = 0;
        await user.save();
        return res.status(423).json({
          success: false,
          message: 'MPIN locked due to too many failed attempts',
          unlockAt: lockUntil,
        });
      }

      await user.save();
      const remainingAttempts = Math.max(MPIN_MAX_ATTEMPTS - failedAttempts, 0);
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or MPIN',
        remainingAttempts,
      });
    }

    if (!user.mpinHash && user.pinHash) {
      user.mpinHash = mpinHash;
      user.mpinSetAt = new Date();
    }

    user.mpinFailedAttempts = 0;
    user.mpinLockedUntil = null;
    user.lastMpinLoginAt = new Date();
    if (user.securityMethod !== 'biometric') {
      user.securityMethod = 'mpin';
    }
    await user.save();

    const tokens = issueTokens(user);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: buildUserPayload(user),
      },
      tokens,
    });
  } catch (err) {
    console.error('❌ MPIN login error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Register endpoint
app.post('/auth/register', async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      phone,
      password,
      address,
      addresses,
      dateOfBirth,
      fcmToken,
      userType = 'buyer',
      mpin,
      securityMethod = 'mpin',
    } = req.body;

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, message: 'Valid phone number is required' });
    }

    if (!mpin || !/^\d{4}$/.test(mpin)) {
      return res.status(400).json({ success: false, message: '4-digit MPIN is required' });
    }

    const existingPhone = await User.findOne({ phone: normalizedPhone });
    if (existingPhone) {
      return res.status(409).json({ success: false, message: 'Phone number already registered' });
    }

    if (email) {
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
      }
    }

    const addressRecords = [];
    if (Array.isArray(addresses) && addresses.length > 0) {
      addresses.forEach((item, index) => {
        if (item && typeof item === 'object') {
          addressRecords.push({
            ...item,
            isDefault: item.isDefault ?? index === 0,
          });
        }
      });
    } else if (address && typeof address === 'object') {
      addressRecords.push({
        ...address,
        isDefault: address.isDefault ?? true,
      });
    }

    const hashedMpin = await bcrypt.hash(mpin, 10);
    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

    const newUser = new User({
      email,
      firstName,
      lastName,
      phone: normalizedPhone,
      passwordHash: hashedPassword,
      dateOfBirth,
      userType,
      fcmToken,
      isVerified: false,
      phoneVerified: false,
      securityMethod: securityMethod === 'biometric' ? 'biometric' : 'mpin',
      biometricEnabled: securityMethod === 'biometric',
      mpinHash: hashedMpin,
      mpinSetAt: new Date(),
      addresses: addressRecords,
    });

    await newUser.save();

    const tokens = issueTokens(newUser);

    console.log(`✅ User ${normalizedPhone} registered successfully`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: buildUserPayload(newUser),
      },
      tokens,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const duplicatedField = Object.keys(err.keyValue || {})[0];
      return res.status(409).json({
        success: false,
        message: `${duplicatedField} already registered`,
      });
    }
    console.error('❌ Registration error:', err);
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

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-passwordHash -mpinHash -pinHash -refreshTokens');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        user: buildUserPayload(user)
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

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-passwordHash -mpinHash -pinHash -refreshTokens');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        user: {
          ...buildUserPayload(user),
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