import express from 'express';
import mongoose from 'mongoose';
import User from './models/User.js';
import Order from './models/Order.js';
import Notification from './models/Notification.js';
import Receipts from './models/Receipt.js'; // Assuming Receipts model is needed
import { sendPushNotification } from './services/fcmService.js';
import { authenticateUser } from './middleware/authenticateUser.js';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storagePaymentReceipt = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'payment_receipts',
    format: async (req, file) => 'png', // supports promises as well
    public_id: (req, file) => `receipt-${Date.now()}-${file.originalname}`,
  },
});

const uploadPaymentReceipt = multer({ storage: storagePaymentReceipt });

const router = express.Router();

// Create payment verification request (temporary order)
router.post('/payment-verification-request', async (req, res) => {
  try {
    console.log('💳 Received payment verification request:', JSON.stringify(req.body, null, 2));
    
    const { 
      userId, 
      sellerId, 
      items, 
      paymentReceiptUrl, 
      deliveryAddress,
      customerName,
      paymentMethod,
      summary 
    } = req.body;
    
    // Validate required fields
    if (!userId || !sellerId || !items || !paymentReceiptUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, sellerId, items, paymentReceiptUrl'
      });
    }
    
    // Create temporary order with payment_uploaded status
    // Generate order number first
    const tempOrderId = new mongoose.Types.ObjectId();
    const orderNumber = `#ORD${tempOrderId.toString().slice(-6).toUpperCase()}`;
    
    const tempOrderData = {
      _id: tempOrderId,
      userId,
      sellerId,
      items: items.map(item => ({
        product: {
          _id: item.productId || item.product?._id,
          name: item.name || item.product?.name || 'Unknown Product'
        },
        quantity: item.quantity,
        unitPrice: item.price || item.unitPrice,
        totalPrice: (item.price || item.unitPrice) * item.quantity
      })),
      orderNumber,
      paymentReceiptUrl,
      deliveryAddress,
      customerName,
      paymentMethod,
      summary,
      status: 'payment_uploaded', // Initial status
      orderDate: new Date(),
      paymentDetails: {
        method: paymentMethod,
        status: 'pending_verification',
        receiptUrl: paymentReceiptUrl
      }
    };

    const newOrder = await Order.create(tempOrderData);

    // Notify seller about new payment verification request
    const seller = await User.findById(sellerId);
    if (seller && seller.fcmToken) {
      const notificationTitle = 'New Payment Verification Request';
      const notificationBody = `Order ${orderNumber} from ${customerName} requires your verification.`;
      await sendPushNotification(seller.fcmToken, notificationTitle, notificationBody, { orderId: newOrder._id.toString(), type: 'payment_verification' });
    }

    // Create a notification record
    await Notification.create({
      userId: sellerId,
      type: 'payment_verification',
      message: `Order ${orderNumber} from ${customerName} requires your verification.`, 
      link: `/seller/orders/${newOrder._id}`,
      isRead: false,
      date: new Date()
    });

    console.log(`✅ [Payment] Payment verification request created for order ${orderNumber}`);
    res.status(201).json({
      success: true,
      message: 'Payment verification request created successfully',
      order: newOrder
    });

  } catch (error) {
    console.error('❌ [Payment] Error creating payment verification request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment verification request'
    });
  }
});

