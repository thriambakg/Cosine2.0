/**
 * Encryption utilities for context items
 * Uses Web Crypto API for client-side encryption/decryption
 */

const ENCRYPTION_KEY = 'cosine-context-item-encryption-v1'; // This should be a secret key
const FILE_EXTENSION = '.cosine';
const FILE_MIME_TYPE = 'application/x-cosine-context';

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

