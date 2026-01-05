/**
 * Quick test to verify the cleanup function works with the problematic congress bills data
 */

import { cleanupPaginationStates, validateDashboardForSaving } from '../utils/dashboardCleanup';

// Simplified version of the problematic structure from user's request
const problematicDashboard = {
  tabs: [
    {
      tiles: [
        {
          title: "Amy Klobuchar",
          paginationState: {
            lastEvaluatedKeys: [
              {
                "query_type": "union_politician_pagination",
                "sponsor_last_key": {
                  "query_type": "union_politician_pagination",
                  "sponsor_last_key": {
                    "query_type": "union_politician_pagination",
                    "sponsor_last_key": {
                      "query_type": "union_politician_pagination",
                      "sponsor_last_key": {
                        // This would continue for 40+ levels...
                        "query_type": "union_politician_pagination",
                        "politician_name": "Amy Klobuchar"
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    }
  ]
};

// Test the cleanup
console.log('🧪 Testing dashboard cleanup...');
const cleaned = cleanupPaginationStates(problematicDashboard);
console.log('✅ Cleanup completed');

// Test validation
const validation = validateDashboardForSaving(cleaned);
console.log('🔍 Validation result:', validation);

console.log('📊 Original structure depth:', JSON.stringify(problematicDashboard, null, 2).split('\n').length);
console.log('📊 Cleaned structure depth:', JSON.stringify(cleaned, null, 2).split('\n').length);