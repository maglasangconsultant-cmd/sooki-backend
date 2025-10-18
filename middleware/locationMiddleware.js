/**
 * Location-based Access Middleware for Laundry Services
 * Restricts access to users in Compostela, Davao de Oro only
 */

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { JWT_SECRET } from '../config/authConfig.js';

/**
 * Middleware to verify user location for laundry services
 * Only allows access to users with addresses in Compostela, Davao de Oro
 */
const verifyCompostelaLocation = async (req, res, next) => {
  try {
    // First verify JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // Verify and decode JWT token
  const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    // Fetch user from database
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.'
      });
    }

    // Check if user has valid Compostela address
    const hasCompostelaAddress = checkCompostelaAddress(user);
    
    if (!hasCompostelaAddress) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Laundry services are only available to residents of Compostela, Davao de Oro.',
        errorCode: 'LOCATION_RESTRICTED',
        allowedLocation: {
          city: 'Compostela',
          province: 'Davao de Oro',
          country: 'Philippines'
        }
      });
    }

    // Add user info to request for downstream use
    req.user = user;
    req.userLocation = getCompostelaAddress(user);
    
    next();
  } catch (error) {
    console.error('Location middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error during location verification.'
    });
  }
};

/**
 * Check if user has a valid address in Compostela, Davao de Oro
 * @param {Object} user - User object from database
 * @returns {boolean} - True if user has Compostela address
 */
const checkCompostelaAddress = (user) => {
  // Check addresses array (from schema)
  if (user.addresses && Array.isArray(user.addresses)) {
    return user.addresses.some(address => 
      isCompostelaAddress(address.city, address.province)
    );
  }
  
  // Check sellerInfo.shopAddress if user is a seller
  if (user.sellerInfo && user.sellerInfo.shopAddress) {
    // Parse shop address string for location info
    const shopAddress = user.sellerInfo.shopAddress.toLowerCase();
    return shopAddress.includes('compostela') && 
           (shopAddress.includes('davao de oro') || shopAddress.includes('davao gold'));
  }
  
  // Check if user has location fields directly (fallback)
  if (user.city && user.province) {
    return isCompostelaAddress(user.city, user.province);
  }
  
  return false;
};

/**
 * Check if city and province match Compostela, Davao de Oro
 * @param {string} city - City name
 * @param {string} province - Province name
 * @returns {boolean} - True if matches Compostela location
 */
const isCompostelaAddress = (city, province) => {
  if (!city || !province) return false;
  
  const normalizedCity = city.toLowerCase().trim();
  const normalizedProvince = province.toLowerCase().trim();
  
  // Check for Compostela city
  const isCompostela = normalizedCity === 'compostela' || 
                      normalizedCity.includes('compostela');
  
  // Check for Davao de Oro province (also known as Davao Gold)
  const isDavaoDeOro = normalizedProvince === 'davao de oro' ||
                      normalizedProvince === 'davao gold' ||
                      normalizedProvince.includes('davao de oro') ||
                      normalizedProvince.includes('davao gold');
  
  return isCompostela && isDavaoDeOro;
};

/**
 * Get the Compostela address from user data
 * @param {Object} user - User object
 * @returns {Object|null} - Compostela address object or null
 */
const getCompostelaAddress = (user) => {
  if (user.addresses && Array.isArray(user.addresses)) {
    return user.addresses.find(address => 
      isCompostelaAddress(address.city, address.province)
    );
  }
  
  return null;
};

/**
 * Middleware specifically for laundry shop owners
 * Ensures shop owners can only register shops in Compostela
 */
const verifyLaundryShopLocation = async (req, res, next) => {
  try {
    // First run the general location check
    await new Promise((resolve, reject) => {
      verifyCompostelaLocation(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Additional check for shop registration data
    if (req.body.location) {
      const { city, province } = req.body.location;
      
      if (!isCompostelaAddress(city, province)) {
        return res.status(400).json({
          success: false,
          message: 'Laundry shops can only be registered in Compostela, Davao de Oro.',
          errorCode: 'INVALID_SHOP_LOCATION',
          requiredLocation: {
            city: 'Compostela',
            province: 'Davao de Oro'
          }
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Laundry shop location middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying shop location.'
    });
  }
};

/**
 * Middleware to verify customer location for laundry orders
 * Ensures customers can only place orders if they're in Compostela
 */
const verifyCustomerLocation = async (req, res, next) => {
  try {
    // Run general location check
    await new Promise((resolve, reject) => {
      verifyCompostelaLocation(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Additional check for pickup/delivery addresses
    if (req.body.pickup && req.body.pickup.address) {
      const pickupAddress = req.body.pickup.address.toLowerCase();
      
      if (!pickupAddress.includes('compostela')) {
        return res.status(400).json({
          success: false,
          message: 'Pickup address must be within Compostela, Davao de Oro.',
          errorCode: 'INVALID_PICKUP_LOCATION'
        });
      }
    }
    
    if (req.body.delivery && req.body.delivery.address) {
      const deliveryAddress = req.body.delivery.address.toLowerCase();
      
      if (!deliveryAddress.includes('compostela')) {
        return res.status(400).json({
          success: false,
          message: 'Delivery address must be within Compostela, Davao de Oro.',
          errorCode: 'INVALID_DELIVERY_LOCATION'
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Customer location middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying customer location.'
    });
  }
};

/**
 * Utility function to validate coordinates are within Compostela bounds
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {boolean} - True if coordinates are within Compostela area
 */
const isWithinCompostelaBounds = (latitude, longitude) => {
  // Approximate bounds for Compostela, Davao de Oro
  // These should be adjusted based on actual municipal boundaries
  const bounds = {
    north: 7.7000,   // Northern boundary
    south: 7.6400,   // Southern boundary
    east: 126.1200,  // Eastern boundary
    west: 126.0500   // Western boundary
  };
  
  return latitude >= bounds.south && 
         latitude <= bounds.north && 
         longitude >= bounds.west && 
         longitude <= bounds.east;
};

/**
 * Middleware to verify coordinates are within Compostela
 */
const verifyCoordinatesLocation = (req, res, next) => {
  try {
    if (req.body.coordinates) {
      const { latitude, longitude } = req.body.coordinates;
      
      if (!isWithinCompostelaBounds(latitude, longitude)) {
        return res.status(400).json({
          success: false,
          message: 'Coordinates must be within Compostela, Davao de Oro boundaries.',
          errorCode: 'COORDINATES_OUT_OF_BOUNDS'
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Coordinates verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying coordinates.'
    });
  }
};

export {
  verifyCompostelaLocation,
  verifyLaundryShopLocation,
  verifyCustomerLocation,
  verifyCoordinatesLocation,
  checkCompostelaAddress,
  isCompostelaAddress,
  isWithinCompostelaBounds
};