import { useState, useEffect, useCallback, useRef } from 'react';
import { robustStorage, isIncognitoMode } from '../utils/storageUtils';

// Dashboard cache entry interface
interface DashboardCacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  lastAccessed: number;
  version: string; // For cache invalidation
}

// Cache configuration interface
interface CacheConfig {
  ttl?: number;
  useSessionStorage?: boolean;
  version?: string;
  enabled?: boolean;
}

// Flexible cache manager that supports both memory and sessionStorage
class FlexibleCacheManager {
  private memoryCache = new Map<string, DashboardCacheEntry<any>>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly SESSION_STORAGE_PREFIX = 'dashboard_cache_';
  private readonly CACHE_VERSION = '1.0.0';

  // Generate cache key with flexible parameters
  generateKey(prefix: string, ...params: (string | number)[]): string {
    return `${prefix}:${params.join(':')}`;
  }

  // Generate tile cache key
  generateTileKey(tileId: string, type: string, ...params: (string | number)[]): string {
    const key = this.generateKey('tile', tileId, type, ...params);
    console.log(`🔑 Generated tile cache key: ${key} for tileId: ${tileId}, type: ${type}, params:`, params);
    return key;
  }

  // Generate dashboard cache key
  generateDashboardKey(dashboardId: string, ...params: (string | number)[]): string {
    return this.generateKey('dashboard', dashboardId, ...params);
  }

  // Generate API cache key
  generateAPIKey(endpoint: string, ...params: (string | number)[]): string {
    return this.generateKey('api', endpoint, ...params);
  }

  // Check if cache entry is valid
  isCacheValid(entry: DashboardCacheEntry<any>, version?: string): boolean {
    const timeValid = Date.now() - entry.timestamp < entry.ttl;
    const versionValid = !version || entry.version === version;
    return timeValid && versionValid;
  }

  // Get from robust storage
  private getFromRobustStorage<T>(key: string): DashboardCacheEntry<T> | null {
    try {
      const stored = robustStorage.get<DashboardCacheEntry<T>>(`${this.SESSION_STORAGE_PREFIX}${key}`);
      return stored || null;
    } catch (error) {
      console.warn('Failed to parse cache entry from robust storage:', error);
      return null;
    }
  }

  // Set to robust storage
  private setToRobustStorage<T>(key: string, entry: DashboardCacheEntry<T>): void {
    try {
      robustStorage.set(`${this.SESSION_STORAGE_PREFIX}${key}`, entry, entry.ttl);
    } catch (error) {
      console.warn('Failed to store cache entry to robust storage:', error);
    }
  }

  // Remove from robust storage
  private removeFromRobustStorage(key: string): void {
    try {
      robustStorage.remove(`${this.SESSION_STORAGE_PREFIX}${key}`);
    } catch (error) {
      console.warn('Failed to remove cache entry from robust storage:', error);
    }
  }

  // Get cached data from memory or sessionStorage
  get<T>(key: string, config: CacheConfig = {}): T | null {
    const { version = this.CACHE_VERSION, useSessionStorage = true } = config;
    
    console.log(`🔍 Cache get: ${key}, version: ${version}, useSessionStorage: ${useSessionStorage}`);
    
    // Try memory cache first
    let entry = this.memoryCache.get(key);
    console.log(`🧠 Memory cache ${entry ? 'hit' : 'miss'} for key: ${key}`);
    
    // If not in memory and robust storage is enabled, try robust storage
    if (!entry && useSessionStorage) {
      const robustEntry = this.getFromRobustStorage<T>(key);
      if (robustEntry) {
        console.log(`💾 Robust storage hit for key: ${key}`);
        // Restore to memory cache
        this.memoryCache.set(key, robustEntry);
        entry = robustEntry;
      } else {
        console.log(`💾 Robust storage miss for key: ${key}`);
      }
    }
    
    if (!entry || !this.isCacheValid(entry, version)) {
      if (entry) {
        const age = Date.now() - entry.timestamp;
        const timeValid = age < entry.ttl;
        const versionValid = !version || entry.version === version;
        console.log(`❌ Cache invalid for key: ${key}`);
        console.log(`   Age: ${Math.round(age / 1000)}s, TTL: ${Math.round(entry.ttl / 1000)}s, Time valid: ${timeValid}`);
        console.log(`   Version: ${entry.version}, Expected: ${version}, Version valid: ${versionValid}`);
      } else {
        console.log(`❌ Cache invalid for key: ${key} - no entry found`);
      }
      this.delete(key);
      return null;
    }
    
    console.log(`✅ Cache valid for key: ${key}`);
    
    // Update last accessed time
    entry.lastAccessed = Date.now();
    if (useSessionStorage) {
      this.setToSessionStorage(key, entry);
    }
    
    return entry.data;
  }

