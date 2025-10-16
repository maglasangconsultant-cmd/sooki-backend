import express from 'express';
import User from './models/User.js';
import { authenticateUser } from './middleware/authenticateUser.js';

const router = express.Router();

// Get all users (consider adding authentication and authorization)
router.get('/', async (req, res) => {
  try {
    const users = await User.find({});
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
  }
});

// Get current user details
router.get('/me', authenticateUser, async (req, res) => {
  try {
    // req.user is populated by authenticateUser middleware
    const user = await User.findById(req.user.id).select('-password'); // Exclude password
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch current user', error: error.message });
  }
});

export default router;