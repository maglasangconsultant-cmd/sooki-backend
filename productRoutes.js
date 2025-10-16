import express from 'express';
import Product from './models/Product.js';

const router = express.Router();

// Get all products
router.get('/', async (req, res) => {
  try {
    const products = await Product.find();
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get individual product with add-ons
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    const product = await Product.findById(productId)
      .populate({
        path: 'addOns',
        match: { isActive: true }, // only active add-ons
        select: 'name price image maxQuantity category' // pick relevant fields
      });
    
    if (!product) {
      return res.status(404).json({ 
        error: 'Product not found, boss! 🤔',
        success: false 
      });
    }
    
    res.status(200).json({
      success: true,
      product,
      hints: {
        addOns: "Here are optional extras for this product. Select wisely, boss! 😎"
      }
    });
  } catch (error) {
    console.error('Error fetching product by ID:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;