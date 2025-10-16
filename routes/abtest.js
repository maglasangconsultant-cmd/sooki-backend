import express from 'express';
import abTestingService, { ABTest, UserTestAssignment } from '../services/abTestingService.js';

const router = express.Router();

// ===== CREATE A/B TEST =====
router.post('/create', async (req, res) => {
  try {
    const testConfig = req.body;

    console.log('🧪 [A/B TEST] Creating new test:', testConfig.name);

    const test = await abTestingService.createTest(testConfig);

    res.status(201).json({
      success: true,
      data: test,
      message: "A/B test created successfully! 🧪✨",
      hints: {
        next: "Start the test when ready with POST /api/abtest/:id/start",
        monitoring: "Monitor results with GET /api/analytics/ab-tests/:id/results"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST CREATE ERROR]:', error);
    res.status(400).json({
      success: false,
      message: "Failed to create A/B test, boss! 😅",
      error: error.message
    });
  }
});

// ===== START A/B TEST =====
router.post('/:testId/start', async (req, res) => {
  try {
    const { testId } = req.params;

    console.log(`🧪 [A/B TEST] Starting test: ${testId}`);

    const test = await abTestingService.startTest(testId);

    res.status(200).json({
      success: true,
      data: test,
      message: "A/B test started successfully! 🚀",
      hints: {
        monitoring: "Track progress with GET /api/analytics/ab-tests/:id/results",
        duration: "Test will auto-complete based on your configuration"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST START ERROR]:', error);
    res.status(400).json({
      success: false,
      message: "Failed to start A/B test, boss! 😅",
      error: error.message
    });
  }
});

// ===== COMPLETE A/B TEST =====
router.post('/:testId/complete', async (req, res) => {
  try {
    const { testId } = req.params;

    console.log(`🧪 [A/B TEST] Completing test: ${testId}`);

    const test = await abTestingService.completeTest(testId);

    res.status(200).json({
      success: true,
      data: test,
      message: "A/B test completed successfully! 🏁",
      hints: {
        results: "Check final results with GET /api/analytics/ab-tests/:id/results",
        implementation: "Implement the winning variant in your production code!"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST COMPLETE ERROR]:', error);
    res.status(400).json({
      success: false,
      message: "Failed to complete A/B test, boss! 😅",
      error: error.message
    });
  }
});

// ===== GET ALL TESTS =====
router.get('/', async (req, res) => {
  try {
    const { status, testType, limit = 20, page = 1 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (testType) filter.testType = testType;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const tests = await ABTest.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate('createdBy', 'businessName email');

    const total = await ABTest.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: tests,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalTests: total,
        hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
        hasPrev: parseInt(page) > 1
      },
      hints: {
        filtering: "Filter by status (draft, active, completed) or testType! 🔍",
        management: "Use POST /:id/start and POST /:id/complete to manage tests! ⚙️"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST LIST ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch A/B tests, boss! 😅",
      error: error.message
    });
  }
});

// ===== GET SINGLE TEST =====
router.get('/:testId', async (req, res) => {
  try {
    const { testId } = req.params;

    const test = await ABTest.findById(testId)
      .populate('createdBy', 'businessName email');

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "A/B test not found, boss! 🤔"
      });
    }

    // Get assignment statistics
    const assignmentStats = await UserTestAssignment.aggregate([
      { $match: { testId: test._id } },
      { $group: { _id: '$variant', count: { $sum: 1 } } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        test,
        assignmentStats
      },
      hints: {
        results: "Get detailed results with GET /api/analytics/ab-tests/:id/results",
        assignments: "Current user assignments by variant shown above! 👥"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST GET ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch A/B test, boss! 😅",
      error: error.message
    });
  }
});

// ===== UPDATE TEST =====
router.put('/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const updates = req.body;

    // Prevent updating active tests
    const existingTest = await ABTest.findById(testId);
    if (existingTest && existingTest.status === 'active') {
      return res.status(400).json({
        success: false,
        message: "Cannot update active A/B test! Stop it first. 🚫"
      });
    }

    const test = await ABTest.findByIdAndUpdate(
      testId,
      updates,
      { new: true, runValidators: true }
    );

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "A/B test not found, boss! 🤔"
      });
    }

    res.status(200).json({
      success: true,
      data: test,
      message: "A/B test updated successfully! ✏️",
      hints: {
        activation: "Start the test with POST /:id/start when ready! 🚀"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST UPDATE ERROR]:', error);
    res.status(400).json({
      success: false,
      message: "Failed to update A/B test, boss! 😅",
      error: error.message
    });
  }
});