  // Set cached data to memory and optionally sessionStorage
  set<T>(key: string, data: T, config: CacheConfig = {}): void {
    const { 
      ttl = this.DEFAULT_TTL, 
      useSessionStorage = true, 
      version = this.CACHE_VERSION 
    } = config;
    
    const entry: DashboardCacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      lastAccessed: Date.now(),
      version,
    };
    
    // Store in memory
    this.memoryCache.set(key, entry);
    
    // Store in sessionStorage if enabled
    if (useSessionStorage) {
      this.setToSessionStorage(key, entry);
    }
  }

  // Delete from both memory and sessionStorage
  delete(key: string): boolean {
    const memoryDeleted = this.memoryCache.delete(key);
    this.removeFromSessionStorage(key);
    return memoryDeleted;
  }

  // Clear all cache
  clear(): void {
    this.memoryCache.clear();
    
    // Clear sessionStorage
    try {
      const keys = Object.keys(sessionStorage);
      keys.forEach(key => {
        if (key.startsWith(this.SESSION_STORAGE_PREFIX)) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to clear sessionStorage cache:', error);
    }
  }

  // Clear cache by pattern
  clearByPattern(pattern: string): void {
    // Clear from memory
    for (const [key] of this.memoryCache) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key);
      }
    }
    
    // Clear from sessionStorage
    try {
      const keys = Object.keys(sessionStorage);
      keys.forEach(key => {
        if (key.startsWith(this.SESSION_STORAGE_PREFIX) && key.includes(pattern)) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to clear sessionStorage cache by pattern:', error);
    }
  }

  // Clear cache for specific dashboard
  clearDashboard(dashboardId: string): void {
    this.clearByPattern(`dashboard:${dashboardId}`);
    this.clearByPattern(`tile:${dashboardId}`);
  }

  // Clear cache for specific tile
  clearTile(tileId: string): void {
    this.clearByPattern(`tile:${tileId}`);
  }

  // Clear cache for specific API endpoint
  clearAPI(endpoint: string): void {
    this.clearByPattern(`api:${endpoint}`);
  }

  // Get cache statistics
  getStats(): { 
    memorySize: number; 
    sessionStorageSize: number;
    entries: Array<{ key: string; age: number; ttl: number; source: 'memory' | 'sessionStorage' }> 
  } {
    const memoryEntries = Array.from(this.memoryCache.entries()).map(([key, entry]) => ({
      key,
      age: Date.now() - entry.timestamp,
      ttl: entry.ttl,
      source: 'memory' as const,
    }));

    let sessionStorageEntries: Array<{ key: string; age: number; ttl: number; source: 'sessionStorage' }> = [];
    try {
      const keys = Object.keys(sessionStorage);
      sessionStorageEntries = keys
        .filter(key => key.startsWith(this.SESSION_STORAGE_PREFIX))
        .map(key => {
          const cacheKey = key.replace(this.SESSION_STORAGE_PREFIX, '');
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const entry = JSON.parse(stored) as DashboardCacheEntry<any>;
            return {
              key: cacheKey,
              age: Date.now() - entry.timestamp,
              ttl: entry.ttl,
              source: 'sessionStorage' as const,
            };
          }
          return null;
        })
        .filter(Boolean) as Array<{ key: string; age: number; ttl: number; source: 'sessionStorage' }>;
    } catch (error) {
      console.warn('Failed to get sessionStorage cache stats:', error);
    }

    return {
      memorySize: this.memoryCache.size,
      sessionStorageSize: sessionStorageEntries.length,
      entries: [...memoryEntries, ...sessionStorageEntries],
    };
  }

  // Cleanup expired entries
  cleanup(): void {
    // Cleanup memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (!this.isCacheValid(entry)) {
        this.memoryCache.delete(key);
      }
    }
    
    // Cleanup sessionStorage
    try {
      const keys = Object.keys(sessionStorage);
      keys.forEach(key => {
        if (key.startsWith(this.SESSION_STORAGE_PREFIX)) {
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const entry = JSON.parse(stored) as DashboardCacheEntry<any>;
            if (!this.isCacheValid(entry)) {
              sessionStorage.removeItem(key);
            }
          }
        }
      });
    } catch (error) {
      console.warn('Failed to cleanup sessionStorage cache:', error);
    }
  }
}

// Global cache manager instance
const flexibleCache = new FlexibleCacheManager();

// Note: This cache system is separate from the old useAPI cache system
// The old useAPI system uses a simple Map in memory, while this system
// uses both memory and sessionStorage for persistence across navigation

// Cleanup expired entries every 5 minutes
setInterval(() => {
  flexibleCache.cleanup();
}, 5 * 60 * 1000);

