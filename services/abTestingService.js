import mongoose from 'mongoose';
import analyticsService from './analyticsService.js';

// A/B Test Configuration Schema
const abTestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  description: String,
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'completed'],
    default: 'draft',
    index: true
  },
  testType: {
    type: String,
    enum: ['displayaddons_algorithm', 'ui_layout', 'pricing_strategy', 'recommendation_count'],
    required: true
  },
  variants: [{
    name: String,
    description: String,
    config: mongoose.Schema.Types.Mixed, // Flexible config object
    trafficPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    }
  }],
  targetAudience: {
    userSegments: [String], // e.g., ['new_users', 'returning_customers']
    categories: [String],
    sellers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    minOrderValue: Number,
    maxOrderValue: Number
  },
  metrics: {
    primary: {
      type: String,
      enum: ['conversion_rate', 'click_through_rate', 'revenue_per_user', 'addon_attachment_rate'],
      required: true
    },
    secondary: [String]
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: Date,
  minSampleSize: {
    type: Number,
    default: 1000
  },
  confidenceLevel: {
    type: Number,
    default: 0.95
  },
  results: {
    winner: String,
    confidence: Number,
    statisticalSignificance: Boolean,
    variantResults: [{
      variant: String,
      sampleSize: Number,
      conversionRate: Number,
      revenue: Number,
      confidence: Number
    }],
    completedAt: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

const ABTest = mongoose.model('ABTest', abTestSchema);

// User Test Assignment Schema
const userTestAssignmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  sessionId: {
    type: String,
    index: true
  },
  testId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ABTest',
    required: true,
    index: true
  },
  variant: {
    type: String,
    required: true
  },
  assignedAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    userAgent: String,
    ipAddress: String,
    referrer: String
  }
}, {
  timestamps: true
});

// Compound indexes
userTestAssignmentSchema.index({ userId: 1, testId: 1 }, { unique: true });
userTestAssignmentSchema.index({ sessionId: 1, testId: 1 }, { unique: true });

const UserTestAssignment = mongoose.model('UserTestAssignment', userTestAssignmentSchema);

class ABTestingService {
  constructor() {
    this.cache = new Map(); // Cache active tests
    this.refreshCacheInterval = 5 * 60 * 1000; // 5 minutes
    this.startCacheRefresh();
  }

  // Start cache refresh for active tests
  startCacheRefresh() {
    setInterval(() => {
      this.refreshActiveTests();
    }, this.refreshCacheInterval);
    
    // Initial load
    this.refreshActiveTests();
  }

  // Refresh active tests cache
  async refreshActiveTests() {
    try {
      const activeTests = await ABTest.find({ status: 'active' }).lean();
      this.cache.clear();
      
      activeTests.forEach(test => {
        this.cache.set(test._id.toString(), test);
      });
      
      console.log(`🧪 [A/B TEST] Refreshed cache with ${activeTests.length} active tests`);
    } catch (error) {
      console.error('A/B Test cache refresh error:', error);
    }
  }

  // Create a new A/B test
  async createTest(testConfig) {
    try {
      // Validate traffic percentages sum to 100
      const totalTraffic = testConfig.variants.reduce((sum, variant) => sum + variant.trafficPercentage, 0);
      if (Math.abs(totalTraffic - 100) > 0.01) {
        throw new Error('Variant traffic percentages must sum to 100%');
      }

      const test = new ABTest(testConfig);
      await test.save();
      
      console.log(`🧪 [A/B TEST] Created new test: ${test.name}`);
      return test;
    } catch (error) {
      console.error('A/B Test creation error:', error);
      throw error;
    }
  }

  // Get user's variant for a test
  async getUserVariant(testName, userId, sessionId, userMetadata = {}) {
    try {
      // Find the test
      const test = Array.from(this.cache.values()).find(t => t.name === testName);
      if (!test || test.status !== 'active') {
        return null;
      }

      // Check if user already has an assignment
      const existingAssignment = await UserTestAssignment.findOne({
        testId: test._id,
        $or: [
          { userId: userId },
          { sessionId: sessionId }
        ]
      });

      if (existingAssignment) {
        return {
          variant: existingAssignment.variant,
          config: test.variants.find(v => v.name === existingAssignment.variant)?.config
        };
      }

      // Check if user matches target audience
      if (!this.matchesTargetAudience(test.targetAudience, userMetadata)) {
        return null;
      }

      // Assign user to a variant based on traffic percentages
      const variant = this.assignVariant(test.variants, userId, sessionId);
      
      // Save assignment
      const assignment = new UserTestAssignment({
        userId,
        sessionId,
        testId: test._id,
        variant: variant.name,
        metadata: userMetadata
      });
      
      await assignment.save();

      console.log(`🧪 [A/B TEST] Assigned user to variant ${variant.name} for test ${testName}`);
      
      return {
        variant: variant.name,
        config: variant.config
      };
    } catch (error) {
      console.error('A/B Test variant assignment error:', error);
      return null;
    }
  }

