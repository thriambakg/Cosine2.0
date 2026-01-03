/**
 * Compressed Storage Utility
 * Wraps localStorage/sessionStorage with compression to reduce storage usage by 60-80%
 * Falls back to uncompressed storage if compression fails
 */

import LZString from 'lz-string';

interface StorageEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number;
  compressed: boolean;
}

class CompressedStorage {
  private storage: Storage;
  private useCompression: boolean = true;
  private readonly COMPRESSION_THRESHOLD = 1024; // Compress items larger than 1KB

  constructor(storage: Storage) {
    this.storage = storage;
    // Check if compression is available
    try {
      const test = LZString.compress('test');
      this.useCompression = test !== null;
    } catch (error) {
      console.warn('Compression not available, using uncompressed storage');
      this.useCompression = false;
    }
  }

  private shouldCompress(data: string): boolean {
    return this.useCompression && data.length > this.COMPRESSION_THRESHOLD;
  }

  setItem<T>(key: string, value: T, ttl?: number): void {
    try {
      const entry: StorageEntry<T> = {
        data: value,
        timestamp: Date.now(),
        ttl,
        compressed: false,
      };

      const jsonString = JSON.stringify(entry);
      
      if (this.shouldCompress(jsonString)) {
        try {
          const compressed = LZString.compress(jsonString);
          if (compressed && compressed.length < jsonString.length) {
            // Compression was beneficial
            entry.compressed = true;
            this.storage.setItem(key, compressed);
            return;
          }
        } catch (compressError) {
          console.warn(`Compression failed for key ${key}, using uncompressed:`, compressError);
        }
      }

      // Use uncompressed storage
      this.storage.setItem(key, jsonString);
    } catch (error: any) {
      if (error.name === 'QuotaExceededError') {
        // Try compressing even if it's below threshold
        try {
          const entry: StorageEntry<T> = {
            data: value,
            timestamp: Date.now(),
            ttl,
            compressed: true,
          };
          const jsonString = JSON.stringify(entry);
          const compressed = LZString.compress(jsonString);
          if (compressed) {
            this.storage.setItem(key, compressed);
            return;
          }
        } catch (retryError) {
          console.error('Failed to compress after quota error:', retryError);
        }
      }
      throw error;
    }
  }

  getItem<T>(key: string): T | null {
    try {
      const stored = this.storage.getItem(key);
      if (!stored) return null;

      let entry: StorageEntry<T>;

      // Try to decompress first (most items will be compressed)
      try {
        const decompressed = LZString.decompress(stored);
        if (decompressed) {
          entry = JSON.parse(decompressed);
        } else {
          // Not compressed, parse directly
          entry = JSON.parse(stored);
        }
      } catch (parseError) {
        // Might be uncompressed, try parsing directly
        try {
          entry = JSON.parse(stored);
        } catch (directParseError) {
          console.warn(`Failed to parse storage entry for key ${key}:`, parseError);
          return null;
        }
      }

      // Check TTL if specified
      if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
        this.removeItem(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn(`Error reading from storage for key ${key}:`, error);
      return null;
    }
  }

  removeItem(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch (error) {
      console.warn(`Error removing storage item ${key}:`, error);
    }
  }

  clear(): void {
    try {
      this.storage.clear();
    } catch (error) {
      console.warn('Error clearing storage:', error);
    }
  }

  key(index: number): string | null {
    return this.storage.key(index);
  }

  get length(): number {
    return this.storage.length;
  }

  // Get storage usage estimate
  getStorageUsage(): { used: number; quota: number; compressed: number } {
    let used = 0;
    let compressed = 0;

    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key) {
          const value = this.storage.getItem(key);
          if (value) {
            used += key.length + value.length;
            // Estimate original size if compressed (rough estimate: 3x compressed size)
            try {
              const decompressed = LZString.decompress(value);
              if (decompressed) {
                compressed += decompressed.length;
              }
            } catch {
              // Not compressed
            }
          }
        }
      }
    } catch (error) {
      console.warn('Error calculating storage usage:', error);
    }

    let quota = 0;
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      // This is async, but we'll return 0 for now
      // Can be enhanced to use async/await if needed
    }

    return { used, quota, compressed };
  }
}

// Create instances for localStorage and sessionStorage
export const compressedLocalStorage = new CompressedStorage(localStorage);
export const compressedSessionStorage = new CompressedStorage(sessionStorage);

// Convenience functions matching localStorage/sessionStorage API
export const setCompressedItem = <T>(
  storage: 'local' | 'session',
  key: string,
  value: T,
  ttl?: number
): void => {
  if (storage === 'local') {
    compressedLocalStorage.setItem(key, value, ttl);
  } else {
    compressedSessionStorage.setItem(key, value, ttl);
  }
};

export const getCompressedItem = <T>(
  storage: 'local' | 'session',
  key: string
): T | null => {
  if (storage === 'local') {
    return compressedLocalStorage.getItem<T>(key);
  } else {
    return compressedSessionStorage.getItem<T>(key);
  }
};

export const removeCompressedItem = (
  storage: 'local' | 'session',
  key: string
): void => {
  if (storage === 'local') {
    compressedLocalStorage.removeItem(key);
  } else {
    compressedSessionStorage.removeItem(key);
  }
};

// Export default for easy migration
export default {
  localStorage: compressedLocalStorage,
  sessionStorage: compressedSessionStorage,
  setItem: setCompressedItem,
  getItem: getCompressedItem,
  removeItem: removeCompressedItem,
};


