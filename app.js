
import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import http from 'http';
import { initializeFirebase } from './firebase-config.js';
import { JWT_SECRET } from './config/authConfig.js';
import User from './models/User.js';
import Seller from './models/Seller.js';
import orderRoutes from './routes/orderRoutes.js';
import fcmRoutes from './fcmRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import psgcRoutes from './psgcRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';
import { initializeLaundryWebSocket } from './websocket/laundryWebSocket.js';

dotenv.config();

// 🔍 GROK DEBUG: Enable Mongoose query logging to see raw MongoDB operations
mongoose.set('debug', true);

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
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  age: user.age || (user.dateOfBirth ? Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null),
  // ✅ Include seller/driver flags and IDs for frontend
  isSeller: user.isSeller || false,
  isDriver: user.isDriver || false,
  sellerId: user.sellerId || null,
  driverId: user.driverId || null,
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
      gender,
      fcmToken,
      userType = 'buyer',
      mpin,
      securityMethod = 'mpin',
    } = req.body;

    // DEBUG: Log registration data
    console.log('📝 Registration request:', {
      phone,
      dateOfBirth,
      gender,
      firstName,
      lastName
    });

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Uie ka Sooki! Palihug butang ug valid phone number ha? 😊' 
      });
    }

    if (!mpin || !/^\d{4}$/.test(mpin)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Palihug butang ug 4-digit MPIN para secure imong account! 🔒' 
      });
    }

    const existingPhone = await User.findOne({ phone: normalizedPhone });
    if (existingPhone) {
      return res.status(409).json({ 
        success: false, 
        message: 'Oops! Naa na ning number sa Sooki! Try to login nalang or use lain number? 😅' 
      });
    }

    if (email) {
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(409).json({ 
          success: false, 
          message: 'Naa na ni nga email sa Sooki! Nag-login nalang or lain email? 💚' 
        });
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
      gender,
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
      message: 'Welcome sa Sooki! Your account is ready na! 💚',
      data: {
        user: buildUserPayload(newUser),
      },
      tokens,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const duplicatedField = Object.keys(err.keyValue || {})[0];
      const friendlyFieldName = duplicatedField === 'phone' ? 'phone number' : duplicatedField;
      return res.status(409).json({
        success: false,
        message: `Uy! Naa na ning ${friendlyFieldName} sa Sooki! Nag-login nalang or lain ${friendlyFieldName}? 😊`,
      });
    }
    console.error('❌ Registration error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Pasensya brad/sis! May technical issue si Sooki karon. Try again later? 🙏',
      error: err.message 
    });
  }
});

