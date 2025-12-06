import { NewsArticle, NewsSearchRequest } from '../services/api';

// Cache entry structure
interface CacheEntry {
  articles: NewsArticle[];
  total: number;
  timestamp: number;
  searchParams: NewsSearchRequest;
}

// Cache key generator - creates a hash from search parameters
function generateCacheKey(searchParams: NewsSearchRequest, tileId?: string): string {
  // Create a normalized version of search params (remove offset, limit for cache key)
  const normalizedParams = {
    query: searchParams.query,
    dateRange: searchParams.dateRange,
    limit: searchParams.limit,
    // Don't include offset in cache key - we cache by page
  };
  
  const paramsString = JSON.stringify(normalizedParams);
  const baseKey = tileId ? `news-tile-${tileId}` : 'news-page';
  return `${baseKey}-${btoa(paramsString).replace(/[^a-zA-Z0-9]/g, '')}`;
}

// Generate a page-specific cache key
function generatePageCacheKey(baseKey: string, page: number, pageSize: number): string {
  return `${baseKey}-page-${page}-size-${pageSize}`;
}

// News Cache Manager
class NewsCacheManager {
  private memoryCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
  private readonly STORAGE_PREFIX = 'news_cache_';

  // Get cache key for a search
  getCacheKey(searchParams: NewsSearchRequest, tileId?: string): string {
    return generateCacheKey(searchParams, tileId);
  }

  // Get cached articles for a specific page
  getCachedPage(
    searchParams: NewsSearchRequest,
    page: number,
    pageSize: number,
    tileId?: string
  ): { articles: NewsArticle[]; total: number } | null {
    const baseKey = this.getCacheKey(searchParams, tileId);
    const pageKey = generatePageCacheKey(baseKey, page, pageSize);
    
    // Check memory cache first
    const memoryEntry = this.memoryCache.get(pageKey);
    if (memoryEntry && this.isValid(memoryEntry)) {
      console.log(`📦 Cache HIT (memory): ${pageKey}`);
      return {
        articles: memoryEntry.articles,
        total: memoryEntry.total,
      };
    }

    // Check sessionStorage
    try {
      const stored = sessionStorage.getItem(this.STORAGE_PREFIX + pageKey);
      if (stored) {
        const entry: CacheEntry = JSON.parse(stored);
        if (this.isValid(entry)) {
          // Restore to memory cache
          this.memoryCache.set(pageKey, entry);
          console.log(`📦 Cache HIT (sessionStorage): ${pageKey}`);
          return {
            articles: entry.articles,
            total: entry.total,
          };
        } else {
          // Expired, remove it
          sessionStorage.removeItem(this.STORAGE_PREFIX + pageKey);
        }
      }
    } catch (error) {
      console.warn('Error reading from sessionStorage:', error);
    }

    console.log(`📦 Cache MISS: ${pageKey}`);
    return null;
  }

  // Store articles in cache
  setCachedPage(
    searchParams: NewsSearchRequest,
    page: number,
    pageSize: number,
    articles: NewsArticle[],
    total: number,
    tileId?: string
  ): void {
    const baseKey = this.getCacheKey(searchParams, tileId);
    const pageKey = generatePageCacheKey(baseKey, page, pageSize);
    
    const entry: CacheEntry = {
      articles,
      total,
      timestamp: Date.now(),
      searchParams,
    };

    // Store in memory cache
    this.memoryCache.set(pageKey, entry);
    console.log(`💾 Cached page: ${pageKey} (${articles.length} articles)`);

    // Store in sessionStorage
    try {
      sessionStorage.setItem(this.STORAGE_PREFIX + pageKey, JSON.stringify(entry));
    } catch (error) {
      console.warn('Error writing to sessionStorage:', error);
      // If storage is full, try to clear old entries
      this.clearExpiredEntries();
      try {
        sessionStorage.setItem(this.STORAGE_PREFIX + pageKey, JSON.stringify(entry));
      } catch (retryError) {
        console.warn('Failed to cache after clearing expired entries:', retryError);
      }
    }
  }

  // Check if cache entry is still valid
  private isValid(entry: CacheEntry): boolean {
    const age = Date.now() - entry.timestamp;
    return age < this.CACHE_EXPIRY_MS;
  }

  // Clear expired entries from sessionStorage
  private clearExpiredEntries(): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(this.STORAGE_PREFIX)) {
          try {
            const entry: CacheEntry = JSON.parse(sessionStorage.getItem(key) || '{}');
            if (!this.isValid(entry)) {
              keysToRemove.push(key);
            }
          } catch (e) {
            // Invalid JSON, remove it
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      console.log(`🧹 Cleared ${keysToRemove.length} expired cache entries`);
    } catch (error) {
      console.warn('Error clearing expired entries:', error);
    }
  }

  // Clear all cache for a specific tile or page
  clearCache(searchParams: NewsSearchRequest, tileId?: string): void {
    const baseKey = this.getCacheKey(searchParams, tileId);
    
    // Clear from memory cache
    const keysToRemove: string[] = [];
    this.memoryCache.forEach((_, key) => {
      if (key.startsWith(baseKey)) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach(key => this.memoryCache.delete(key));

    // Clear from sessionStorage
    try {
      const keysToRemoveStorage: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(this.STORAGE_PREFIX + baseKey)) {
          keysToRemoveStorage.push(key);
        }
      }
      keysToRemoveStorage.forEach(key => sessionStorage.removeItem(key));
      console.log(`🗑️ Cleared cache for: ${baseKey} (${keysToRemove.length} memory, ${keysToRemoveStorage.length} storage entries)`);
    } catch (error) {
      console.warn('Error clearing cache from sessionStorage:', error);
    }
  }

  // Clear all cache (useful for testing or manual cleanup)
  clearAllCache(): void {
    this.memoryCache.clear();
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(this.STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      console.log(`🗑️ Cleared all cache (${keysToRemove.length} entries)`);
    } catch (error) {
      console.warn('Error clearing all cache:', error);
    }
  }

  // Get all cached pages for a search (useful for prefetching)
  getAllCachedPages(searchParams: NewsSearchRequest, tileId?: string): Map<number, NewsArticle[]> {
    const baseKey = this.getCacheKey(searchParams, tileId);
    const cachedPages = new Map<number, NewsArticle[]>();
    
    // Check memory cache
    this.memoryCache.forEach((entry, key) => {
      if (key.startsWith(baseKey) && this.isValid(entry)) {
        // Extract page number from key (format: baseKey-page-X-size-Y)
        const match = key.match(/page-(\d+)-size-(\d+)$/);
        if (match) {
          const page = parseInt(match[1], 10);
          cachedPages.set(page, entry.articles);
        }
      }
    });

    // Check sessionStorage
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(this.STORAGE_PREFIX + baseKey)) {
          try {
            const entry: CacheEntry = JSON.parse(sessionStorage.getItem(key) || '{}');
            if (this.isValid(entry)) {
              const match = key.replace(this.STORAGE_PREFIX, '').match(/page-(\d+)-size-(\d+)$/);
              if (match) {
                const page = parseInt(match[1], 10);
                if (!cachedPages.has(page)) {
                  cachedPages.set(page, entry.articles);
                }
              }
            }
          } catch (e) {
            // Invalid entry, skip
          }
        }
      }
    } catch (error) {
      console.warn('Error reading cached pages from sessionStorage:', error);
    }

    return cachedPages;
  }
}

// Export singleton instance
export const newsCache = new NewsCacheManager();






