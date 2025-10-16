import mongoose from 'mongoose';

// Analytics Event Schema
const analyticsEventSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      'product_view',
      'addon_view',
      'addon_click',
      'addon_add_to_cart',
      'addon_purchase',
      'product_search',
      'category_browse',
      'seller_view',
      'displayaddons_shown',
      'related_product_click'
    ],
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  sessionId: {
    type: String,
    index: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    index: true
  },
  addOnId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AddOn'
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    index: true
  },
  metadata: {
    category: String,
    price: Number,
    searchQuery: String,
    displayType: {
      type: String,
      enum: ['addon', 'related_product', 'fallback']
    },
    position: Number, // Position in list/grid
    source: String, // Where the event originated
    userAgent: String,
    ipAddress: String
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for common queries
analyticsEventSchema.index({ eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ productId: 1, eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ sellerId: 1, eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ userId: 1, timestamp: -1 });

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

class AnalyticsService {
  constructor() {
    this.batchSize = 100;
    this.eventQueue = [];
    this.flushInterval = 30000; // 30 seconds
    this.startBatchProcessor();
  }

  // Start batch processor for better performance
  startBatchProcessor() {
    setInterval(() => {
      this.flushEvents();
    }, this.flushInterval);
  }

  // Track a single event
  async trackEvent(eventData) {
    try {
      const event = {
        ...eventData,
        timestamp: new Date()
      };

      // Add to queue for batch processing
      this.eventQueue.push(event);

      // If queue is full, flush immediately
      if (this.eventQueue.length >= this.batchSize) {
        await this.flushEvents();
      }

      return true;
    } catch (error) {
      console.error('Analytics tracking error:', error);
      return false;
    }
  }

  // Flush events to database
  async flushEvents() {
    if (this.eventQueue.length === 0) return;

    const eventsToFlush = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await AnalyticsEvent.insertMany(eventsToFlush);
      console.log(`📊 [ANALYTICS] Flushed ${eventsToFlush.length} events to database`);
    } catch (error) {
      console.error('Analytics flush error:', error);
      // Re-add events to queue if flush failed
      this.eventQueue.unshift(...eventsToFlush);
    }
  }

  // Track product view
  async trackProductView(productId, userId, sessionId, metadata = {}) {
    return this.trackEvent({
      eventType: 'product_view',
      productId,
      userId,
      sessionId,
      metadata
    });
  }

  // Track add-on interaction
  async trackAddOnInteraction(eventType, productId, addOnId, userId, sessionId, metadata = {}) {
    return this.trackEvent({
      eventType,
      productId,
      addOnId,
      userId,
      sessionId,
      metadata
    });
  }

  // Track displayAddOns logic execution
  async trackDisplayAddOns(productId, displayType, addOnsShown, userId, sessionId, metadata = {}) {
    return this.trackEvent({
      eventType: 'displayaddons_shown',
      productId,
      userId,
      sessionId,
      metadata: {
        ...metadata,
        displayType,
        addOnsCount: addOnsShown.length,
        addOnIds: addOnsShown.map(addon => addon._id || addon.id || 'unknown')
      }
    });
  }

  // Get add-on conversion analytics
  async getAddOnConversionAnalytics(filters = {}) {
    try {
      const { 
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        endDate = new Date(),
        productId,
        sellerId,
        addOnId
      } = filters;

      const matchStage = {
        timestamp: { $gte: startDate, $lte: endDate }
      };

      if (productId) matchStage.productId = new mongoose.Types.ObjectId(productId);
      if (sellerId) matchStage.sellerId = new mongoose.Types.ObjectId(sellerId);
      if (addOnId) matchStage.addOnId = new mongoose.Types.ObjectId(addOnId);

      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: {
              productId: '$productId',
              addOnId: '$addOnId',
              eventType: '$eventType'
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: {
              productId: '$_id.productId',
              addOnId: '$_id.addOnId'
            },
            events: {
              $push: {
                eventType: '$_id.eventType',
                count: '$count'
              }
            }
          }
        },
        {
          $project: {
            productId: '$_id.productId',
            addOnId: '$_id.addOnId',
            views: {
              $ifNull: [
                { $arrayElemAt: [{ $filter: { input: '$events', cond: { $eq: ['$$this.eventType', 'addon_view'] } } }, 0] },
                { count: 0 }
              ]
            },
            clicks: {
              $ifNull: [
                { $arrayElemAt: [{ $filter: { input: '$events', cond: { $eq: ['$$this.eventType', 'addon_click'] } } }, 0] },
                { count: 0 }
              ]
            },
            addToCarts: {
              $ifNull: [
                { $arrayElemAt: [{ $filter: { input: '$events', cond: { $eq: ['$$this.eventType', 'addon_add_to_cart'] } } }, 0] },
                { count: 0 }
              ]
            },
            purchases: {
              $ifNull: [
                { $arrayElemAt: [{ $filter: { input: '$events', cond: { $eq: ['$$this.eventType', 'addon_purchase'] } } }, 0] },
                { count: 0 }
              ]
            }
          }
        },
        {
          $addFields: {
            clickThroughRate: {
              $cond: [
                { $gt: ['$views.count', 0] },
                { $divide: ['$clicks.count', '$views.count'] },
                0
              ]
            },
            conversionRate: {
              $cond: [
                { $gt: ['$clicks.count', 0] },
                { $divide: ['$purchases.count', '$clicks.count'] },
                0
              ]
            }
          }
        }
      ];

      const results = await AnalyticsEvent.aggregate(pipeline);
      return results;
    } catch (error) {
      console.error('Analytics conversion query error:', error);
      return [];
    }
  }

  // Get displayAddOns performance analytics
  async getDisplayAddOnsAnalytics(filters = {}) {
    try {
      const { 
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate = new Date(),
        productId,
        sellerId
      } = filters;

      const matchStage = {
        eventType: 'displayaddons_shown',
        timestamp: { $gte: startDate, $lte: endDate }
      };

      if (productId) matchStage.productId = new mongoose.Types.ObjectId(productId);
      if (sellerId) matchStage.sellerId = new mongoose.Types.ObjectId(sellerId);

      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: {
              productId: '$productId',
              displayType: '$metadata.displayType'
            },
            count: { $sum: 1 },
            avgAddOnsShown: { $avg: '$metadata.addOnsCount' }
          }
        },
        {
          $group: {
            _id: '$_id.productId',
            displayTypes: {
              $push: {
                type: '$_id.displayType',
                count: '$count',
                avgAddOnsShown: '$avgAddOnsShown'
              }
            },
            totalShows: { $sum: '$count' }
          }
        }
      ];

      const results = await AnalyticsEvent.aggregate(pipeline);
      return results;
    } catch (error) {
      console.error('Analytics displayAddOns query error:', error);
      return [];
    }
  }

  // Get top performing add-ons
  async getTopPerformingAddOns(limit = 10, filters = {}) {
    try {
      const { 
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate = new Date(),
        sellerId
      } = filters;

      const matchStage = {
        eventType: { $in: ['addon_click', 'addon_purchase'] },
        timestamp: { $gte: startDate, $lte: endDate },
        addOnId: { $exists: true }
      };

      if (sellerId) matchStage.sellerId = new mongoose.Types.ObjectId(sellerId);

      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: '$addOnId',
            clicks: {
              $sum: { $cond: [{ $eq: ['$eventType', 'addon_click'] }, 1, 0] }
            },
            purchases: {
              $sum: { $cond: [{ $eq: ['$eventType', 'addon_purchase'] }, 1, 0] }
            }
          }
        },
        {
          $addFields: {
            conversionRate: {
              $cond: [
                { $gt: ['$clicks', 0] },
                { $divide: ['$purchases', '$clicks'] },
                0
              ]
            },
            score: { $add: ['$clicks', { $multiply: ['$purchases', 5] }] } // Weight purchases more
          }
        },
        { $sort: { score: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'addons',
            localField: '_id',
            foreignField: '_id',
            as: 'addOnDetails'
          }
        },
        { $unwind: '$addOnDetails' }
      ];

      const results = await AnalyticsEvent.aggregate(pipeline);
      return results;
    } catch (error) {
      console.error('Analytics top add-ons query error:', error);
      return [];
    }
  }

  // Get analytics dashboard data
  async getDashboardAnalytics(sellerId, days = 30) {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const [conversionData, displayData, topAddOns] = await Promise.all([
        this.getAddOnConversionAnalytics({ startDate, endDate, sellerId }),
        this.getDisplayAddOnsAnalytics({ startDate, endDate, sellerId }),
        this.getTopPerformingAddOns(5, { startDate, endDate, sellerId })
      ]);

      return {
        period: { startDate, endDate, days },
        conversions: conversionData,
        displayAddOns: displayData,
        topAddOns: topAddOns,
        summary: {
          totalConversions: conversionData.reduce((sum, item) => sum + (item.purchases?.count || 0), 0),
          avgConversionRate: conversionData.length > 0 
            ? conversionData.reduce((sum, item) => sum + item.conversionRate, 0) / conversionData.length 
            : 0,
          totalDisplayAddOnsShown: displayData.reduce((sum, item) => sum + item.totalShows, 0)
        }
      };
    } catch (error) {
      console.error('Analytics dashboard query error:', error);
      return null;
    }
  }

  // Cleanup old analytics data
  async cleanupOldData(daysToKeep = 90) {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
      const result = await AnalyticsEvent.deleteMany({ timestamp: { $lt: cutoffDate } });
      console.log(`🧹 [ANALYTICS] Cleaned up ${result.deletedCount} old analytics events`);
      return result.deletedCount;
    } catch (error) {
      console.error('Analytics cleanup error:', error);
      return 0;
    }
  }
}

// Create singleton instance
const analyticsService = new AnalyticsService();

export default analyticsService;
export { AnalyticsEvent };