  // Check if user matches target audience
  matchesTargetAudience(targetAudience, userMetadata) {
    if (!targetAudience) return true;

    // Check user segments
    if (targetAudience.userSegments && targetAudience.userSegments.length > 0) {
      const userSegment = userMetadata.segment || 'unknown';
      if (!targetAudience.userSegments.includes(userSegment)) {
        return false;
      }
    }

    // Check categories
    if (targetAudience.categories && targetAudience.categories.length > 0) {
      const userCategory = userMetadata.category;
      if (userCategory && !targetAudience.categories.includes(userCategory)) {
        return false;
      }
    }

    // Check order value range
    if (targetAudience.minOrderValue || targetAudience.maxOrderValue) {
      const orderValue = userMetadata.orderValue || 0;
      if (targetAudience.minOrderValue && orderValue < targetAudience.minOrderValue) {
        return false;
      }
      if (targetAudience.maxOrderValue && orderValue > targetAudience.maxOrderValue) {
        return false;
      }
    }

    return true;
  }

  // Assign variant based on traffic percentages and consistent hashing
  assignVariant(variants, userId, sessionId) {
    // Use consistent hashing for deterministic assignment
    const hashInput = `${userId || sessionId}`;
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    const normalizedHash = Math.abs(hash) % 100;
    
    let cumulativePercentage = 0;
    for (const variant of variants) {
      cumulativePercentage += variant.trafficPercentage;
      if (normalizedHash < cumulativePercentage) {
        return variant;
      }
    }
    
    // Fallback to first variant
    return variants[0];
  }

  // Get displayAddOns configuration for A/B testing
  async getDisplayAddOnsConfig(productId, userId, sessionId, userMetadata = {}) {
    try {
      const testResult = await this.getUserVariant('displayaddons_optimization', userId, sessionId, userMetadata);
      
      if (!testResult) {
        // Return default configuration
        return {
          algorithm: 'hybrid',
          maxAddOns: 4,
          prioritizeRevenue: true,
          showRelatedProducts: true,
          variant: 'control'
        };
      }

      // Track that user saw this variant
      await analyticsService.trackEvent({
        eventType: 'displayaddons_shown',
        productId,
        userId,
        sessionId,
        metadata: {
          abTestVariant: testResult.variant,
          displayType: 'ab_test'
        }
      });

      return {
        ...testResult.config,
        variant: testResult.variant
      };
    } catch (error) {
      console.error('A/B Test displayAddOns config error:', error);
      // Return default on error
      return {
        algorithm: 'hybrid',
        maxAddOns: 4,
        prioritizeRevenue: true,
        showRelatedProducts: true,
        variant: 'control'
      };
    }
  }

  // Track conversion for A/B test
  async trackConversion(testName, userId, sessionId, conversionData = {}) {
    try {
      const assignment = await UserTestAssignment.findOne({
        testId: { $in: await ABTest.find({ name: testName }).distinct('_id') },
        $or: [
          { userId: userId },
          { sessionId: sessionId }
        ]
      });

      if (assignment) {
        await analyticsService.trackEvent({
          eventType: 'addon_purchase',
          userId,
          sessionId,
          metadata: {
            abTestName: testName,
            abTestVariant: assignment.variant,
            ...conversionData
          }
        });
      }
    } catch (error) {
      console.error('A/B Test conversion tracking error:', error);
    }
  }

