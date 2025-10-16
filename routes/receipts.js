import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

// Import models - we'll get them dynamically since they're defined in app.js
const getReceipt = () => mongoose.model('Receipts');
const getOrder = () => mongoose.model('Order');

// POST /api/receipts
// Expect body: { orderId, customerInfo, totalAmount, receiptUrl, cloudinaryId, uploadedBy }
router.post('/', async (req, res) => {
  try {
    const { orderId, customerInfo, totalAmount, receiptUrl, cloudinaryId, uploadedBy } = req.body;

    if (!orderId || !receiptUrl || !cloudinaryId) {
      return res.status(400).json({ message: 'Missing required fields: orderId, receiptUrl, cloudinaryId' });
    }

    // Check if receipt already exists with this cloudinaryId (primary deduplication)
    const existingReceipt = await getReceipt().findOne({ cloudinaryId });
    if (existingReceipt) {
      return res.status(409).json({ 
        message: 'Receipt already uploaded',
        isDuplicate: true,
        receiptUrl: existingReceipt.receiptUrl,
        receiptId: existingReceipt._id
      });
    }

    // Check if there's already a pending receipt for this order (secondary safety)
    const existingPending = await getReceipt().findOne({ orderId, status: 'pending' });
    if (existingPending) {
      return res.status(409).json({ 
        message: 'A pending receipt already exists for this order',
        isDuplicate: true,
        receiptUrl: existingPending.receiptUrl,
        receiptId: existingPending._id
      });
    }

    // Create new receipt
    const receipt = new (getReceipt())({
      orderId,
      customerInfo,
      totalAmount,
      receiptUrl,
      cloudinaryId,
      uploadedBy,
      status: 'pending'
    });

    await receipt.save();
    console.log('✅ Receipt saved successfully:', receipt._id);
    
    // Optionally mark order as 'pending' paymentStatus
    await getOrder().findByIdAndUpdate(orderId, { paymentStatus: 'pending' });

    return res.status(201).json({ success: true, receipt });
  } catch (err) {
    console.error('Error creating receipt:', err);
    
    // Handle duplicate key error from unique index
    if (err.code === 11000) {
      if (err.keyPattern?.cloudinaryId) {
        return res.status(409).json({ 
          message: 'Receipt already uploaded',
          isDuplicate: true
        });
      }
      if (err.keyPattern?.orderId && err.keyPattern?.status) {
        return res.status(409).json({ 
          message: 'A pending receipt already exists for this order',
          isDuplicate: true
        });
      }
    }
    
    return res.status(500).json({ message: 'Failed to create receipt' });
  }
});

