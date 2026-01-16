/**
 * Shared File Upload Service
 * Provides file validation and upload functionality using presigned URLs for direct S3 uploads
 * This bypasses API Gateway's 6MB limit by uploading directly to S3
 */

import { API_CONFIG } from '../config/api';

export interface UploadedFile {
  id: number;
  name: string;
  size: number;
  type: string;
  compressedData?: string; // Deprecated: kept for backward compatibility
  compressedSize?: number; // Deprecated: kept for backward compatibility
  compressionRatio?: number; // Deprecated: kept for backward compatibility
  file?: File; // Native File object for presigned URL uploads
}

export interface PresignedUploadResult {
  presigned_url: string;
  file_id: string;
  s3_key: string;
  expires_in: number;
  filename: string;
}

export interface FileUploadOptions {
  userId: string;
  sessionId: string;
  message: {
    id: string;
    text: string;
    timestamp: number;
  };
  contextItems?: any[];
}

export class FileUploadService {
  private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit
  private static readonly ALLOWED_TYPES = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    // Documents
    'application/pdf', 'text/plain', 'text/csv',
    // Data formats
    'application/json', 'application/ld+json', 'application/xml', 'text/xml',
    // Office documents
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Data analysis formats
    'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'application/csv', 'text/tab-separated-values',
    // Archive formats
    'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
    // Financial data formats
    'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.text',
    // Additional text formats
    'text/html', 'text/css', 'text/javascript', 'application/javascript',
    // Database exports
    'application/sql', 'text/sql',
    // Cosine files (encrypted context items)
    'application/octet-stream'
  ];

  /**
   * Helper function to convert Uint8Array to base64 without stack overflow
   */
  private static convertUint8ArrayToBase64(uint8Array: Uint8Array): string {
    const chunkSize = 8192; // Process in 8KB chunks to avoid stack overflow
    let result = '';
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      result += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
    }
    
    return result;
  }

  /**
   * Compress a file using gzip compression
   */
  static async compressFile(file: File): Promise<{compressedData: string, originalSize: number, compressedSize: number}> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const uint8Array = new Uint8Array(arrayBuffer);
          
          // For small files (< 1MB), skip compression to speed up processing
          if (file.size < 1024 * 1024) {
            console.log(`⚡ Skipping compression for small file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
            // Use chunked base64 conversion to avoid stack overflow
            const base64Data = this.convertUint8ArrayToBase64(uint8Array);
            resolve({
              compressedData: base64Data,
              originalSize: file.size,
              compressedSize: file.size
            });
            return;
          }
          
          // Check if CompressionStream is supported
          if (typeof CompressionStream === 'undefined') {
            console.warn(`⚠️ CompressionStream not supported, using uncompressed data for ${file.name}`);
            const base64Data = this.convertUint8ArrayToBase64(uint8Array);
            resolve({
              compressedData: base64Data,
              originalSize: file.size,
              compressedSize: file.size
            });
            return;
          }
          
          // For larger files, use CompressionStream with timeout
          const startTime = Date.now();
          console.log(`🔄 Starting compression for ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          
          // CRITICAL: API Gateway has a 6MB request body limit
          // Base64 encoding adds ~33% overhead, so max uncompressed file is ~4.5MB
          // For files >4.5MB, we MUST compress or they will fail at API Gateway
          // Even an 8MB file compressed to 1-2MB will fit (with base64 overhead)
          const API_GATEWAY_LIMIT = 6 * 1024 * 1024; // 6MB
          const MAX_UNCOMPRESSED_SIZE = 4.5 * 1024 * 1024; // ~4.5MB (accounts for base64 overhead)
          const isLargeFile = file.size > MAX_UNCOMPRESSED_SIZE;
          
          if (isLargeFile) {
            console.log(`⚠️ Large file detected (${(file.size / 1024 / 1024).toFixed(2)} MB) - compression REQUIRED to fit API Gateway 6MB limit`);
            console.log(`📦 Attempting compression (required for files >${(MAX_UNCOMPRESSED_SIZE / 1024 / 1024).toFixed(1)}MB)...`);
            // Continue with compression - don't skip!
          }
          
          console.log(`🔧 Creating compression stream...`);
          let stream: CompressionStream;
          try {
            stream = new CompressionStream('gzip');
          } catch (error) {
            console.error(`❌ Failed to create CompressionStream:`, error);
            if (isLargeFile) {
              reject(new Error(`File compression failed: Files over ${(MAX_UNCOMPRESSED_SIZE / 1024 / 1024).toFixed(1)}MB must be compressed to fit API Gateway's 6MB limit. CompressionStream API not available in this browser.`));
            } else {
              const base64Data = this.convertUint8ArrayToBase64(uint8Array);
              resolve({
                compressedData: base64Data,
                originalSize: file.size,
                compressedSize: file.size
              });
            }
            return;
          }
          
          console.log(`🔧 Getting stream writer and reader...`);
          const writer = stream.writable.getWriter();
          const reader = stream.readable.getReader();
          console.log(`✅ Stream initialized, starting to write data...`);
          
          // Write data in larger chunks for better performance with timeout protection
          const chunkSize = 256 * 1024; // 256KB chunks
          const totalChunks = Math.ceil(uint8Array.length / chunkSize);
          console.log(`📝 Writing ${totalChunks} chunks to compression stream...`);
          
          try {
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
              const chunk = uint8Array.slice(i, i + chunkSize);
              await writer.write(chunk);
              const progress = Math.round(((i + chunkSize) / uint8Array.length) * 50); // 0-50% for writing
              if (i % (chunkSize * 4) === 0 || i + chunkSize >= uint8Array.length) {
                console.log(`📊 Compression progress: ${Math.min(progress, 50)}% (writing data)`);
              }
            }
            console.log(`✅ Finished writing all chunks, closing writer...`);
            await writer.close();
            console.log(`✅ Writer closed successfully`);
          } catch (writeError) {
            console.error(`❌ Error writing to compression stream:`, writeError);
            try {
              await writer.abort();
            } catch (abortError) {
              console.error(`❌ Error aborting writer:`, abortError);
            }
            // Fallback to uncompressed
            const base64Data = this.convertUint8ArrayToBase64(uint8Array);
            resolve({
              compressedData: base64Data,
              originalSize: file.size,
              compressedSize: file.size
            });
            return;
          }
          
          // Read compressed data with dynamic timeout based on file size
          const chunks: Uint8Array[] = [];
          let done = false;
          
          // Calculate timeout based on file size: 2 seconds per MB for large files, minimum 15 seconds, maximum 120 seconds
          // Large files need more time to compress
          const timeoutMs = Math.max(15000, Math.min(120000, (file.size / 1024 / 1024) * 2000));
          console.log(`⏱️ Compression timeout set to ${(timeoutMs / 1000).toFixed(1)}s for ${(file.size / 1024 / 1024).toFixed(2)} MB file`);
          
          const timeout = setTimeout(() => {
            if (isLargeFile) {
              // For large files, compression failure means upload will fail at API Gateway
              console.error(`❌ Compression timeout for large file ${file.name} - upload will fail (exceeds API Gateway 6MB limit)`);
              reject(new Error(`File too large: Compression timed out. Files over ${(MAX_UNCOMPRESSED_SIZE / 1024 / 1024).toFixed(1)}MB must be compressed to fit API Gateway's 6MB limit. Please try a smaller file or wait for compression to complete.`));
            } else {
              // For smaller files, fallback to uncompressed
              console.warn(`⚠️ Compression timeout (${timeoutMs}ms) for ${file.name}, falling back to uncompressed`);
              const base64Data = this.convertUint8ArrayToBase64(uint8Array);
              resolve({
                compressedData: base64Data,
                originalSize: file.size,
                compressedSize: file.size
              });
            }
          }, timeoutMs);
          
          console.log(`📖 Starting to read compressed data...`);
          let readProgress = 0;
          try {
            while (!done) {
              const readResult = await reader.read();
              const { value, done: readerDone } = readResult;
              done = readerDone;
              if (value) {
                chunks.push(value);
                readProgress += value.length;
                // Log progress every ~1MB of compressed data read
                if (chunks.length % 10 === 0 || readerDone) {
                  console.log(`📊 Compression progress: ${50 + Math.round((readProgress / (file.size * 0.5)) * 50)}% (reading compressed data)`);
                }
              }
            }
            clearTimeout(timeout);
            console.log(`✅ Finished reading compressed data (${chunks.length} chunks, ${readProgress} bytes)`);
          } catch (readError) {
            console.error(`❌ Error reading from compression stream:`, readError);
            clearTimeout(timeout);
            try {
              await reader.cancel();
            } catch (cancelError) {
              console.error(`❌ Error canceling reader:`, cancelError);
            }
            // Fallback to uncompressed
            const base64Data = this.convertUint8ArrayToBase64(uint8Array);
            resolve({
              compressedData: base64Data,
              originalSize: file.size,
              compressedSize: file.size
            });
            return;
          }
          
          // Combine chunks efficiently
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const compressedData = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            compressedData.set(chunk, offset);
            offset += chunk.length;
          }
          
          // Optimized base64 conversion
          const compressedBase64 = this.convertUint8ArrayToBase64(compressedData);
          
          const compressionTime = Date.now() - startTime;
          console.log(`✅ Compression completed for ${file.name} in ${compressionTime}ms`);
          
          resolve({
            compressedData: compressedBase64,
            originalSize: file.size,
            compressedSize: compressedData.length
          });
        } catch (error) {
          const MAX_UNCOMPRESSED_SIZE = 4.5 * 1024 * 1024; // ~4.5MB (accounts for base64 overhead)
          const isLargeFile = file.size > MAX_UNCOMPRESSED_SIZE;
          
          if (isLargeFile) {
            // For large files, compression failure means upload will fail at API Gateway
            console.error(`❌ Compression failed for large file ${file.name} - upload will fail:`, error);
            reject(new Error(`File compression failed: Files over ${(MAX_UNCOMPRESSED_SIZE / 1024 / 1024).toFixed(1)}MB must be compressed to fit API Gateway's 6MB limit. Please try again or use a smaller file.`));
          } else {
            // For smaller files, fallback to uncompressed
            console.error(`❌ Compression failed for ${file.name}, using uncompressed data:`, error);
            const arrayBuffer = e.target?.result as ArrayBuffer;
            const uint8Array = new Uint8Array(arrayBuffer);
            const base64Data = this.convertUint8ArrayToBase64(uint8Array);
            resolve({
              compressedData: base64Data,
              originalSize: file.size,
              compressedSize: file.size
            });
          }
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Validate and process files for upload (no compression needed with presigned URLs)
   */
  static async processFiles(files: FileList | File[]): Promise<UploadedFile[]> {
    const fileArray = Array.isArray(files) ? files : Array.from(files);
    console.log(`📁 User selected ${fileArray.length} file(s) for upload`);
    const processedFiles: UploadedFile[] = [];
    
    for (const file of fileArray) {
      console.log(`📁 Processing file: ${file.name} (${file.type}, ${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      
      // Validate file size
      if (file.size > this.MAX_FILE_SIZE) {
        console.error(`❌ File ${file.name} is too large: ${(file.size / 1024 / 1024).toFixed(2)} MB (max: 50 MB)`);
        alert(`File ${file.name} is too large. Maximum size is 50MB.`);
        continue;
      }
      
      // Validate file type
      // Allow .cosine files (application/octet-stream) or files with .cosine extension
      const isCosineFile = file.name.toLowerCase().endsWith('.cosine');
      const isAllowedType = this.ALLOWED_TYPES.includes(file.type) || isCosineFile;
      
      if (!isAllowedType) {
        console.error(`❌ Unsupported file type: ${file.type} for ${file.name}`);
        alert(`File type ${file.type} is not supported.`);
        continue;
      }
      
      // No compression needed - files will be uploaded directly to S3 via presigned URLs
      const uploadedFile: UploadedFile = {
        id: Date.now() + Math.random(),
        name: file.name,
        size: file.size,
        type: file.type,
        file: file // Store native File object for presigned URL upload
      };
      
      processedFiles.push(uploadedFile);
      console.log(`✅ File added to upload queue: ${file.name} (${processedFiles.length} total files)`);
    }
    
    return processedFiles;
  }

  /**
   * Request presigned URLs for file uploads
   */
  private static async requestPresignedUrls(
    files: UploadedFile[],
    userId: string,
    sessionId: string,
    apiGatewayUrl: string = API_CONFIG.BASE_URL
  ): Promise<PresignedUploadResult[]> {
    const results: PresignedUploadResult[] = [];
    
    // Get auth token
    let authHeader: Record<string, string> = {};
    try {
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      const accessToken = session.tokens?.accessToken;
      const token = idToken || accessToken;
      
      if (token) {
        authHeader = { Authorization: `Bearer ${token.toString()}` };
      }
    } catch (authErr) {
      console.warn('⚠️ Failed to get auth token for presigned URL request:', authErr);
    }
    
    // Request presigned URL for each file
    for (const file of files) {
      if (!file.file) {
        console.error(`❌ File ${file.name} missing File object`);
        continue;
      }
      
      try {
        const response = await fetch(`${apiGatewayUrl}/files/presigned`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeader
          },
          body: JSON.stringify({
            user_id: userId,
            session_id: sessionId,
            filename: file.name,
            content_type: file.type,
            file_size: file.size
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to get presigned URL for ${file.name}: ${response.status} - ${errorText}`);
        }
        
        const result: PresignedUploadResult = await response.json();
        results.push(result);
        console.log(`✅ Got presigned URL for ${file.name} (expires in ${result.expires_in}s)`);
      } catch (error) {
        console.error(`❌ Error requesting presigned URL for ${file.name}:`, error);
        throw error;
      }
    }
    
    return results;
  }
  
  /**
   * Upload file directly to S3 using presigned URL
   */
  private static async uploadToS3(
    file: File,
    presignedUrl: string,
    maxRetries: number = 3
  ): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📤 Uploading ${file.name} to S3 (attempt ${attempt}/${maxRetries})...`);
        
        const response = await fetch(presignedUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type
          }
        });
        
        if (!response.ok) {
          throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
        }
        
        console.log(`✅ Successfully uploaded ${file.name} to S3`);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Upload attempt ${attempt} failed for ${file.name}:`, error);
        
        if (attempt < maxRetries) {
          // Exponential backoff: wait 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries failed
    throw new Error(`Failed to upload ${file.name} after ${maxRetries} attempts: ${lastError?.message}`);
  }
  
  /**
   * Complete file upload after all files are uploaded to S3
   */
  private static async completeFileUpload(
    fileIds: string[],
    userId: string,
    sessionId: string,
    message: { id: string; text: string; timestamp: number },
    contextItems: any[],
    apiGatewayUrl: string = API_CONFIG.BASE_URL
  ): Promise<any> {
    // Get auth token
    let authHeader: Record<string, string> = {};
    try {
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      const accessToken = session.tokens?.accessToken;
      const token = idToken || accessToken;
      
      if (token) {
        authHeader = { Authorization: `Bearer ${token.toString()}` };
      }
    } catch (authErr) {
      console.warn('⚠️ Failed to get auth token for complete upload:', authErr);
    }
    
    const response = await fetch(`${apiGatewayUrl}/files/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader
      },
      body: JSON.stringify({
        user_id: userId,
        session_id: sessionId,
        file_ids: fileIds,
        message: message,
        context_items: contextItems || []
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to complete file upload: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ File upload completed:', result);
    return result;
  }
  
  /**
   * Upload files using presigned URLs (new method - bypasses API Gateway limit)
   */
  static async uploadFilesWithPresignedUrls(
    files: UploadedFile[],
    options: FileUploadOptions,
    apiGatewayUrl: string = API_CONFIG.BASE_URL,
    onProgress?: (file: string, progress: number) => void
  ): Promise<any> {
    try {
      console.log(`📤 Starting presigned URL upload for ${files.length} file(s)`);
      
      // Step 1: Request presigned URLs for all files
      console.log('📋 Step 1: Requesting presigned URLs...');
      const presignedResults = await this.requestPresignedUrls(
        files,
        options.userId,
        options.sessionId,
        apiGatewayUrl
      );
      
      if (presignedResults.length !== files.length) {
        throw new Error(`Failed to get presigned URLs for all files. Expected ${files.length}, got ${presignedResults.length}`);
      }
      
      // Step 2: Upload files directly to S3
      console.log('📤 Step 2: Uploading files to S3...');
      const uploadPromises = files.map(async (file, index) => {
        const presignedResult = presignedResults[index];
        if (!file.file) {
          throw new Error(`File ${file.name} missing File object`);
        }
        
        if (onProgress) {
          onProgress(file.name, 0);
        }
        
        await this.uploadToS3(file.file, presignedResult.presigned_url);
        
        if (onProgress) {
          onProgress(file.name, 100);
        }
        
        return presignedResult.file_id;
      });
      
      const fileIds = await Promise.all(uploadPromises);
      console.log(`✅ All ${fileIds.length} file(s) uploaded to S3`);
      
      // Step 3: Complete upload (verify files, update session variables)
      console.log('✅ Step 3: Completing file upload...');
      const result = await this.completeFileUpload(
        fileIds,
        options.userId,
        options.sessionId,
        options.message,
        options.contextItems || [],
        apiGatewayUrl
      );
      
      console.log('✅ Presigned URL upload completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Error in presigned URL upload:', error);
      throw error;
    }
  }
  
  /**
   * Send files to the File Handler endpoint (legacy method - kept for backward compatibility)
   * @deprecated Use uploadFilesWithPresignedUrls instead
   */
  static async sendFilesToFileHandler(
    files: UploadedFile[], 
    options: FileUploadOptions,
    apiGatewayUrl: string = API_CONFIG.BASE_URL
  ): Promise<any> {
    // Use new presigned URL method
    return this.uploadFilesWithPresignedUrls(files, options, apiGatewayUrl);
  }
}
