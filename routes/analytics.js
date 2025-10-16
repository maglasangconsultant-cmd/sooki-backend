import express from 'express';
import analyticsService from '../services/analyticsService.js';
import abTestingService from '../services/abTestingService.js';

const router = express.Router();

// ===== ANALYTICS DASHBOARD FOR SELLERS =====
router.get('/dashboard/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { days = 30 } = req.query;

    console.log(`📊 [ANALYTICS] Fetching dashboard data for seller: ${sellerId}`);

    const dashboardData = await analyticsService.getDashboardAnalytics(sellerId, parseInt(days));

    if (!dashboardData) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch analytics data, boss! 😅"
      });
    }

    res.status(200).json({
      success: true,
      data: dashboardData,
      hints: {
        conversions: "Track how well your add-ons are converting! 📈",
        displayAddOns: "See which display strategies work best! 🎯",
        topAddOns: "Your best performing add-ons are here! 🏆"
      }
    });

  } catch (error) {
    console.error('❌ [ANALYTICS DASHBOARD ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Analytics dashboard failed, boss! 😅",
      error: error.message
    });
  }
});

// ===== ADD-ON CONVERSION ANALYTICS =====
router.get('/conversions', async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      productId, 
      sellerId, 
      addOnId 
    } = req.query;

    const filters = {};
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (productId) filters.productId = productId;
    if (sellerId) filters.sellerId = sellerId;
    if (addOnId) filters.addOnId = addOnId;

    console.log(`📊 [ANALYTICS] Fetching conversion data with filters:`, filters);

    const conversionData = await analyticsService.getAddOnConversionAnalytics(filters);

    res.status(200).json({
      success: true,
      data: conversionData,
      summary: {
        totalProducts: conversionData.length,
        avgConversionRate: conversionData.length > 0 
          ? conversionData.reduce((sum, item) => sum + item.conversionRate, 0) / conversionData.length 
          : 0,
        totalPurchases: conversionData.reduce((sum, item) => sum + (item.purchases?.count || 0), 0)
      },
      hints: {
        optimization: "Focus on add-ons with high views but low conversions! 🎯",
        performance: "Track click-through rates to optimize positioning! 📊"
      }
    });

  } catch (error) {
    console.error('❌ [CONVERSION ANALYTICS ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Conversion analytics failed, boss! 😅",
      error: error.message
    });
  }
});

// ===== DISPLAY ADD-ONS PERFORMANCE =====
router.get('/displayaddons', async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      productId, 
      sellerId 
    } = req.query;

    const filters = {};
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (productId) filters.productId = productId;
    if (sellerId) filters.sellerId = sellerId;

    console.log(`📊 [ANALYTICS] Fetching displayAddOns performance:`, filters);

    const displayData = await analyticsService.getDisplayAddOnsAnalytics(filters);

    res.status(200).json({
      success: true,
      data: displayData,
      summary: {
        totalProducts: displayData.length,
        totalShows: displayData.reduce((sum, item) => sum + item.totalShows, 0),
        avgAddOnsPerShow: displayData.length > 0
          ? displayData.reduce((sum, item) => {
              const avgForProduct = item.displayTypes.reduce((typeSum, type) => typeSum + type.avgAddOnsShown, 0) / item.displayTypes.length;
              return sum + avgForProduct;
            }, 0) / displayData.length
          : 0
      },
      hints: {
        strategy: "Compare addon vs related_product performance! 🔄",
        optimization: "Adjust maxAddOns based on engagement data! ⚙️"
      }
    });

  } catch (error) {
    console.error('❌ [DISPLAY ADDONS ANALYTICS ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "DisplayAddOns analytics failed, boss! 😅",
      error: error.message
    });
  }
});

// ===== TOP PERFORMING ADD-ONS =====
router.get('/top-addons', async (req, res) => {
  try {
    const { 
      limit = 10, 
      startDate, 
      endDate, 
      sellerId 
    } = req.query;

    const filters = {};
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (sellerId) filters.sellerId = sellerId;

    console.log(`📊 [ANALYTICS] Fetching top performing add-ons:`, filters);

    const topAddOns = await analyticsService.getTopPerformingAddOns(parseInt(limit), filters);

    res.status(200).json({
      success: true,
      data: topAddOns,
      summary: {
        totalAddOns: topAddOns.length,
        bestConversionRate: topAddOns.length > 0 ? topAddOns[0].conversionRate : 0,
        totalClicks: topAddOns.reduce((sum, addon) => sum + addon.clicks, 0),
        totalPurchases: topAddOns.reduce((sum, addon) => sum + addon.purchases, 0)
      },
      hints: {
        promotion: "Promote your top add-ons more prominently! 🚀",
        improvement: "Study low-performing add-ons for optimization opportunities! 🔍"
      }
    });

  } catch (error) {
    console.error('❌ [TOP ADDONS ANALYTICS ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Top add-ons analytics failed, boss! 😅",
      error: error.message
    });
  }
});

// ===== TRACK ADD-ON INTERACTION =====
router.post('/track/addon-interaction', async (req, res) => {
  try {
    const {
      eventType,
      productId,
      addOnId,
      userId,
      sessionId,
      metadata = {}
    } = req.body;

    // Validate required fields
    if (!eventType || !productId) {
      return res.status(400).json({
        success: false,
        message: "eventType and productId are required, boss! 📝"
      });
    }

    // Validate event type
    const validEventTypes = ['addon_view', 'addon_click', 'addon_add_to_cart', 'addon_purchase'];
    if (!validEventTypes.includes(eventType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid eventType. Must be one of: ${validEventTypes.join(', ')} 📋`
      });
    }

    console.log(`📊 [ANALYTICS] Tracking add-on interaction: ${eventType}`);

    const success = await analyticsService.trackAddOnInteraction(
      eventType,
      productId,
      addOnId,
      userId,
      sessionId,
      {
        ...metadata,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        timestamp: new Date()
      }
    );

    if (success) {
      res.status(200).json({
        success: true,
        message: "Add-on interaction tracked successfully! 📊"
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to track add-on interaction, boss! 😅"
      });
    }

  } catch (error) {
    console.error('❌ [TRACK ADDON INTERACTION ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Add-on interaction tracking failed, boss! 😅",
      error: error.message
    });
  }
});

// ===== A/B TEST RESULTS =====
router.get('/ab-tests/:testId/results', async (req, res) => {
  try {
    const { testId } = req.params;

    console.log(`🧪 [A/B TEST] Fetching results for test: ${testId}`);

    const results = await abTestingService.getTestResults(testId);

    res.status(200).json({
      success: true,
      data: results,
      hints: {
        significance: "Look for statistical significance before making decisions! 📊",
        sampleSize: "Ensure adequate sample size for reliable results! 📈",
        winner: results.winner ? `Winner: ${results.winner.variant}! 🏆` : "No clear winner yet! ⏳"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST RESULTS ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "A/B test results failed, boss! 😅",
      error: error.message
    });
  }
});

// ===== ANALYTICS HEALTH CHECK =====
router.get('/health', async (req, res) => {
  try {
    // Simple health check - count recent events
    const recentEvents = await analyticsService.AnalyticsEvent.countDocuments({
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    });

    res.status(200).json({
      success: true,
      status: 'healthy',
      data: {
        recentEvents,
        timestamp: new Date(),
        queueSize: analyticsService.eventQueue?.length || 0
      },
      message: "Analytics service is running smoothly! 📊✨"
    });

  } catch (error) {
    console.error('❌ [ANALYTICS HEALTH ERROR]:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      message: "Analytics service health check failed! 🚨",
      error: error.message
    });
  }
});

export default router;