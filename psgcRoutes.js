import express from 'express';
import PSGCService from './services/psgcService.js';

const router = express.Router();

// Get all regions
router.get('/regions', async (req, res) => {
  try {
    console.log('📍 Fetching PSGC regions...');
    const regions = await PSGCService.getRegions();
    
    res.json({
      success: true,
      data: regions,
      count: regions.length
    });
  } catch (error) {
    console.error('❌ Error fetching regions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch regions',
      error: error.message
    });
  }
});

// Get provinces by region
router.get('/provinces', async (req, res) => {
  try {
    const { regionCode } = req.query;
    
    if (!regionCode) {
      return res.status(400).json({
        success: false,
        message: 'Region code is required'
      });
    }

    console.log(`📍 Fetching provinces for region: ${regionCode}`);
    const provinces = await PSGCService.getProvincesByRegion(regionCode);
    
    res.json({
      success: true,
      data: provinces,
      count: provinces.length,
      regionCode
    });
  } catch (error) {
    console.error('❌ Error fetching provinces:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch provinces',
      error: error.message
    });
  }
});

// Get cities by province
router.get('/cities', async (req, res) => {
  try {
    const { provinceCode } = req.query;
    
    if (!provinceCode) {
      return res.status(400).json({
        success: false,
        message: 'Province code is required'
      });
    }

    console.log(`📍 Fetching cities for province: ${provinceCode}`);
    const cities = await PSGCService.getCitiesByProvince(provinceCode);
    
    res.json({
      success: true,
      data: cities,
      count: cities.length,
      provinceCode
    });
  } catch (error) {
    console.error('❌ Error fetching cities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cities',
      error: error.message
    });
  }
});

// Get barangays by city
router.get('/barangays', async (req, res) => {
  try {
    const { cityCode } = req.query;
    
    if (!cityCode) {
      return res.status(400).json({
        success: false,
        message: 'City code is required'
      });
    }

    console.log(`📍 Fetching barangays for city: ${cityCode}`);
    const barangays = await PSGCService.getBarangaysByCity(cityCode);
    
    res.json({
      success: true,
      data: barangays,
      count: barangays.length,
      cityCode
    });
  } catch (error) {
    console.error('❌ Error fetching barangays:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch barangays',
      error: error.message
    });
  }
});

// Validate address
router.post('/validate', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address object is required'
      });
    }

    console.log('🔍 Validating address:', address);
    const validation = await PSGCService.validateAddress(address);
    
    if (validation.isValid) {
      res.json({
        success: true,
        message: 'Address is valid',
        validatedAddress: validation.validatedAddress
      });
    } else {
      res.status(400).json({
        success: false,
        message: validation.error,
        field: validation.field,
        missingFields: validation.missingFields
      });
    }
  } catch (error) {
    console.error('❌ Error validating address:', error);
    res.status(500).json({
      success: false,
      message: 'Address validation failed',
      error: error.message
    });
  }
});

// Validate Compostela address (specific to app requirements)
router.post('/validate-compostela', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address object is required'
      });
    }

    console.log('🔍 Validating Compostela address:', address);
    const validation = await PSGCService.validateCompostelaAddress(address);
    
    if (validation.isValid) {
      res.json({
        success: true,
        message: 'Address is valid and within Compostela, Davao de Oro',
        validatedAddress: validation.validatedAddress,
        isCompostela: validation.isCompostela
      });
    } else {
      res.status(400).json({
        success: false,
        message: validation.error,
        field: validation.field,
        requiredLocation: validation.requiredLocation
      });
    }
  } catch (error) {
    console.error('❌ Error validating Compostela address:', error);
    res.status(500).json({
      success: false,
      message: 'Compostela address validation failed',
      error: error.message
    });
  }
});

// Search locations
router.get('/search', async (req, res) => {
  try {
    const { q: query, type = 'all' } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    console.log(`🔍 Searching locations: "${query}" (type: ${type})`);
    const results = await PSGCService.searchLocations(query, type);
    
    res.json({
      success: true,
      query,
      type,
      results
    });
  } catch (error) {
    console.error('❌ Error searching locations:', error);
    res.status(500).json({
      success: false,
      message: 'Location search failed',
      error: error.message
    });
  }
});

// Get cache statistics (for debugging)
router.get('/cache-stats', (req, res) => {
  try {
    const stats = PSGCService.getCacheStats();
    res.json({
      success: true,
      cacheStats: stats
    });
  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cache statistics',
      error: error.message
    });
  }
});

// Clear cache (for debugging/maintenance)
router.post('/clear-cache', (req, res) => {
  try {
    PSGCService.clearCache();
    res.json({
      success: true,
      message: 'PSGC cache cleared successfully'
    });
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
      error: error.message
    });
  }
});

export default router;