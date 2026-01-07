/**
 * API Key utilities for user authentication
 * Handles API key generation and format validation
 */

/**
 * Generate a new API key in format: sk_{user_id}_{random_uuid}
 * This embeds the user_id for efficient PK lookups
 * Total length: variable based on user_id length + 32 chars random
 */
export function generateApiKey(userId: string): string {
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const randomPart = generateUUID().replace(/-/g, '');
  
  return `sk_${userId}_${randomPart}`;
}

/**
 * Validate API key format
 * Must start with sk_ and contain user_id and random parts
 * Format: sk_{user_id}_{32_hex_chars}
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  if (!apiKey) return false;
  if (!apiKey.startsWith('sk_')) return false;
  if (apiKey.length < 60) return false;
  
  // Format: sk_{user_id}_{random}
  const parts = apiKey.split('_');
  if (parts.length < 3) return false; // Must have at least sk, user_id, random
  
  return true;
}

/**
 * Extract user_id from API key
 * Format: sk_{user_id}_{random}
 */
export function extractUserId(apiKey: string): string | null {
  if (!apiKey || !apiKey.startsWith('sk_')) return null;
  
  const parts = apiKey.split('_');
  if (parts.length < 3) return null;
  
  // Remove 'sk' and last part (random), join remaining as user_id
  // This handles user_ids that might contain underscores
  parts.shift(); // Remove 'sk'
  parts.pop();   // Remove random part
  
  return parts.join('_');
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
