/**
 * Storage utility that handles incognito mode and storage limitations gracefully
 * Falls back to memory-only storage when localStorage/sessionStorage are unavailable
 */

interface StorageEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number;
}

class RobustStorageManager {
  private memoryStorage = new Map<string, StorageEntry<any>>();
  private readonly STORAGE_PREFIX = 'cosine_dashboard_';
  private readonly DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Check if localStorage is available and working
  private isLocalStorageAvailable(): boolean {
    try {
      const testKey = `${this.STORAGE_PREFIX}test`;
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.warn('localStorage not available:', error);
      return false;
    }
  }

  // Check if sessionStorage is available and working
  private isSessionStorageAvailable(): boolean {
    try {
      const testKey = `${this.STORAGE_PREFIX}test`;
      sessionStorage.setItem(testKey, 'test');
      sessionStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.warn('sessionStorage not available:', error);
      return false;
    }
  }

  // Get from localStorage with fallback
  private getFromLocalStorage<T>(key: string): T | null {
    if (!this.isLocalStorageAvailable()) {
      return null;
    }

    try {
      const stored = localStorage.getItem(`${this.STORAGE_PREFIX}${key}`);
      if (!stored) return null;

      const entry = JSON.parse(stored) as StorageEntry<T>;
      
      // Check TTL if specified
      if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
        this.removeFromLocalStorage(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn('Failed to parse localStorage entry:', error);
      return null;
    }
  }

  // Set to localStorage with fallback
  private setToLocalStorage<T>(key: string, data: T, ttl?: number): void {
    if (!this.isLocalStorageAvailable()) {
      console.warn('localStorage not available, falling back to memory storage');
      return;
    }

    try {
      const entry: StorageEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttl || this.DEFAULT_TTL
      };
      
      localStorage.setItem(`${this.STORAGE_PREFIX}${key}`, JSON.stringify(entry));
    } catch (error) {
      console.warn('Failed to store to localStorage:', error);
    }
  }

  // Remove from localStorage
  private removeFromLocalStorage(key: string): void {
    if (!this.isLocalStorageAvailable()) {
      return;
    }

    try {
      localStorage.removeItem(`${this.STORAGE_PREFIX}${key}`);
    } catch (error) {
      console.warn('Failed to remove from localStorage:', error);
    }
  }

  // Get from sessionStorage with fallback
  private getFromSessionStorage<T>(key: string): T | null {
    if (!this.isSessionStorageAvailable()) {
      return null;
    }

    try {
      const stored = sessionStorage.getItem(`${this.STORAGE_PREFIX}${key}`);
      if (!stored) return null;

      const entry = JSON.parse(stored) as StorageEntry<T>;
      
      // Check TTL if specified
      if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
        this.removeFromSessionStorage(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn('Failed to parse sessionStorage entry:', error);
      return null;
    }
  }

  // Set to sessionStorage with fallback
  private setToSessionStorage<T>(key: string, data: T, ttl?: number): void {
    if (!this.isSessionStorageAvailable()) {
      console.warn('sessionStorage not available, falling back to memory storage');
      return;
    }

    try {
      const entry: StorageEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttl || this.DEFAULT_TTL
      };
      
      sessionStorage.setItem(`${this.STORAGE_PREFIX}${key}`, JSON.stringify(entry));
    } catch (error) {
      console.warn('Failed to store to sessionStorage:', error);
    }
  }

  // Remove from sessionStorage
  private removeFromSessionStorage(key: string): void {
    if (!this.isSessionStorageAvailable()) {
      return;
    }

    try {
      sessionStorage.removeItem(`${this.STORAGE_PREFIX}${key}`);
    } catch (error) {
      console.warn('Failed to remove from sessionStorage:', error);
    }
  }

  // Public methods with fallback strategy

  /**
   * Get data from storage with priority: sessionStorage -> localStorage -> memory
   */
  get<T>(key: string): T | null {
    // Try sessionStorage first (most recent)
    let data = this.getFromSessionStorage<T>(key);
    if (data !== null) {
      return data;
    }

    // Try localStorage second (persistent)
    data = this.getFromLocalStorage<T>(key);
    if (data !== null) {
      return data;
    }

    // Fall back to memory storage
    const memoryEntry = this.memoryStorage.get(key);
    if (memoryEntry) {
      // Check TTL if specified
      if (memoryEntry.ttl && Date.now() - memoryEntry.timestamp > memoryEntry.ttl) {
        this.memoryStorage.delete(key);
        return null;
      }
      return memoryEntry.data;
    }

    return null;
  }

  /**
   * Set data to storage with priority: sessionStorage -> localStorage -> memory
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // Store in sessionStorage (for current session)
    this.setToSessionStorage(key, data, ttl);

    // Store in localStorage (for persistence across sessions)
    this.setToLocalStorage(key, data, ttl);

    // Always store in memory as final fallback
    this.memoryStorage.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.DEFAULT_TTL
    });
  }

  /**
   * Remove data from all storage layers
   */
  remove(key: string): void {
    this.removeFromSessionStorage(key);
    this.removeFromLocalStorage(key);
    this.memoryStorage.delete(key);
  }

  /**
   * Clear all data from all storage layers
   */
  clear(): void {
    // Clear memory storage
    this.memoryStorage.clear();

    // Clear localStorage
    if (this.isLocalStorageAvailable()) {
      try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith(this.STORAGE_PREFIX)) {
            localStorage.removeItem(key);
          }
        });
      } catch (error) {
        console.warn('Failed to clear localStorage:', error);
      }
    }

    // Clear sessionStorage
    if (this.isSessionStorageAvailable()) {
      try {
        const keys = Object.keys(sessionStorage);
        keys.forEach(key => {
          if (key.startsWith(this.STORAGE_PREFIX)) {
            sessionStorage.removeItem(key);
          }
        });
      } catch (error) {
        console.warn('Failed to clear sessionStorage:', error);
      }
    }
  }

  /**
   * Check if we're running in incognito mode
   */
  isIncognitoMode(): boolean {
    return !this.isLocalStorageAvailable() || !this.isSessionStorageAvailable();
  }

  /**
   * Get storage status for debugging
   */
  getStorageStatus() {
    return {
      localStorageAvailable: this.isLocalStorageAvailable(),
      sessionStorageAvailable: this.isSessionStorageAvailable(),
      memoryEntries: this.memoryStorage.size,
      isIncognitoMode: this.isIncognitoMode()
    };
  }
}

// Create singleton instance
export const robustStorage = new RobustStorageManager();

// Export utility functions for backward compatibility
export const getStorageItem = <T>(key: string): T | null => robustStorage.get<T>(key);
export const setStorageItem = <T>(key: string, data: T, ttl?: number): void => robustStorage.set(key, data, ttl);
export const removeStorageItem = (key: string): void => robustStorage.remove(key);
export const clearStorage = (): void => robustStorage.clear();
export const isIncognitoMode = (): boolean => robustStorage.isIncognitoMode();
export const getStorageStatus = () => robustStorage.getStorageStatus();

export default robustStorage;
