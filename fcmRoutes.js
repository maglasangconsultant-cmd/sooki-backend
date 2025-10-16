import express from 'express';
import User from './models/User.js';
import { sendPushNotification, sendMulticastNotification } from './services/fcmService.js';

const router = express.Router();

// Update FCM token for a user
router.post('/update-token', async (req, res) => {
  try {
    const { userId, fcmToken } = req.body;
    
    if (!userId || !fcmToken) {
      return res.status(400).json({ 
        success: false, 
        error: 'userId and fcmToken are required' 
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { fcmToken },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    console.log(`✅ [FCM] Token updated for user ${userId}`);
    res.json({ 
      success: true, 
      message: 'FCM token updated successfully' 
    });

  } catch (error) {
    console.error('❌ [FCM] Error updating token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update FCM token'
    });
  }
});

// Send push notification to specific user
router.post('/send-notification', async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;
    
    if (!userId || !title || !body) {
      return res.status(400).json({ 
        success: false, 
        error: 'userId, title, and body are required' 
      });
    }

    const user = await User.findById(userId);
    if (!user || !user.fcmToken) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found or no FCM token available' 
      });
    }

    const result = await sendPushNotification(
      user.fcmToken,
      title,
      body,
      data || {}
    );

    if (result.success) {
      console.log(`✅ [FCM] Notification sent to user ${userId}`);
      res.json({ 
        success: true, 
        messageId: result.messageId,
        message: 'Notification sent successfully' 
      });
    } else {
      console.error(`❌ [FCM] Failed to send notification to user ${userId}:`, result.error);
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }

  } catch (error) {
    console.error('❌ [FCM] Error sending notification:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send notification' 
    });
  }
});

router.post('/send-multicast', async (req, res) => {
  try {
    const { userIds, title, body, data } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || !title || !body) {
      return res.status(400).json({ 
        success: false, 
        error: 'userIds (array), title, and body are required' 
      });
    }

    const users = await User.find({ 
      _id: { $in: userIds },
      fcmToken: { $exists: true, $ne: null }
    });

    if (users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No users found with valid FCM tokens' 
      });
    }

    const tokens = users.map(user => user.fcmToken);
    const result = await sendMulticastNotification(
      tokens,
      title,
      body,
      data || {}
    );

    console.log(`✅ [FCM] Multicast notification sent to ${result.successCount}/${tokens.length} users`);
    res.json({ 
      success: true, 
      successCount: result.successCount,
      failureCount: result.failureCount,
      message: 'Multicast notification sent' 
    });

  } catch (error) {
    console.error('❌ [FCM] Error sending multicast notification:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send multicast notification' 
    });
  }
});

export default router;