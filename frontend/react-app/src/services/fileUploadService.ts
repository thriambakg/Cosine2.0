/**
 * Shared File Upload Service
 * Provides file compression, validation, and upload functionality for both ChatPage and Sidebar
 */

export interface UploadedFile {
  id: number;
  name: string;
  size: number;
  type: string;
  compressedData: string;
  compressedSize: number;
  compressionRatio: number;
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
          
          // For larger files, use CompressionStream with timeout
          const startTime = Date.now();
          console.log(`🔄 Starting compression for ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          
          const stream = new CompressionStream('gzip');
          const writer = stream.writable.getWriter();
          const reader = stream.readable.getReader();
          
          // Write data in larger chunks for better performance
          const chunkSize = 256 * 1024; // 256KB chunks
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            await writer.write(chunk);
          }
          await writer.close();
          
          // Read compressed data with timeout
          const chunks: Uint8Array[] = [];
          let done = false;
          const timeout = setTimeout(() => {
            console.warn(`⚠️ Compression timeout for ${file.name}, falling back to uncompressed`);
            // Fallback to uncompressed data
            const base64Data = btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));
            resolve({
              compressedData: base64Data,
              originalSize: file.size,
              compressedSize: file.size
            });
          }, 5000); // 5 second timeout
          
          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              chunks.push(value);
            }
          }
          
          clearTimeout(timeout);
          
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
          console.error(`❌ Compression failed for ${file.name}, using uncompressed data:`, error);
          // Fallback to uncompressed data
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const uint8Array = new Uint8Array(arrayBuffer);
          const base64Data = this.convertUint8ArrayToBase64(uint8Array);
          resolve({
            compressedData: base64Data,
            originalSize: file.size,
            compressedSize: file.size
          });
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Validate and process files for upload
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
      // Allow .cs files (application/octet-stream) or files with .cs extension
      const isCosineFile = file.name.toLowerCase().endsWith('.cs');
      const isAllowedType = this.ALLOWED_TYPES.includes(file.type) || isCosineFile;
      
      if (!isAllowedType) {
        console.error(`❌ Unsupported file type: ${file.type} for ${file.name}`);
        alert(`File type ${file.type} is not supported.`);
        continue;
      }
      
      try {
        console.log(`🔄 Compressing file: ${file.name}`);
        // Compress the file
        const { compressedData, originalSize, compressedSize } = await this.compressFile(file);
        
        const compressionRatio = compressedSize / originalSize;
        console.log(`📦 File compression: ${file.name} - ${originalSize} -> ${compressedSize} bytes (${(compressionRatio * 100).toFixed(1)}%)`);
        
        const uploadedFile: UploadedFile = {
          id: Date.now() + Math.random(),
          name: file.name,
          size: originalSize,
          type: file.type,
          compressedData,
          compressedSize,
          compressionRatio
        };
        
        processedFiles.push(uploadedFile);
        console.log(`✅ File added to upload queue: ${file.name} (${processedFiles.length} total files)`);
      } catch (error) {
        console.error(`❌ Failed to compress file ${file.name}:`, error);
        alert(`Failed to process file ${file.name}. Please try again.`);
      }
    }
    
    return processedFiles;
  }

  /**
   * Send files to the File Handler endpoint
   */
  static async sendFilesToFileHandler(
    files: UploadedFile[], 
    options: FileUploadOptions,
    apiGatewayUrl: string = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production'
  ): Promise<any> {
    try {
      const filesData = files.map(file => ({
        filename: file.name,
        content_type: file.type,
        data: file.compressedData // Already base64 encoded from compression
      }));

      const response = await fetch(`${apiGatewayUrl}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: options.userId,
          session_id: options.sessionId,
          message: {
            id: options.message.id,
            text: options.message.text,
            timestamp: options.message.timestamp
          },
          files: filesData,
          context_items: options.contextItems || [] // Include context items
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('📁 Files sent to File Handler:', result);
      return result;
    } catch (error) {
      console.error('❌ Error sending files to File Handler:', error);
      throw error;
    }
  }
}