// Register as Seller endpoint - The Sooki Promise: "We got you, promise." 🤝
app.post('/auth/register-seller', async (req, res) => {
  console.log('🎯 /auth/register-seller called'); // ✅ ADD LOGGING
  try {
    const {
      userId,
      email,
      firstName,
      lastName,
      phoneNumber,
      businessName,
      businessAddress,
      shopSameAsBusiness,
      hasPhysicalStore,
      shopName,
      shopAddress,
      shopLatitude,
      shopLongitude,
      categories,
      bio,
      paymentMethods,
      sellerAuthCode,
      deviceId,
      fcmToken,
      mpin // ✅ NEW: MPIN for verification gate
    } = req.body;

    console.log(`📧 Registering seller: ${email}`); // ✅ ADD LOGGING
    console.log(`📍 GPS: lat=${shopLatitude}, lng=${shopLongitude}`); // ✅ ADD LOGGING
    console.log(`🔐 MPIN provided: ${mpin ? 'YES' : 'NO'}`); // ✅ ADD LOGGING

    // Validate required fields
    if (!userId || !email || !firstName || !lastName || !phoneNumber) {
      console.log('❌ Missing required fields'); // ✅ ADD LOGGING
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, email, firstName, lastName, phoneNumber'
      });
    }

    // Validate Philippine phone number format
    if (!/^09\d{9}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Philippine phone number format (must be 09XXXXXXXXX)'
      });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // ✅ MPIN GATE: Verify MPIN if user has it set
    if (user.mpinHash && mpin) {
      const mpinValid = await bcrypt.compare(mpin, user.mpinHash);
      if (!mpinValid) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid MPIN. Please enter your correct MPIN to proceed.' 
        });
      }
      console.log('✅ MPIN verified for seller registration');
    } else if (user.mpinHash && !mpin) {
      return res.status(401).json({ 
        success: false, 
        message: 'MPIN required. Please enter your MPIN to register as seller.' 
        });
    }

    // Check if user is already a seller
    if (user.isSeller) {
      return res.status(409).json({ success: false, message: 'User is already registered as a seller' });
    }

    // Check if seller with this phone already exists
    const existingSeller = await Seller.findOne({ phoneNumber });
    if (existingSeller) {
      return res.status(409).json({ success: false, message: 'Phone number already registered as seller' });
    }

    // Hash seller auth code if provided
    let hashedAuthCode = null;
    if (sellerAuthCode) {
      hashedAuthCode = await bcrypt.hash(sellerAuthCode, 10);
    }

    // Prepare shop address (use business address if shopSameAsBusiness)
    let finalShopAddress = null;
    if (hasPhysicalStore) {
      if (shopSameAsBusiness && businessAddress) {
        finalShopAddress = businessAddress;
      } else if (shopAddress) {
        finalShopAddress = shopAddress;
      }
    }

    // Create new seller
    const sellerData = {
      userId: user._id,
      email,
      firstName,
      lastName,
      phoneNumber,
      businessName: businessName || shopName || 'My Business',
      businessAddress: businessAddress || {
        street: 'TBD',
        barangay: 'TBD',
        city: 'TBD',
        province: 'TBD',
        country: 'Philippines'
      },
      hasPhysicalStore: hasPhysicalStore || false,
      shopName: hasPhysicalStore ? (shopName || businessName) : undefined,
      shopAddress: finalShopAddress,
      categories: categories || [],
      bio: bio || '',
      paymentMethods: paymentMethods || [],
      sellerAuthCodeHash: hashedAuthCode,
      deviceBindings: deviceId ? [{
        deviceId,
        boundAt: new Date(),
        lastAuthAt: new Date()
      }] : [],
      lastDeviceAuthAt: deviceId ? new Date() : undefined,
      fcmToken: fcmToken || user.fcmToken,
      isVerified: false,
      registrationDate: new Date()
    };

    // ✅ Add GPS location if coordinates provided
    if (shopLatitude != null && shopLongitude != null) {
      sellerData.location = {
        type: 'Point',
        coordinates: [shopLongitude, shopLatitude] // GeoJSON format: [lng, lat]
      };
      console.log(`📍 GPS Location set: ${shopLatitude}, ${shopLongitude}`); // ✅ ADD LOGGING
    } else {
      console.log('⚠️  No GPS coordinates provided'); // ✅ ADD LOGGING
    }

    const newSeller = new Seller(sellerData);

    await newSeller.save();
    console.log(`✅ Seller document created: ${newSeller._id} (type: ${typeof newSeller._id}, valid: ${mongoose.Types.ObjectId.isValid(newSeller._id)})`);

    // 🔍 GROK FIX: Fetch FRESH user instance to avoid stale state issues
    const freshUser = await User.findById(user._id);
    if (!freshUser) {
      return res.status(404).json({ success: false, message: 'User not found after seller creation' });
    }

    // ✅ CRITICAL: Update user via sellerInfo (nested schema)
    freshUser.userType = 'seller';
    freshUser.sellerInfo = { sellerId: newSeller._id };

    console.log(`🔍 Pre-save check: userType=${freshUser.userType}, sellerInfo.sellerId=${freshUser.sellerInfo?.sellerId}`);

    // 🔍 GROK FIX: Force mark fields as modified
    freshUser.markModified('sellerInfo');
    freshUser.markModified('userType');

    await freshUser.save({ validateModifiedOnly: true });
    console.log(`✅ User saved: userType=${freshUser.userType}, sellerInfo.sellerId=${freshUser.sellerInfo?.sellerId}`);

    // 🔍 GROK FIX: IMMEDIATE DB VERIFY
    const dbVerify = await User.findById(freshUser._id).select('userType sellerInfo email');
    console.log(`🗄️ DB IMMEDIATE CHECK: ${JSON.stringify(dbVerify)}`);

    // Issue new tokens with updated user status
    const tokens = issueTokens(freshUser);

    console.log(`✅ Seller ${phoneNumber} (${businessName || shopName}) registered successfully`);
    console.log(`📍 GPS Location: ${shopLatitude}, ${shopLongitude}`);

    res.status(201).json({
      success: true,
      message: 'Seller registered successfully! Sooki will handle the rest — PROMISE. 🤝',
      data: {
        seller: {
          _id: newSeller._id,
          userId: newSeller.userId,
          email: newSeller.email,
          firstName: newSeller.firstName,
          lastName: newSeller.lastName,
          phoneNumber: newSeller.phoneNumber,
          businessName: newSeller.businessName,
          shopName: newSeller.shopName,
          hasPhysicalStore: newSeller.hasPhysicalStore,
          categories: newSeller.categories,
          isVerified: newSeller.isVerified,
          registrationDate: newSeller.registrationDate
        },
        user: {
          ...buildUserPayload(user),
          isSeller: true
        }
      },
      tokens
    });
  } catch (err) {
    if (err?.code === 11000) {
      const duplicatedField = Object.keys(err.keyValue || {})[0];
      return res.status(409).json({
        success: false,
        message: `${duplicatedField} already registered as seller`
      });
    }
    console.error('❌ Seller registration error:', err);
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

// FIX: Sync isSeller flag for existing sellers
app.post('/api/fix-seller-flag', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    // Find the user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if they have a Seller document
    const seller = await Seller.findOne({ userId: user._id });
    if (!seller) {
      return res.status(404).json({ 
        success: false, 
        message: 'No seller document found for this user' 
      });
    }

    console.log(`🔧 Fixing isSeller flag for ${email}`);
    console.log(`   Before: isSeller=${user.isSeller}, userType=${user.userType}, sellerId=${user.sellerId}`);

    // Update the flags AND link sellerId
    user.isSeller = true;
    user.userType = 'seller';
    user.sellerId = seller._id; // ✅ LINK to Seller document
    await user.save();

    console.log(`   After: isSeller=${user.isSeller}, userType=${user.userType}, sellerId=${user.sellerId}`);
    console.log(`   ✅ Fixed!`);

    res.json({ 
      success: true, 
      message: 'User flags updated successfully',
      data: {
        email: user.email,
        isSeller: user.isSeller,
        userType: user.userType,
        sellerId: seller._id
      }
    });
  } catch (error) {
    console.error('❌ Fix seller flag error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// DEBUG: Check user state
app.post('/api/debug-user', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const seller = await Seller.findOne({ userId: user._id });

    res.json({
      success: true,
      user: {
        email: user.email,
        isSeller: user.isSeller,
        userType: user.userType,
        sellerId: user.sellerId,
      },
      seller: seller ? {
        _id: seller._id,
        businessName: seller.businessName,
        shopName: seller.shopName,
      } : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// RESET: Remove seller status for testing
app.post('/api/reset-seller', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    // Find the user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log(`🗑️  Resetting seller status for ${email}`);

    // Delete Seller document
    const deleteResult = await Seller.deleteOne({ userId: user._id });
    console.log(`   Deleted ${deleteResult.deletedCount} Seller document(s)`);

    // Reset User flags
    user.isSeller = false;
    user.userType = 'buyer';
    await user.save();

    console.log(`   ✅ User reset! Now can register as seller again with MPIN gate`);

    res.json({ 
      success: true, 
      message: 'Seller status reset successfully. You can now register as seller again.',
      data: {
        email: user.email,
        isSeller: user.isSeller,
        userType: user.userType,
        deletedSellers: deleteResult.deletedCount
      }
    });
  } catch (error) {
    console.error('❌ Reset seller error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
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

// Create HTTP server and initialize WebSocket
const server = http.createServer(app);

// Initialize Socket.IO for laundry service
try {
  initializeLaundryWebSocket(server);
  console.log('✅ Laundry WebSocket initialized');
} catch (error) {
  console.error('❌ Failed to initialize Laundry WebSocket:', error);
}

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Laundry Socket: ws://localhost:${PORT}/laundry-socket`);
});

// ==================== ERROR HANDLERS ====================
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit - let the process continue
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit - let the process continue
});

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});
// 🔍 TEST: Identify which repo Render is using
app.get('/api/test-repo-identity', (req, res) => {
  res.json({
    success: true,
    repoSource: 'STANDALONE_TMP_SOOKI_BACKEND',
    timestamp: new Date().toISOString(),
    message: 'This is from /tmp/sooki-backend repo'
  });
});
