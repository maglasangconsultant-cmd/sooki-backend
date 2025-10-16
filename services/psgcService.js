import axios from 'axios';

/**
 * PSGC Service for backend validation
 * Handles communication with PSGC Cloud API and provides validation methods
 */
class PSGCService {
  static BASE_URL = 'https://psgc.cloud/api/v2';
  static CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  static cache = new Map();

  /**
   * Generic method to fetch data from PSGC API with caching
   */
  static async fetchWithCache(endpoint, cacheKey) {
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data;
    }

    try {
      const response = await axios.get(`${this.BASE_URL}${endpoint}`, {
        timeout: 10000, // 10 second timeout
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Sooki-App/1.0'
        }
      });

      const data = response.data.data || response.data; // Handle v2 API structure
      
      // Cache the result
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error(`PSGC API Error for ${endpoint}:`, error.message);
      
      // Return cached data if available, even if expired
      if (cached) {
        console.warn(`Using expired cache for ${cacheKey}`);
        return cached.data;
      }
      
      throw new Error(`Failed to fetch PSGC data: ${error.message}`);
    }
  }

  /**
   * Get all regions
   */
  static async getRegions() {
    return await this.fetchWithCache('/regions', 'regions');
  }

  /**
   * Get provinces by region code using hierarchical API
   */
  static async getProvincesByRegion(regionCode) {
    return await this.fetchWithCache(`/regions/${regionCode}/provinces`, `provinces_${regionCode}`);
  }

  /**
   * Get cities by province code using hierarchical API
   */
  static async getCitiesByProvince(provinceCode) {
    return await this.fetchWithCache(`/provinces/${provinceCode}/cities-municipalities`, `cities_${provinceCode}`);
  }

  /**
   * Get barangays by city code using hierarchical API
   */
  static async getBarangaysByCity(cityCode) {
    return await this.fetchWithCache(`/cities-municipalities/${cityCode}/barangays`, `barangays_${cityCode}`);
  }

  /**
   * Get all provinces (for general lookup)
   */
  static async getAllProvinces() {
    return await this.fetchWithCache('/provinces', 'all_provinces');
  }

  /**
   * Get all cities (for general lookup)
   */
  static async getAllCities() {
    return await this.fetchWithCache('/cities', 'all_cities');
  }

  /**
   * Get all barangays (for general lookup)
   */
  static async getAllBarangays() {
    return await this.fetchWithCache('/barangays', 'all_barangays');
  }

  /**
   * Validate a complete address against PSGC data
   */
  static async validateAddress(address) {
    try {
      const {
        regionCode,
        provinceCode,
        cityCode,
        barangayCode,
        street
      } = address;

      // Basic validation
      if (!regionCode || !provinceCode || !cityCode || !barangayCode || !street) {
        return {
          isValid: false,
          error: 'All address fields are required',
          missingFields: []
        };
      }

      // Validate region exists
      const regions = await this.getRegions();
      const region = regions.find(r => r.code === regionCode);
      if (!region) {
        return {
          isValid: false,
          error: 'Invalid region code',
          field: 'region'
        };
      }

      // Validate province exists and belongs to region
      const provinces = await this.getProvincesByRegion(regionCode);
      const province = provinces.find(p => p.code === provinceCode);
      if (!province) {
        return {
          isValid: false,
          error: 'Invalid province code or province does not belong to the specified region',
          field: 'province'
        };
      }

      // Validate city exists and belongs to province
      const cities = await this.getCitiesByProvince(provinceCode);
      const city = cities.find(c => c.code === cityCode);
      if (!city) {
        return {
          isValid: false,
          error: 'Invalid city code or city does not belong to the specified province',
          field: 'city'
        };
      }

      // Validate barangay exists and belongs to city
      const barangays = await this.getBarangaysByCity(cityCode);
      const barangay = barangays.find(b => b.code === barangayCode);
      if (!barangay) {
        return {
          isValid: false,
          error: 'Invalid barangay code or barangay does not belong to the specified city',
          field: 'barangay'
        };
      }

      // Validate street address
      if (street.trim().length < 5) {
        return {
          isValid: false,
          error: 'Street address must be at least 5 characters long',
          field: 'street'
        };
      }

      return {
        isValid: true,
        validatedAddress: {
          region: region.name,
          province: province.name,
          city: city.name,
          barangay: barangay.name,
          street: street.trim(),
          codes: {
            regionCode,
            provinceCode,
            cityCode,
            barangayCode
          }
        }
      };

    } catch (error) {
      console.error('Address validation error:', error);
      return {
        isValid: false,
        error: 'Address validation failed due to system error',
        systemError: error.message
      };
    }
  }

  /**
   * Validate if an address is within Compostela, Davao de Oro
   * (Specific validation for the current app's location restriction)
   */
  static async validateCompostelaAddress(address) {
    try {
      const validation = await this.validateAddress(address);
      
      if (!validation.isValid) {
        return validation;
      }

      const { validatedAddress } = validation;
      
      // Check if it's in Compostela, Davao de Oro
      const isCompostela = validatedAddress.city.toLowerCase().includes('compostela') &&
                          validatedAddress.province.toLowerCase().includes('davao de oro');

      if (!isCompostela) {
        return {
          isValid: false,
          error: 'Address must be within Compostela, Davao de Oro',
          field: 'location',
          requiredLocation: {
            city: 'Compostela',
            province: 'Davao de Oro'
          }
        };
      }

      return {
        isValid: true,
        validatedAddress,
        isCompostela: true
      };

    } catch (error) {
      console.error('Compostela address validation error:', error);
      return {
        isValid: false,
        error: 'Address validation failed',
        systemError: error.message
      };
    }
  }

  /**
   * Search for locations by name (fuzzy search)
   */
  static async searchLocations(query, type = 'all') {
    try {
      const searchQuery = query.toLowerCase().trim();
      const results = {
        regions: [],
        provinces: [],
        cities: [],
        barangays: []
      };

      if (type === 'all' || type === 'regions') {
        const regions = await this.getRegions();
        results.regions = regions.filter(r => 
          r.name.toLowerCase().includes(searchQuery)
        ).slice(0, 10);
      }

      if (type === 'all' || type === 'provinces') {
        const provinces = await this.getAllProvinces();
        results.provinces = provinces.filter(p => 
          p.name.toLowerCase().includes(searchQuery)
        ).slice(0, 10);
      }

      if (type === 'all' || type === 'cities') {
        const cities = await this.getAllCities();
        results.cities = cities.filter(c => 
          c.name.toLowerCase().includes(searchQuery)
        ).slice(0, 10);
      }

      if (type === 'all' || type === 'barangays') {
        const barangays = await this.getAllBarangays();
        results.barangays = barangays.filter(b => 
          b.name.toLowerCase().includes(searchQuery)
        ).slice(0, 10);
      }

      return results;
    } catch (error) {
      console.error('Location search error:', error);
      throw new Error(`Location search failed: ${error.message}`);
    }
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  static clearCache() {
    this.cache.clear();
    console.log('PSGC cache cleared');
  }

  /**
   * Get cache statistics
   */
  static getCacheStats() {
    const stats = {
      totalEntries: this.cache.size,
      entries: []
    };

    for (const [key, value] of this.cache.entries()) {
      stats.entries.push({
        key,
        age: Date.now() - value.timestamp,
        expired: Date.now() - value.timestamp > this.CACHE_DURATION
      });
    }

    return stats;
  }
}

export default PSGCService;