  // Get test results and statistical analysis
  async getTestResults(testId) {
    try {
      const test = await ABTest.findById(testId);
      if (!test) {
        throw new Error('Test not found');
      }

      // Get assignments for each variant
      const assignments = await UserTestAssignment.aggregate([
        { $match: { testId: test._id } },
        { $group: { _id: '$variant', count: { $sum: 1 } } }
      ]);

      // Get conversion data from analytics
      const conversionData = await analyticsService.getAddOnConversionAnalytics({
        startDate: test.startDate,
        endDate: test.endDate || new Date()
      });

      // Calculate results for each variant
      const variantResults = [];
      for (const variant of test.variants) {
        const assignmentCount = assignments.find(a => a._id === variant.name)?.count || 0;
        
        // Calculate conversion rate and other metrics
        const conversions = conversionData.filter(c => 
          c.metadata?.abTestVariant === variant.name
        );
        
        const conversionRate = assignmentCount > 0 
          ? conversions.length / assignmentCount 
          : 0;

        variantResults.push({
          variant: variant.name,
          sampleSize: assignmentCount,
          conversionRate,
          conversions: conversions.length,
          confidence: this.calculateConfidence(assignmentCount, conversions.length, test.confidenceLevel)
        });
      }

      // Determine winner and statistical significance
      const winner = this.determineWinner(variantResults);
      const statisticalSignificance = this.checkStatisticalSignificance(variantResults, test.confidenceLevel);

      return {
        test,
        variantResults,
        winner,
        statisticalSignificance,
        isComplete: test.status === 'completed' || this.shouldCompleteTest(test, variantResults)
      };
    } catch (error) {
      console.error('A/B Test results error:', error);
      throw error;
    }
  }

  // Calculate confidence interval
  calculateConfidence(sampleSize, conversions, confidenceLevel) {
    if (sampleSize === 0) return 0;
    
    const p = conversions / sampleSize;
    const z = confidenceLevel === 0.95 ? 1.96 : 2.58; // 95% or 99%
    const margin = z * Math.sqrt((p * (1 - p)) / sampleSize);
    
    return {
      rate: p,
      lower: Math.max(0, p - margin),
      upper: Math.min(1, p + margin),
      margin
    };
  }

  // Determine winner based on conversion rates
  determineWinner(variantResults) {
    if (variantResults.length === 0) return null;
    
    return variantResults.reduce((winner, current) => 
      current.conversionRate > winner.conversionRate ? current : winner
    );
  }

  // Check statistical significance
  checkStatisticalSignificance(variantResults, confidenceLevel) {
    if (variantResults.length < 2) return false;
    
    // Simple check: confidence intervals don't overlap
    const sorted = variantResults.sort((a, b) => b.conversionRate - a.conversionRate);
    const best = sorted[0];
    const second = sorted[1];
    
    if (!best.confidence || !second.confidence) return false;
    
    return best.confidence.lower > second.confidence.upper;
  }

  // Check if test should be completed
  shouldCompleteTest(test, variantResults) {
    // Check minimum sample size
    const totalSamples = variantResults.reduce((sum, v) => sum + v.sampleSize, 0);
    if (totalSamples < test.minSampleSize) return false;
    
    // Check if end date passed
    if (test.endDate && new Date() > test.endDate) return true;
    
    // Check statistical significance
    return this.checkStatisticalSignificance(variantResults, test.confidenceLevel);
  }

  // Start a test
  async startTest(testId) {
    try {
      const test = await ABTest.findByIdAndUpdate(
        testId,
        { status: 'active', startDate: new Date() },
        { new: true }
      );
      
      await this.refreshActiveTests();
      console.log(`🧪 [A/B TEST] Started test: ${test.name}`);
      return test;
    } catch (error) {
      console.error('A/B Test start error:', error);
      throw error;
    }
  }

  // Complete a test
  async completeTest(testId) {
    try {
      const results = await this.getTestResults(testId);
      
      const test = await ABTest.findByIdAndUpdate(
        testId,
        { 
          status: 'completed',
          'results.winner': results.winner?.variant,
          'results.statisticalSignificance': results.statisticalSignificance,
          'results.variantResults': results.variantResults,
          'results.completedAt': new Date()
        },
        { new: true }
      );
      
      await this.refreshActiveTests();
      console.log(`🧪 [A/B TEST] Completed test: ${test.name}, Winner: ${results.winner?.variant}`);
      return test;
    } catch (error) {
      console.error('A/B Test completion error:', error);
      throw error;
    }
  }
}

// Create singleton instance
const abTestingService = new ABTestingService();

export default abTestingService;
export { ABTest, UserTestAssignment };