// GET /api/receipts/pending
router.get('/pending', async (req, res) => {
  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50); // Max 50 per page
    const skip = (page - 1) * limit;

    // Get total count for pagination info
    const totalCount = await getReceipt().countDocuments({ status: 'pending' });
    const totalPages = Math.ceil(totalCount / limit);

    // Fetch receipts with minimal payload for orders: items, totalAmount, paymentStatus, status
    const receipts = await getReceipt().find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'orderId',
        select: 'items totalAmount paymentStatus status',
        populate: {
          path: 'items.product',
          select: 'name price productImage'
        }
      })
      .select('customerInfo totalAmount receiptUrl orderId status createdAt cloudinaryId')
      .lean();

    return res.json({ 
      receipts,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (err) {
    console.error('Error fetching pending receipts:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/receipts/:id/confirm
router.patch('/:id/confirm', async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  try {
    const receiptId = req.params.id;
    console.log(`🚀 [${requestId}] CONFIRM RECEIPT REQUEST - ${new Date().toISOString()}`);
    console.log(`📋 [${requestId}] Receipt ID: ${receiptId}`);
    console.log(`📋 [${requestId}] Request headers:`, {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50) + '...'
    });
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(receiptId)) {
      console.log(`❌ [${requestId}] INVALID RECEIPT ID FORMAT: ${receiptId}`);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid receipt ID format',
        requestId
      });
    }
    
    console.log(`🔍 [${requestId}] Fetching receipt from database...`);
    const receipt = await getReceipt().findById(receiptId);
    if (!receipt) {
      console.log(`❌ [${requestId}] RECEIPT NOT FOUND: ${receiptId}`);
      return res.status(404).json({ 
        success: false,
        message: 'Receipt not found',
        requestId
      });
    }

    console.log(`📄 [${requestId}] Receipt found:`, {
      id: receipt._id,
      status: receipt.status,
      orderId: receipt.orderId,
      customerId: receipt.customerId,
      totalAmount: receipt.totalAmount,
      uploadedAt: receipt.uploadedAt
    });

    if (receipt.status === 'confirmed') {
      console.log(`✅ [${requestId}] RECEIPT ALREADY CONFIRMED: ${receiptId}`);
      return res.status(200).json({ 
        success: true,
        message: 'Already confirmed', 
        receipt,
        requestId
      });
    }

    if (receipt.status === 'declined') {
      console.log(`⚠️ [${requestId}] CANNOT CONFIRM DECLINED RECEIPT: ${receiptId}`);
      return res.status(400).json({ 
        success: false,
        message: 'Cannot confirm a declined receipt',
        requestId
      });
    }

    console.log(`💾 [${requestId}] Updating receipt status to confirmed...`);
    // Update receipt status
    const updatedReceipt = await getReceipt().findByIdAndUpdate(
      receiptId, 
      { status: 'confirmed', confirmedAt: new Date() },
      { new: true }
    );
    console.log(`✅ [${requestId}] RECEIPT CONFIRMED SUCCESSFULLY: ${receiptId}`);

    // Link to order and set paymentStatus (if order exists)
    console.log(`🔗 [${requestId}] Attempting to update order payment status...`);
    try {
      const updatedOrder = await getOrder().findByIdAndUpdate(receipt.orderId, { 
        receiptId: receipt._id, 
        paymentStatus: 'verified' 
      }, { new: true });
      
      if (updatedOrder) {
        console.log(`✅ [${requestId}] ORDER PAYMENT STATUS UPDATED: ${receipt.orderId} -> verified`);
        console.log(`📦 [${requestId}] Order details:`, {
          orderId: updatedOrder._id,
          paymentStatus: updatedOrder.paymentStatus,
          receiptId: updatedOrder.receiptId
        });
      } else {
        console.log(`⚠️ [${requestId}] ORDER NOT FOUND: ${receipt.orderId}`);
      }
    } catch (orderErr) {
      console.log(`❌ [${requestId}] ORDER UPDATE FAILED:`, {
        orderId: receipt.orderId,
        error: orderErr.message,
        stack: orderErr.stack
      });
      // Continue anyway since receipt was updated successfully
    }

    const processingTime = Date.now() - startTime;
    const responsePayload = { 
      success: true, 
      receipt: updatedReceipt,
      message: 'Receipt confirmed successfully',
      requestId,
      processingTime: `${processingTime}ms`
    };

    console.log(`📤 [${requestId}] SENDING SUCCESS RESPONSE (${processingTime}ms):`, {
      receiptId: updatedReceipt._id,
      status: updatedReceipt.status,
      confirmedAt: updatedReceipt.confirmedAt
    });

    return res.json(responsePayload);
  } catch (err) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [${requestId}] ERROR CONFIRMING RECEIPT (${processingTime}ms):`, {
      receiptId: req.params.id,
      error: err.message,
      stack: err.stack
    });
    return res.status(500).json({ 
      success: false,
      message: 'Failed to confirm receipt',
      error: err.message,
      requestId,
      processingTime: `${processingTime}ms`
    });
  }
});

// PATCH /api/receipts/:id/decline
router.patch('/:id/decline', async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  try {
    const receiptId = req.params.id;
    const { reason } = req.body; // Optional decline reason
    console.log(`🚀 [${requestId}] DECLINE RECEIPT REQUEST - ${new Date().toISOString()}`);
    console.log(`📋 [${requestId}] Receipt ID: ${receiptId}`);
    console.log(`📋 [${requestId}] Decline reason:`, reason || 'No reason provided');
    console.log(`📋 [${requestId}] Request headers:`, {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50) + '...'
    });
    console.log(`📋 [${requestId}] Request body:`, JSON.stringify(req.body, null, 2));
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(receiptId)) {
      console.log(`❌ [${requestId}] INVALID RECEIPT ID FORMAT: ${receiptId}`);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid receipt ID format',
        requestId
      });
    }
    
    console.log(`🔍 [${requestId}] Fetching receipt from database...`);
    const receipt = await getReceipt().findById(receiptId);
    if (!receipt) {
      console.log(`❌ [${requestId}] RECEIPT NOT FOUND: ${receiptId}`);
      return res.status(404).json({ 
        success: false,
        message: 'Receipt not found',
        requestId
      });
    }

    console.log(`📄 [${requestId}] Receipt found:`, {
      id: receipt._id,
      status: receipt.status,
      orderId: receipt.orderId,
      customerId: receipt.customerId,
      totalAmount: receipt.totalAmount,
      uploadedAt: receipt.uploadedAt
    });

    if (receipt.status === 'declined') {
      console.log(`⚠️ [${requestId}] RECEIPT ALREADY DECLINED: ${receiptId}`);
      return res.status(200).json({ 
        success: true,
        message: 'Already declined', 
        receipt,
        requestId
      });
    }

    if (receipt.status === 'confirmed') {
      console.log(`⚠️ [${requestId}] CANNOT DECLINE CONFIRMED RECEIPT: ${receiptId}`);
      return res.status(400).json({ 
        success: false,
        message: 'Cannot decline a confirmed receipt',
        requestId
      });
    }

    console.log(`💾 [${requestId}] Updating receipt status to declined...`);
    // Update receipt status
    const updateData = { 
      status: 'declined', 
      declinedAt: new Date()
    };
    if (reason) {
      updateData.declineReason = reason;
      console.log(`📝 [${requestId}] Adding decline reason: ${reason}`);
    }

    const updatedReceipt = await getReceipt().findByIdAndUpdate(
      receiptId, 
      updateData,
      { new: true }
    );
    console.log(`✅ [${requestId}] RECEIPT DECLINED SUCCESSFULLY: ${receiptId}`);

    // Optionally update order payment status back to pending/failed
    console.log(`🔗 [${requestId}] Attempting to update order payment status to failed...`);
    try {
      const updatedOrder = await getOrder().findByIdAndUpdate(receipt.orderId, { 
        paymentStatus: 'failed' 
      }, { new: true });
      
      if (updatedOrder) {
        console.log(`✅ [${requestId}] ORDER PAYMENT STATUS UPDATED: ${receipt.orderId} -> failed`);
        console.log(`📦 [${requestId}] Order details:`, {
          orderId: updatedOrder._id,
          paymentStatus: updatedOrder.paymentStatus
        });
      } else {
        console.log(`⚠️ [${requestId}] ORDER NOT FOUND: ${receipt.orderId}`);
      }
    } catch (orderErr) {
      console.log(`❌ [${requestId}] ORDER UPDATE FAILED:`, {
        orderId: receipt.orderId,
        error: orderErr.message,
        stack: orderErr.stack
      });
    }

    const processingTime = Date.now() - startTime;
    const responsePayload = { 
      success: true, 
      receipt: updatedReceipt,
      message: 'Receipt declined successfully',
      requestId,
      processingTime: `${processingTime}ms`
    };

    console.log(`📤 [${requestId}] SENDING SUCCESS RESPONSE (${processingTime}ms):`, {
      receiptId: updatedReceipt._id,
      status: updatedReceipt.status,
      declinedAt: updatedReceipt.declinedAt,
      declineReason: updatedReceipt.declineReason
    });

    return res.json(responsePayload);
  } catch (err) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [${requestId}] ERROR DECLINING RECEIPT (${processingTime}ms):`, {
      receiptId: req.params.id,
      error: err.message,
      stack: err.stack,
      requestBody: req.body
    });
    return res.status(500).json({ 
      success: false,
      message: 'Failed to decline receipt',
      error: err.message,
      requestId,
      processingTime: `${processingTime}ms`
    });
  }
});

export default router;