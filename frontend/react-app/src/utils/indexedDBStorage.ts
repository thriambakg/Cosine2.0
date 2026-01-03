/**
 * IndexedDB Storage Utility
 * Provides a localStorage/sessionStorage-like API with much larger capacity (GBs vs MBs)
 * Falls back to memory storage if IndexedDB is unavailable
 */

interface StorageEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number;
}

class IndexedDBStorageManager {
  private dbName = 'cosine_storage';
  private dbVersion = 1;
  private storeName = 'keyValueStore';
  private db: IDBDatabase | null = null;
  private memoryStorage = new Map<string, StorageEntry<any>>();
  private initPromise: Promise<void> | null> | null = null;

  constructor() {
    this.initPromise = this.initDB();
  }

  private async initDB(): Promise<void | null> {
    if (!('indexedDB' in window)) {
      console.warn('IndexedDB not available, falling back to memory storage');
      return null;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.warn('IndexedDB open failed, falling back to memory storage');
        resolve(null);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(undefined);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'key' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  private async ensureDB(): Promise<boolean> {
    if (this.initPromise) {
      await this.initPromise;
    }
    return this.db !== null;
  }

  async setItem<T>(key: string, value: T, ttl?: number): Promise<void> {
    const entry: StorageEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl,
    };

    if (await this.ensureDB() && this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        await store.put({ key, ...entry });
      } catch (error) {
        console.warn('IndexedDB setItem failed, using memory storage:', error);
        this.memoryStorage.set(key, entry);
      }
    } else {
      this.memoryStorage.set(key, entry);
    }
  }

  async getItem<T>(key: string): Promise<T | null> {
    if (await this.ensureDB() && this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        return new Promise((resolve) => {
          request.onsuccess = () => {
            const result = request.result;
            if (!result) {
              resolve(null);
              return;
            }

            const entry = result as StorageEntry<T>;
            // Check TTL
            if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
              this.removeItem(key); // Clean up expired entry
              resolve(null);
              return;
            }

            resolve(entry.data);
          };

          request.onerror = () => {
            // Fallback to memory storage
            const memEntry = this.memoryStorage.get(key);
            if (memEntry) {
              if (memEntry.ttl && Date.now() - memEntry.timestamp > memEntry.ttl) {
                this.memoryStorage.delete(key);
                resolve(null);
              } else {
                resolve(memEntry.data);
              }
            } else {
              resolve(null);
            }
          };
        });
      } catch (error) {
        console.warn('IndexedDB getItem failed, using memory storage:', error);
        const memEntry = this.memoryStorage.get(key);
        return memEntry ? memEntry.data : null;
      }
    } else {
      const memEntry = this.memoryStorage.get(key);
      return memEntry ? memEntry.data : null;
    }
  }

  async removeItem(key: string): Promise<void> {
    if (await this.ensureDB() && this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        await store.delete(key);
      } catch (error) {
        console.warn('IndexedDB removeItem failed:', error);
      }
    }
    this.memoryStorage.delete(key);
  }

  async clear(): Promise<void> {
    if (await this.ensureDB() && this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        await store.clear();
      } catch (error) {
        console.warn('IndexedDB clear failed:', error);
      }
    }
    this.memoryStorage.clear();
  }

  async getAllKeys(): Promise<string[]> {
    if (await this.ensureDB() && this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAllKeys();

        return new Promise((resolve) => {
          request.onsuccess = () => {
            resolve(request.result.map((key: any) => key.toString()));
          };
          request.onerror = () => {
            resolve(Array.from(this.memoryStorage.keys()));
          };
        });
      } catch (error) {
        return Array.from(this.memoryStorage.keys());
      }
    } else {
      return Array.from(this.memoryStorage.keys());
    }
  }

  // Estimate storage usage (approximate)
  async getStorageUsage(): Promise<{ used: number; quota: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          used: estimate.usage || 0,
          quota: estimate.quota || 0,
        };
      } catch (error) {
        console.warn('Storage estimate failed:', error);
      }
    }
    return { used: 0, quota: 0 };
  }
}

// Singleton instance
export const indexedDBStorage = new IndexedDBStorageManager();

// Convenience functions that match localStorage/sessionStorage API
export const setIndexedDBItem = <T>(key: string, value: T, ttl?: number): Promise<void> => {
  return indexedDBStorage.setItem(key, value, ttl);
};

export const getIndexedDBItem = <T>(key: string): Promise<T | null> => {
  return indexedDBStorage.getItem<T>(key);
};

export const removeIndexedDBItem = (key: string): Promise<void> => {
  return indexedDBStorage.removeItem(key);
};

export const clearIndexedDB = (): Promise<void> => {
  return indexedDBStorage.clear();
};