router.get('/verification/pending', async (req, res) => {
  try {
    console.log('🔍 Fetching pending receipts for payment verification...');
    
    // Find all pending receipts and populate order details
    const receipts = await Receipts.find({ status: 'pending' })
      .populate({
        path: 'orderId',
        select: 'items totalAmount paymentStatus status orderNumber customerId sellerId',
        populate: {
          path: 'items.productId',
          select: 'name price productImage'
        }
      })
      .populate({
        path: 'customerId',
        select: 'name email phone'
      })
      .sort({ uploadedAt: -1 }) // Most recent first
      .exec();
    
    console.log(`✅ Found ${receipts.length} pending receipts for verification`);
    
    // Format response for frontend
    const formattedReceipts = receipts.map(receipt => ({
      _id: receipt._id,
      receiptUrl: receipt.receiptUrl,
      totalAmount: receipt.totalAmount,
      status: receipt.status,
      uploadedAt: receipt.uploadedAt,
      customer: receipt.customerId ? {
        _id: receipt.customerId._id,
        name: receipt.customerId.name,
        email: receipt.customerId.email,
        phone: receipt.customerId.phone
      } : null,
      order: receipt.orderId ? {
        _id: receipt.orderId._id,
        orderNumber: receipt.orderId.orderNumber,
        items: receipt.orderId.items,
        totalAmount: receipt.orderId.totalAmount,
        paymentStatus: receipt.orderId.paymentStatus,
        status: receipt.orderId.status,
        sellerId: receipt.orderId.sellerId
      } : null
    }));
    
    res.json({
      success: true,
      receipts: formattedReceipts,
      count: formattedReceipts.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching pending receipts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/pending', async (req, res) => {
  try {
    console.log('🔍 Fetching pending receipts...');
    
    // Fetch all receipts where status = "pending"
    const pendingReceipts = await Receipts.find({ status: 'pending' })
      .populate({
        path: 'orderId',
        select: 'items totalAmount paymentStatus',
        populate: {
          path: 'items.productId',
          select: 'name price'
        }
      })
      .populate({
        path: 'customerId',
        select: 'name email'
      })
      .sort({ uploadedAt: -1 }); // Most recent first
    
    console.log(`✅ Found ${pendingReceipts.length} pending receipts`);
    
    // Format the response with receipt data + minimal order info
    const formattedReceipts = pendingReceipts
      .filter(receipt => receipt.orderId && receipt.customerId) // Filter out receipts with null references
      .map(receipt => ({
        _id: receipt._id,
        orderId: receipt.orderId._id,
        customerId: receipt.customerId._id,
        totalAmount: receipt.totalAmount,
        status: receipt.status,
        uploadedAt: receipt.uploadedAt,
        receiptUrl: receipt.receiptUrl,
        customerName: receipt.customerId.name,
        customerEmail: receipt.customerId.email,
        orderTotalAmount: receipt.orderId.totalAmount,
        orderPaymentStatus: receipt.orderId.paymentStatus,
        orderItems: receipt.orderId.items.map(item => ({
          productId: item.productId._id,
          productName: item.productId.name,
          price: item.productId.price,
          quantity: item.quantity
        }))
      }));

    res.json({ success: true, pendingReceipts: formattedReceipts });
  } catch (error) {
    console.error('Error fetching pending receipts:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pending receipts', error: error.message });
  }
});

router.post('/uploadReceipt', uploadPaymentReceipt.single('file'), async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  try {
    console.log(`🚀 [${requestId}] UPLOAD RECEIPT REQUEST - ${new Date().toISOString()}`);
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No receipt file provided'
      });
    }

    // Extract required fields from request body
    const { orderId, customerId, totalAmount } = req.body;
    
    // Validate required fields
    if (!orderId || !customerId || !totalAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderId, customerId, totalAmount'
      });
    }
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid orderId or customerId format'
      });
    }
    
    // Validate totalAmount
    const amount = parseFloat(totalAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid totalAmount - must be a positive number'
      });
    }
    
    // Upload image to Cloudinary → get secure_url
    const receiptUrl = req.file.path; // Cloudinary provides the full URL
    
    console.log(`✅ [${requestId}] Image uploaded to Cloudinary:`, receiptUrl);
    
    // Save new document in receipts collection
    const receipt = await Receipts.create({
      orderId: new mongoose.Types.ObjectId(orderId),
      customerId: new mongoose.Types.ObjectId(customerId),
      receiptUrl: receiptUrl,
      totalAmount: amount,
      status: 'pending',
      uploadedAt: new Date(),
      cloudinaryId: req.file.filename || `receipt-${Date.now()}-${file.originalname}`
    });
    
    console.log(`✅ [${requestId}] Receipt saved to database:`, receipt._id);
    
    // Return success + receipt data
    res.json({
      success: true,
      message: 'Receipt uploaded successfully',
      receipt: {
        _id: receipt._id,
        orderId: receipt.orderId,
        customerId: receipt.customerId,
        receiptUrl: receipt.receiptUrl,
        totalAmount: receipt.totalAmount,
        status: receipt.status,
        uploadedAt: receipt.uploadedAt
      }
    });
    
  } catch (error) {
    console.error('Error uploading receipt:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload receipt'
    });
  }
});

export default router;