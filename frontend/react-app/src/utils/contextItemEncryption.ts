/**
 * Encryption utilities for context items
 * Uses Web Crypto API for client-side encryption/decryption
 * 
 * Note: For backend-encrypted files (Fernet), we need the encryption secret
 * which should be provided via environment variable or API call
 */

const FILE_EXTENSION = '.cs';
const FILE_MIME_TYPE = 'application/x-cosine-context';

// Legacy encryption key for frontend-encrypted context items (deprecated - use backend encryption)
// Note: New context items should be encrypted by the backend, not the frontend
const ENCRYPTION_KEY = 'cosine-context-item-encryption-v1';

// This should match the backend ENCRYPTION_SECRET
// In production, this should come from an environment variable or be fetched securely
// For now, we'll need to get it from the backend or use a different approach
// Note: This is no longer used since we're doing backend decryption
const BACKEND_ENCRYPTION_SECRET = import.meta.env.VITE_ENCRYPTION_SECRET || 'default-secret-change-in-production';

/**
 * Derive a key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a random salt
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Encrypt context item data
 */
export async function encryptContextItem(data: any): Promise<{ encrypted: string; salt: string }> {
  try {
    // Convert data to JSON string
    const jsonString = JSON.stringify(data);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(jsonString);

    // Generate salt
    const salt = generateSalt();

    // Derive key from password
    const key = await deriveKey(ENCRYPTION_KEY, salt);

    // Generate IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt data
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      dataBuffer
    );

    // Combine salt, IV, and encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encryptedBuffer.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encryptedBuffer), salt.length + iv.length);

    // Convert to base64 for storage
    const base64 = btoa(String.fromCharCode(...combined));

    return {
      encrypted: base64,
      salt: btoa(String.fromCharCode(...salt)),
    };
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt context item');
  }
}

/**
 * Decrypt context item data
 */
export async function decryptContextItem(encryptedData: string): Promise<any> {
  try {
    // Decode base64
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

    // Extract salt, IV, and encrypted data
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);

    // Derive key from password
    const key = await deriveKey(ENCRYPTION_KEY, salt);

    // Decrypt data
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      encrypted
    );

    // Convert to JSON
    const decoder = new TextDecoder();
    const jsonString = decoder.decode(decryptedBuffer);
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt context item. File may be corrupted or not a valid Cosine context item.');
  }
}

/**
 * Check if a file is a Cosine context item
 */
export function isCosineContextFile(filename: string): boolean {
  return filename.toLowerCase().endsWith(FILE_EXTENSION);
}

/**
 * Get the file extension for context items
 */
export function getContextItemExtension(): string {
  return FILE_EXTENSION;
}

/**
 * Get the MIME type for context items
 */
export function getContextItemMimeType(): string {
  return FILE_MIME_TYPE;
}

/**
 * Convert a context item to a downloadable blob
 */
export async function createContextItemBlob(data: any): Promise<Blob> {
  const { encrypted } = await encryptContextItem(data);
  const blob = new Blob([encrypted], { type: FILE_MIME_TYPE });
  return blob;
}

/**
 * Read and decrypt a context item from a file
 */
export async function readContextItemFromFile(file: File): Promise<any> {
  if (!isCosineContextFile(file.name)) {
    throw new Error('File is not a Cosine context item');
  }

  const text = await file.text();
  return await decryptContextItem(text);
}

/**
 * Derive Fernet key from user_id (matches backend implementation)
 * This is used to decrypt backend-encrypted .cs files
 */
