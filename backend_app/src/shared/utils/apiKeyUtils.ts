/**
 * API Key utilities for user authentication
 * Handles API key generation and format validation
 */

/**
 * Generate a new API key in format: sk_{uuid}_{uuid}
 * Total length: ~67 characters (3 + 32 + 1 + 32)
 */
export function generateApiKey(): string {
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const uuid1 = generateUUID().replace(/-/g, '');
  const uuid2 = generateUUID().replace(/-/g, '');
  
  return `sk_${uuid1}_${uuid2}`;
}

/**
 * Validate API key format
 * Must start with sk_ and be approximately 67 characters
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  if (!apiKey) return false;
  if (!apiKey.startsWith('sk_')) return false;
  if (apiKey.length < 60 || apiKey.length > 70) return false;
  return /^sk_[a-f0-9_]+$/.test(apiKey);
}

/**
 * Get API key prefix for indexing (first 8 characters)
 */
export function getApiKeyPrefix(apiKey: string): string {
  return apiKey.substring(0, 8);
}

/**
 * Format API key for display (show first 8 and last 4 chars, mask middle)
 */
export function maskApiKey(apiKey: string): string {
  if (!isValidApiKeyFormat(apiKey)) return '***';
  const first = apiKey.substring(0, 8);
  const last = apiKey.substring(apiKey.length - 4);
  return `${first}...${last}`;
}