// Flexible cache hook with sessionStorage support
export function useFlexibleCache<T>(
  cacheKey: string,
  fetchFunction: () => Promise<T>,
  options: CacheConfig & {
    enabled?: boolean;
    forceRefresh?: boolean;
  } = {}
) {
  const {
    ttl = 5 * 60 * 1000, // 5 minutes default
    useSessionStorage = true,
    version = '1.0.0',
    enabled = true,
    forceRefresh = false,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const fetchFunctionRef = useRef(fetchFunction);
  const hasInitialized = useRef(false);

  // Update the ref when fetchFunction changes
  useEffect(() => {
    fetchFunctionRef.current = fetchFunction;
  }, [fetchFunction]);

  const fetchData = useCallback(async (bypassCache = false) => {
    if (!enabled) return;

    // Check cache first (unless bypassing)
    if (!bypassCache && !forceRefresh) {
      console.log(`🔍 Checking cache for key: ${cacheKey}`);
      const cachedData = flexibleCache.get<T>(cacheKey, { version, useSessionStorage });
      if (cachedData) {
        console.log(`✅ Cache hit for key: ${cacheKey}`);
        setData(cachedData);
        setError(null);
        return cachedData;
      } else {
        console.log(`❌ Cache miss for key: ${cacheKey}`);
      }
    }

    setLoading(true);
    setError(null);

    try {
      console.log(`🌐 Making API call for key: ${cacheKey}`);
      const result = await fetchFunctionRef.current();
      
      // Cache the result
      console.log(`💾 Caching result for key: ${cacheKey}`);
      flexibleCache.set(cacheKey, result, { ttl, useSessionStorage, version });
      
      setData(result);
      setLastFetch(Date.now());
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [cacheKey, ttl, useSessionStorage, version, enabled, forceRefresh]);

  // Initial fetch - only run once when component mounts
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      fetchData(forceRefresh);
    }
  }, [fetchData, forceRefresh]);

  // Force refresh function
  const refresh = useCallback(() => {
    return fetchData(true);
  }, [fetchData]);

  // Clear cache for this key
  const clearCache = useCallback(() => {
    flexibleCache.delete(cacheKey);
    setData(null);
    setLastFetch(null);
  }, [cacheKey]);

  return {
    data,
    loading,
    error,
    lastFetch,
    refresh,
    clearCache,
    fetchData,
  };
}

// Tile-specific cache hook with flexible parameters
export function useTileCache<T>(
  tileId: string,
  type: string,
  fetchFunction: () => Promise<T>,
  params: (string | number)[] = [],
  options: CacheConfig & {
    enabled?: boolean;
    forceRefresh?: boolean;
  } = {}
) {
  const cacheKey = flexibleCache.generateTileKey(tileId, type, ...params);
  
  return useFlexibleCache(cacheKey, fetchFunction, options);
}

// Dashboard state cache hook
export function useDashboardStateCache<T>(
  dashboardId: string,
  fetchFunction: () => Promise<T>,
  params: (string | number)[] = [],
  options: CacheConfig & {
    enabled?: boolean;
    forceRefresh?: boolean;
  } = {}
) {
  const cacheKey = flexibleCache.generateDashboardKey(dashboardId, ...params);
  
  return useFlexibleCache(cacheKey, fetchFunction, options);
}

// API cache hook for general API calls
export function useAPICache<T>(
  endpoint: string,
  fetchFunction: () => Promise<T>,
  params: (string | number)[] = [],
  options: CacheConfig & {
    enabled?: boolean;
    forceRefresh?: boolean;
  } = {}
) {
  const cacheKey = flexibleCache.generateAPIKey(endpoint, ...params);
  
  return useFlexibleCache(cacheKey, fetchFunction, options);
}

// Cache management utilities
export const cacheUtils = {
  // Clear all cache
  clearAll: () => flexibleCache.clear(),
  
  // Clear dashboard cache
  clearDashboard: (dashboardId: string) => flexibleCache.clearDashboard(dashboardId),
  
  // Clear tile cache
  clearTile: (tileId: string) => flexibleCache.clearTile(tileId),
  
  // Clear API cache
  clearAPI: (endpoint: string) => flexibleCache.clearAPI(endpoint),
  
  // Clear cache by pattern
  clearByPattern: (pattern: string) => flexibleCache.clearByPattern(pattern),
  
  // Get cache statistics
  getStats: () => flexibleCache.getStats(),
  
  // Force refresh specific cache entry
  forceRefresh: (key: string) => flexibleCache.delete(key),
  
  // Generate cache keys
  generateTileKey: (tileId: string, type: string, ...params: (string | number)[]) => 
    flexibleCache.generateTileKey(tileId, type, ...params),
  generateDashboardKey: (dashboardId: string, ...params: (string | number)[]) => 
    flexibleCache.generateDashboardKey(dashboardId, ...params),
  generateAPIKey: (endpoint: string, ...params: (string | number)[]) => 
    flexibleCache.generateAPIKey(endpoint, ...params),
};

// Legacy exports for backward compatibility
export const useDashboardCache = useFlexibleCache;
export const dashboardCacheUtils = cacheUtils;

export default flexibleCache;