async function deriveFernetKeyFromUserId(userId: string, encryptionSecret: string): Promise<string> {
  // Step 1: Create salt from SHA256(ENCRYPTION_SECRET + user_id)[:16]
  const saltInput = `${encryptionSecret}${userId}`;
  const saltHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saltInput));
  const salt = new Uint8Array(saltHash.slice(0, 16));

  // Step 2: Derive key using PBKDF2
  const password = `${userId}${encryptionSecret}`;
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const keyBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256 // 32 bytes = 256 bits
  );

  // Step 3: Base64 URL-safe encode (matches Python's base64.urlsafe_b64encode)
  const keyBytes = new Uint8Array(keyBits);
  const base64Key = btoa(String.fromCharCode(...keyBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Fernet keys are 32 bytes base64-encoded, but we need to pad to 44 chars (32 bytes = 43 chars + padding)
  // Actually, Fernet expects exactly 32 bytes, base64-encoded to 44 characters
  // Let's ensure we have the right length
  const paddedKey = base64Key.padEnd(44, '=');
  return paddedKey;
}

/**
 * Decrypt Fernet-encrypted data from backend
 * Fernet format: Version (1 byte) + Timestamp (8 bytes) + IV (16 bytes) + Ciphertext + HMAC (32 bytes)
 */
async function decryptFernetToken(fernetKey: string, encryptedToken: Uint8Array): Promise<string> {
  // Fernet tokens are base64-encoded, so first decode
  // The token structure is: version (1) + timestamp (8) + IV (16) + ciphertext + HMAC (32)
  
  if (encryptedToken.length < 57) { // Minimum: 1 + 8 + 16 + 0 + 32 = 57 bytes
    throw new Error('Invalid Fernet token: too short');
  }

  // Extract components
  const version = encryptedToken[0];
  if (version !== 0x80) {
    throw new Error(`Unsupported Fernet version: ${version}`);
  }

  const timestamp = encryptedToken.slice(1, 9);
  const iv = encryptedToken.slice(9, 25);
  const hmac = encryptedToken.slice(-32);
  const ciphertext = encryptedToken.slice(25, -32);

  // Derive signing key and encryption key from Fernet key
  // Fernet uses: signing_key = HMAC-SHA256(key, "signing-key")
  //              encryption_key = HMAC-SHA256(key, "encryption-key")
  const keyBytes = Uint8Array.from(atob(fernetKey.padEnd(Math.ceil(fernetKey.length / 4) * 4, '=').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  
  // Import the base key
  const baseKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.slice(0, 32), // Fernet uses 32-byte keys
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Derive signing key
  const signingKeyData = new TextEncoder().encode('signing-key');
  const signingKeyBits = await crypto.subtle.sign('HMAC', baseKey, signingKeyData);
  const signingKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(signingKeyBits),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  // Verify HMAC
  const hmacData = new Uint8Array(1 + 8 + 16 + ciphertext.length);
  hmacData.set([version], 0);
  hmacData.set(timestamp, 1);
  hmacData.set(iv, 9);
  hmacData.set(ciphertext, 25);

  const computedHmac = await crypto.subtle.sign('HMAC', signingKey, hmacData);
  const computedHmacBytes = new Uint8Array(computedHmac);

  // Constant-time comparison
  let hmacValid = true;
  if (computedHmacBytes.length !== hmac.length) {
    hmacValid = false;
  } else {
    for (let i = 0; i < hmac.length; i++) {
      if (computedHmacBytes[i] !== hmac[i]) {
        hmacValid = false;
      }
    }
  }

  if (!hmacValid) {
    throw new Error('Fernet HMAC verification failed');
  }

  // Derive encryption key
  const encryptionKeyData = new TextEncoder().encode('encryption-key');
  const encryptionKeyBits = await crypto.subtle.sign('HMAC', baseKey, encryptionKeyData);
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(encryptionKeyBits).slice(0, 16), // AES-128 uses 16-byte keys
    { name: 'AES-CBC' },
    false,
    ['decrypt']
  );

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: iv },
    encryptionKey,
    ciphertext
  );

  // Remove PKCS7 padding
  const decryptedBytes = new Uint8Array(decrypted);
  const paddingLength = decryptedBytes[decryptedBytes.length - 1];
  const unpadded = decryptedBytes.slice(0, -paddingLength);

  return new TextDecoder().decode(unpadded);
}

/**
 * Decrypt backend-encrypted context item (Fernet format)
 * This decrypts data that was encrypted by the backend Lambda
 */
export async function decryptBackendEncryptedContextItem(
  encryptedBase64: string,
  userId: string,
  encryptionSecret?: string
): Promise<any> {
  try {
    const secret = encryptionSecret || BACKEND_ENCRYPTION_SECRET;
    
    // Derive Fernet key
    const fernetKey = await deriveFernetKeyFromUserId(userId, secret);
    
    // Decode base64 encrypted data
    const encryptedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    
    // Decrypt Fernet token
    const decryptedJson = await decryptFernetToken(fernetKey, encryptedBytes);
    
    // Parse JSON
    return JSON.parse(decryptedJson);
  } catch (error) {
    console.error('Backend decryption error:', error);
    throw new Error('Failed to decrypt backend-encrypted context item. File may be corrupted or encrypted with a different key.');
  }
}