// ===== DELETE TEST =====
router.delete('/:testId', async (req, res) => {
  try {
    const { testId } = req.params;

    // Prevent deleting active tests
    const existingTest = await ABTest.findById(testId);
    if (existingTest && existingTest.status === 'active') {
      return res.status(400).json({
        success: false,
        message: "Cannot delete active A/B test! Complete it first. 🚫"
      });
    }

    const test = await ABTest.findByIdAndDelete(testId);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "A/B test not found, boss! 🤔"
      });
    }

    // Also delete user assignments
    await UserTestAssignment.deleteMany({ testId });

    res.status(200).json({
      success: true,
      message: "A/B test deleted successfully! 🗑️",
      data: { deletedTest: test.name }
    });

  } catch (error) {
    console.error('❌ [A/B TEST DELETE ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Failed to delete A/B test, boss! 😅",
      error: error.message
    });
  }
});

// ===== GET USER'S VARIANT =====
router.get('/variant/:testName', async (req, res) => {
  try {
    const { testName } = req.params;
    const { userId, sessionId } = req.query;

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: "Either userId or sessionId is required, boss! 📝"
      });
    }

    console.log(`🧪 [A/B TEST] Getting variant for test: ${testName}`);

    const userMetadata = {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      referrer: req.headers.referer
    };

    const result = await abTestingService.getUserVariant(
      testName,
      userId,
      sessionId,
      userMetadata
    );

    if (!result) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No active test or user doesn't match criteria! 🤷‍♂️"
      });
    }

    res.status(200).json({
      success: true,
      data: result,
      message: "User variant assigned successfully! 🎯",
      hints: {
        tracking: "Track conversions with POST /api/analytics/track/addon-interaction",
        consistency: "Same user will always get the same variant! 🔒"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST VARIANT ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Failed to get user variant, boss! 😅",
      error: error.message
    });
  }
});

// ===== TRACK CONVERSION =====
router.post('/track/conversion', async (req, res) => {
  try {
    const { testName, userId, sessionId, conversionData = {} } = req.body;

    if (!testName || (!userId && !sessionId)) {
      return res.status(400).json({
        success: false,
        message: "testName and (userId or sessionId) are required, boss! 📝"
      });
    }

    console.log(`🧪 [A/B TEST] Tracking conversion for test: ${testName}`);

    await abTestingService.trackConversion(testName, userId, sessionId, {
      ...conversionData,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      message: "Conversion tracked successfully! 📊✨"
    });

  } catch (error) {
    console.error('❌ [A/B TEST CONVERSION ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Failed to track conversion, boss! 😅",
      error: error.message
    });
  }
});

// ===== PREDEFINED TEST TEMPLATES =====
router.get('/templates/displayaddons', async (req, res) => {
  try {
    const template = {
      name: 'displayaddons_optimization',
      description: 'Optimize displayAddOns algorithm for better conversions',
      testType: 'displayaddons_algorithm',
      variants: [
        {
          name: 'control',
          description: 'Default hybrid algorithm',
          trafficPercentage: 25,
          config: {
            algorithm: 'hybrid',
            maxAddOns: 4,
            prioritizeRevenue: true,
            showRelatedProducts: true
          }
        },
        {
          name: 'revenue_first',
          description: 'Prioritize highest-priced add-ons',
          trafficPercentage: 25,
          config: {
            algorithm: 'revenue_first',
            maxAddOns: 4,
            prioritizeRevenue: true,
            showRelatedProducts: true
          }
        },
        {
          name: 'popularity_first',
          description: 'Show most popular add-ons first',
          trafficPercentage: 25,
          config: {
            algorithm: 'popularity_first',
            maxAddOns: 4,
            prioritizeRevenue: false,
            showRelatedProducts: true
          }
        },
        {
          name: 'more_addons',
          description: 'Show more add-ons (6 instead of 4)',
          trafficPercentage: 25,
          config: {
            algorithm: 'hybrid',
            maxAddOns: 6,
            prioritizeRevenue: true,
            showRelatedProducts: true
          }
        }
      ],
      targetAudience: {
        userSegments: ['all'],
        categories: [],
        sellers: []
      },
      metrics: {
        primary: 'conversion_rate',
        secondary: ['click_through_rate', 'revenue_per_user']
      },
      minSampleSize: 1000,
      confidenceLevel: 0.95
    };

    res.status(200).json({
      success: true,
      data: template,
      message: "DisplayAddOns A/B test template ready! 🧪",
      hints: {
        usage: "Customize and POST to /api/abtest/create to start testing! 🚀",
        monitoring: "Track results with analytics endpoints! 📊"
      }
    });

  } catch (error) {
    console.error('❌ [A/B TEST TEMPLATE ERROR]:', error);
    res.status(500).json({
      success: false,
      message: "Failed to get template, boss! 😅",
      error: error.message
    });
  }
});

export default router;