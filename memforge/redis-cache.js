/**
 * Redis Caching Layer for MemForge
 * v1.1.0 Feature: 10x query speed improvement with intelligent invalidation
 */

const redis = require('redis');
const crypto = require('crypto');

class MemForgeCache {
  constructor(redisUrl = 'redis://localhost:6379') {
    this.client = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500),
      },
    });

    this.client.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
    });

    this.client.on('connect', () => {
      console.log('✅ Connected to Redis');
    });

    // TTL settings (seconds)
    this.ttl = {
      hot: 300, // 5 minutes (recent items, high frequency)
      warm: 600, // 10 minutes (consolidated memory)
      cold: 1800, // 30 minutes (archived items)
      search: 600, // 10 minutes (search results)
    };

    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      invalidations: 0,
    };
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.disconnect();
  }

  /**
   * Generate cache key
   */
  getCacheKey(namespace, id = null, query = null) {
    const parts = ['memforge', namespace];

    if (id) parts.push(id);
    if (query) {
      const hash = crypto.createHash('md5').update(query).digest('hex');
      parts.push(hash.substring(0, 8));
    }

    return parts.join(':');
  }

  /**
   * Get from cache
   */
  async get(namespace, id = null, query = null) {
    const key = this.getCacheKey(namespace, id, query);

    try {
      const cached = await this.client.get(key);

      if (cached) {
        this.stats.hits++;
        return JSON.parse(cached);
      }

      this.stats.misses++;
      return null;
    } catch (error) {
      console.error('Cache GET error:', error.message);
      return null;
    }
  }

  /**
   * Set in cache
   */
  async set(namespace, data, id = null, query = null, ttl = null) {
    const key = this.getCacheKey(namespace, id, query);
    const actualTTL = ttl || this.ttl[namespace] || 600;

    try {
      await this.client.setEx(key, actualTTL, JSON.stringify(data));
      this.stats.writes++;
    } catch (error) {
      console.error('Cache SET error:', error.message);
    }
  }

  /**
   * Invalidate cache by namespace
   */
  async invalidateNamespace(namespace) {
    try {
      const pattern = `memforge:${namespace}:*`;
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.client.del(keys);
        this.stats.invalidations += keys.length;
        console.log(`🗑️  Invalidated ${keys.length} cache entries for ${namespace}`);
      }
    } catch (error) {
      console.error('Cache invalidation error:', error.message);
    }
  }

  /**
   * Invalidate specific entry
   */
  async invalidate(namespace, id = null, query = null) {
    const key = this.getCacheKey(namespace, id, query);

    try {
      const result = await this.client.del(key);
      if (result > 0) {
        this.stats.invalidations++;
      }
    } catch (error) {
      console.error('Cache delete error:', error.message);
    }
  }

  /**
   * Clear all cache
   */
  async clear() {
    try {
      const pattern = 'memforge:*';
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.client.del(keys);
        this.stats.invalidations += keys.length;
        console.log(`🗑️  Cleared ${keys.length} cache entries`);
      }
    } catch (error) {
      console.error('Cache clear error:', error.message);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      total_requests: total,
      hit_rate_percent: parseFloat(hitRate),
      writes: this.stats.writes,
      invalidations: this.stats.invalidations,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      invalidations: 0,
    };
  }
}

/**
 * Express middleware: Cache GET requests, invalidate on POST/PUT/DELETE
 * 
 * Usage:
 *   const cache = new MemForgeCache()
 *   app.get('/api/memory/:id', cacheMiddleware(cache), handler)
 */
function cacheMiddleware(cache) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Extract cache key components from URL
    const namespace = req.path.split('/')[2]; // e.g., 'memory' from /api/memory
    const id = req.params.id || null;
    const query = JSON.stringify(req.query); // Include query params in cache key

    // Try to get from cache
    const cached = await cache.get(namespace, id, query);

    if (cached) {
      return res.json(cached);
    }

    // Not in cache, let handler execute and cache response
    const originalJson = res.json;
    res.json = function (data) {
      cache.set(namespace, data, id, query);
      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Express middleware: Invalidate cache on writes
 */
function invalidateOnWrite(cache, namespace) {
  return async (req, res, next) => {
    // Only invalidate on POST/PUT/DELETE
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
      return next();
    }

    // Execute handler first
    const originalJson = res.json;
    let isSuccess = false;

    res.json = function (data) {
      // Check if response is successful (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        isSuccess = true;
      }

      return originalJson.call(this, data);
    };

    res.on('finish', async () => {
      if (isSuccess) {
        await cache.invalidateNamespace(namespace);
      }
    });

    next();
  };
}

module.exports = {
  MemForgeCache,
  cacheMiddleware,
  invalidateOnWrite,
};
