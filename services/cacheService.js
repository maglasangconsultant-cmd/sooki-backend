import { createClient } from 'redis';

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.defaultTTL = 300; // 5 minutes default TTL
  }

  async connect() {
    try {
      const redisDisabled = process.env.DISABLE_REDIS === 'true' || process.env.REDIS_ENABLED === 'false';
      if (redisDisabled) {
        console.log('🛑 Redis disabled by environment. Running without cache.');
        this.client = null;
        this.isConnected = false;
        return false;
      }

      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          connectTimeout: 5000,
          lazyConnect: true
        }
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis Client Connected');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('Redis Client Disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.isConnected = false;
      return false;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  // Generate cache key for products
  generateProductKey(filters = {}) {
    const { page = 1, limit = 10, category, sellerId, search, sortBy, sortOrder } = filters;
    const keyParts = [
      'products',
      `page:${page}`,
      `limit:${limit}`,
      category && `cat:${category}`,
      sellerId && `seller:${sellerId}`,
      search && `search:${encodeURIComponent(search)}`,
      sortBy && `sort:${sortBy}:${sortOrder || 'asc'}`
    ].filter(Boolean);
    
    return keyParts.join(':');
  }

  // Generate cache key for single product
  generateSingleProductKey(productId) {
    return `product:${productId}`;
  }

  // Generate cache key for add-ons
  generateAddOnKey(filters = {}) {
    const { category, sellerId, isActive = true } = filters;
    const keyParts = [
      'addons',
      category && `cat:${category}`,
      sellerId && `seller:${sellerId}`,
      `active:${isActive}`
    ].filter(Boolean);
    
    return keyParts.join(':');
  }

  // Get cached data
  async get(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  // Set cached data
  async set(key, data, ttl = this.defaultTTL) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      await this.client.setEx(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  // Delete cached data
  async del(key) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  // Delete multiple keys by pattern
  async delPattern(pattern) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Cache delete pattern error:', error);
      return false;
    }
  }

  // Invalidate product-related caches
  async invalidateProductCaches(productId = null, sellerId = null) {
    const patterns = ['products:*'];
    
    if (productId) {
      patterns.push(`product:${productId}`);
    }
    
    if (sellerId) {
      patterns.push(`*seller:${sellerId}*`);
    }

    for (const pattern of patterns) {
      await this.delPattern(pattern);
    }
  }

  // Invalidate add-on related caches
  async invalidateAddOnCaches(sellerId = null, category = null) {
    const patterns = ['addons:*'];
    
    if (sellerId) {
      patterns.push(`*seller:${sellerId}*`);
    }
    
    if (category) {
      patterns.push(`*cat:${category}*`);
    }

    for (const pattern of patterns) {
      await this.delPattern(pattern);
    }
  }

  // Health check
  async ping() {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Cache ping error:', error);
      return false;
    }
  }

  // Get cache statistics
  async getStats() {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const info = await this.client.info('memory');
      const keyspace = await this.client.info('keyspace');
      
      return {
        connected: this.isConnected,
        memory: info,
        keyspace: keyspace
      };
    } catch (error) {
      console.error('Cache stats error:', error);
      return null;
    }
  }
}

// Create singleton instance
const cacheService = new CacheService();

export default cacheService;