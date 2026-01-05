/**
 * Utility function to clean up dashboard data before sending to backend
 * Primary focus: Simplify pagination states to prevent DynamoDB nesting issues
 */

export function cleanupPaginationStates(dashboardConfig: any): any {
  if (!dashboardConfig || typeof dashboardConfig !== 'object') {
    return dashboardConfig;
  }

  const cleaned = JSON.parse(JSON.stringify(dashboardConfig));

  // Clean up tiles in all tabs
  if (cleaned.tabs && Array.isArray(cleaned.tabs)) {
    cleaned.tabs.forEach((tab: any) => {
      if (tab.tiles && Array.isArray(tab.tiles)) {
        tab.tiles.forEach((tile: any) => {
          if (tile.paginationState) {
            // Simplify pagination state to prevent DynamoDB nesting issues
            tile.paginationState = simplifyPaginationState(tile.paginationState);
          }
        });
      }
    });
  }

  return cleaned;
}

function simplifyPaginationState(paginationState: any): any {
  if (!paginationState || typeof paginationState !== 'object') {
    return paginationState;
  }

  const lastEvalKeys = paginationState.lastEvaluatedKeys || [];
  
  // Check if this pagination state has problematic nesting
  let hasNestingIssues = false;
  
  if (Array.isArray(lastEvalKeys)) {
    for (const key of lastEvalKeys) {
      if (key && typeof key === 'object') {
        // Check for deep nesting (like the recursive sponsor_last_key issue)
        const depth = checkObjectDepth(key);
        if (depth > 8) {  // Only simplify if deeply nested
          hasNestingIssues = true;
          console.warn(`🚨 Found problematic pagination nesting (depth: ${depth})`);
          break;
        }
        
        // Check for recursive patterns specifically
        if (key.query_type === 'union_politician_pagination') {
          if (hasRecursiveSponsorKeys(key)) {
            hasNestingIssues = true;
            console.warn(`🚨 Found recursive sponsor_last_key pattern`);
            break;
          }
        }
      }
    }
  }

  // If no nesting issues, preserve original pagination state
  if (!hasNestingIssues) {
    console.log("✅ Pagination state is clean, preserving original structure");
    return paginationState;
  }

  // Only if there are nesting issues, simplify to load more count
  const totalLoaded = paginationState.totalResultsLoaded || 0;
  
  // Auto-detect page size from offset pattern if available
  let resultsPerPage = 25; // Default fallback
  
  if (Array.isArray(lastEvalKeys) && lastEvalKeys.length > 0) {
    const firstKey = lastEvalKeys[0];
    if (firstKey && typeof firstKey === 'object' && 'offset' in firstKey) {
      const detectedPageSize = firstKey.offset;
      if (detectedPageSize > 0) {
        resultsPerPage = detectedPageSize;
      }
    }
  }

  // Calculate load more count
  let loadMoreCount = 0;
  if (totalLoaded > resultsPerPage) {
    loadMoreCount = Math.floor((totalLoaded - resultsPerPage) / resultsPerPage);
  }

  console.log(`🧹 Simplifying problematic pagination: ${totalLoaded} results → ${loadMoreCount} load mores`);

  // Return simplified state for problematic cases only
  return {
    loadMoreCount: loadMoreCount,
    totalResultsLoaded: totalLoaded,
    hasMore: paginationState.hasMore || false,
    pageSize: resultsPerPage,
    _simplified: true  // Mark as simplified so frontend knows
  };
}

function checkObjectDepth(obj: any, currentDepth: number = 0): number {
  if (!obj || typeof obj !== 'object' || currentDepth > 20) {
    return currentDepth;
  }

  let maxDepth = currentDepth;
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      const depth = checkObjectDepth(value, currentDepth + 1);
      maxDepth = Math.max(maxDepth, depth);
    }
  }

  return maxDepth;
}

function hasRecursiveSponsorKeys(obj: any, maxDepth: number = 3): boolean {
  let current = obj;
  let depth = 0;
  
  while (current && typeof current === 'object' && current.sponsor_last_key) {
    current = current.sponsor_last_key;
    depth++;
    if (depth >= maxDepth) {
      return true;
    }
  }
  
  return false;
}

export function validateDashboardForSaving(dashboardConfig: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    // Check for overly large payloads
    const jsonString = JSON.stringify(dashboardConfig);
    
    // Basic size check (DynamoDB has 400KB item limit)
    if (jsonString.length > 300000) { // 300KB rough limit
      errors.push(`Dashboard payload is very large (${jsonString.length} bytes)`);
    }

    // Check for pagination states with excessive load more counts
    if (dashboardConfig.tabs) {
      dashboardConfig.tabs.forEach((tab: any, tabIndex: number) => {
        if (tab.tiles) {
          tab.tiles.forEach((tile: any, tileIndex: number) => {
            if (tile.paginationState) {
              const loadMoreCount = tile.paginationState.loadMoreCount || 0;
              if (loadMoreCount > 20) { // Reasonable limit
                errors.push(`Tab ${tabIndex}, Tile ${tileIndex}: Excessive load more count (${loadMoreCount})`);
              }
              
              // Check if old complex pagination keys still exist
              if (tile.paginationState.lastEvaluatedKeys) {
                errors.push(`Tab ${tabIndex}, Tile ${tileIndex}: Still contains complex pagination keys`);
              }
            }
          });
        }
      });
    }

  } catch (error) {
    errors.push(`Error validating dashboard: ${error}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}