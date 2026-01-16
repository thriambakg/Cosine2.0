/**
 * Web Worker for file chunking and processing
 * Handles file slicing, chunk metadata calculation, and optional compression
 * Keeps the main UI thread responsive during large file processing
 */

export interface ChunkMetadata {
  partNumber: number;
  start: number;
  end: number;
  size: number;
}

export interface ChunkData {
  partNumber: number;
  blob: Blob;
  metadata: ChunkMetadata;
}

export interface ChunkingRequest {
  type: 'chunk';
  file: File;
  chunkSize: number; // Size in bytes (default: 5MB)
  compress?: boolean; // Whether to compress chunks (for files >20MB)
}

export interface ChunkingResponse {
  type: 'chunked';
  chunks: ChunkData[];
  totalParts: number;
  totalSize: number;
  originalSize: number;
}

export interface ErrorResponse {
  type: 'error';
  error: string;
}

// Listen for messages from main thread
self.addEventListener('message', async (event: MessageEvent<ChunkingRequest>) => {
  const { type, file, chunkSize, compress } = event.data;

  if (type !== 'chunk') {
    self.postMessage({
      type: 'error',
      error: `Unknown request type: ${type}`
    } as ErrorResponse);
    return;
  }

  try {
    const chunks: ChunkData[] = [];
    const totalSize = file.size;
    const chunkSizeBytes = chunkSize || 5 * 1024 * 1024; // Default 5MB
    const totalParts = Math.ceil(totalSize / chunkSizeBytes);

    // Process file in chunks
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * chunkSizeBytes;
      const end = Math.min(start + chunkSizeBytes, totalSize);
      const size = end - start;

      // Slice the file
      const fileChunk = file.slice(start, end);

      let processedChunk: Blob = fileChunk;

      // Optional compression for large files
      if (compress && file.size > 20 * 1024 * 1024) {
        try {
          // Check if CompressionStream is available
          if (typeof CompressionStream !== 'undefined') {
            const compressionStream = new CompressionStream('gzip');
            const writer = compressionStream.writable.getWriter();
            const reader = compressionStream.readable.getReader();

            // Write chunk to compression stream
            await writer.write(fileChunk);
            await writer.close();

            // Read compressed data
            const compressedChunks: Uint8Array[] = [];
            let done = false;

            while (!done) {
              const { value, done: readerDone } = await reader.read();
              done = readerDone;
              if (value) {
                compressedChunks.push(value);
              }
            }

            // Combine compressed chunks into a single Blob
            const compressedBlob = new Blob(compressedChunks, { type: 'application/gzip' });
            processedChunk = compressedBlob;
          } else {
            // CompressionStream not available, use uncompressed chunk
            console.warn('CompressionStream not available, using uncompressed chunk');
          }
        } catch (compressionError) {
          // Compression failed, use uncompressed chunk
          console.warn('Compression failed, using uncompressed chunk:', compressionError);
        }
      }

      const metadata: ChunkMetadata = {
        partNumber,
        start,
        end,
        size: processedChunk.size
      };

      chunks.push({
        partNumber,
        blob: processedChunk,
        metadata
      });

      // Send progress update to main thread
      self.postMessage({
        type: 'progress',
        partNumber,
        totalParts,
        progress: (partNumber / totalParts) * 100
      });
    }

    // Send completed chunking result
    const response: ChunkingResponse = {
      type: 'chunked',
      chunks,
      totalParts,
      totalSize: chunks.reduce((sum, chunk) => sum + chunk.metadata.size, 0),
      originalSize: totalSize
    };

    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    } as ErrorResponse);
  }
});

