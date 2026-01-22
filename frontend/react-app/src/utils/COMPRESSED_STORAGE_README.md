# Compressed Storage Utility

This utility provides automatic compression for localStorage and sessionStorage, reducing storage usage by 60-80% for JSON data.

## Features

- **Automatic Compression**: Compresses data larger than 1KB automatically
- **Backward Compatible**: Can read both compressed and uncompressed data
- **Fallback Support**: Falls back to uncompressed storage if compression fails
- **Quota Handling**: Automatically tries compression when quota is exceeded
- **TTL Support**: Built-in time-to-live (TTL) for cached data

## Usage

### Basic Usage

```typescript
import { compressedSessionStorage, compressedLocalStorage } from '../utils/compressedStorage';

// Set item (automatically compresses if beneficial)
compressedSessionStorage.setItem('my-key', myData);

// Get item (automatically decompresses if needed)
const data = compressedSessionStorage.getItem('my-key');

// Remove item
compressedSessionStorage.removeItem('my-key');

// Clear all
compressedSessionStorage.clear();
```

### With TTL (Time To Live)

```typescript
// Store data with 1 hour TTL (in milliseconds)
compressedSessionStorage.setItem('cache-key', data, 60 * 60 * 1000);
```

### Migration from Standard Storage

**Before:**
```typescript
sessionStorage.setItem('key', JSON.stringify(data));
const data = JSON.parse(sessionStorage.getItem('key') || 'null');
```

**After:**
```typescript
import { compressedSessionStorage } from '../utils/compressedStorage';

compressedSessionStorage.setItem('key', data);
const data = compressedSessionStorage.getItem('key');
```

## Compression Details

- **Threshold**: Items larger than 1KB are automatically compressed
- **Algorithm**: Uses LZ-String compression (fast, browser-native)
- **Typical Savings**: 60-80% reduction for JSON data
- **Performance**: Minimal overhead, compression is very fast

## Storage Usage

You can check storage usage:

```typescript
const usage = compressedSessionStorage.getStorageUsage();
console.log(`Used: ${usage.used} bytes`);
console.log(`Compressed savings: ${usage.compressed} bytes`);
```

## Error Handling

The utility automatically handles:
- Quota exceeded errors (tries compression as fallback)
- Compression failures (falls back to uncompressed)
- Corrupted data (returns null gracefully)
- Browser compatibility (falls back to memory storage)

## Best Practices

1. **Large Data**: Use compressed storage for search results, charts, dashboard state
2. **Small Data**: Small items (< 1KB) are stored uncompressed for speed
3. **TTL**: Set TTL for cache data to prevent stale data
4. **Migration**: Gradually migrate existing code - both formats work together

## Example: Search Page State

```typescript
// Save search state
const stateToSave = {
  searchParams,
  resultCount: allSearchResults.length,
  lastEvaluatedKey,
  hasMore,
  // ... other state
};

compressedSessionStorage.setItem('search-page-state', stateToSave);

// Load search state
const savedState = compressedSessionStorage.getItem('search-page-state');
```















