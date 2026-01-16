# File Upload Compression and Security

## Why We Compress Files

### Primary Reason: API Gateway Payload Limit
- **API Gateway has a 6MB request body limit** (hard limit, cannot be increased)
- Large files (especially text files like SEC filings) can easily exceed this limit
- Compression reduces payload size by 70-90% for text files, allowing larger files to be uploaded

### Secondary Benefits
- **Reduced transfer costs**: Smaller payloads = less data transfer
- **Faster uploads**: Smaller files upload faster over slower connections
- **Lambda payload efficiency**: Smaller payloads reduce Lambda processing overhead

### When Compression is Used
- **Files < 1MB**: Skip compression (not worth the overhead)
- **Files 1-4.5MB**: Compress using browser's CompressionStream API (optional, but recommended)
- **Files > 4.5MB**: **COMPRESSION REQUIRED** - Files over 4.5MB uncompressed will exceed API Gateway's 6MB limit when base64-encoded
  - Base64 encoding adds ~33% overhead: 4.5MB * 1.33 = ~6MB (at the limit)
  - An 8MB file compressed to 1-2MB will fit: 2MB * 1.33 = ~2.6MB (well under limit)
  - Compression timeout increased to 2 seconds per MB (up to 120 seconds) for large files

## Current Implementation

### Frontend (`fileUploadService.ts`)
1. Files are compressed using `CompressionStream('gzip')` in the browser
2. Compressed data is base64-encoded for JSON transmission
3. Files are sent via REST API to `/files` endpoint (HTTPS)

### Backend (`file_upload_handler.py`)
1. Receives base64-encoded data (may be compressed)
2. Decodes base64 to bytes
3. **Automatically detects and decompresses gzip data** using magic bytes (0x1f 0x8b)
4. Stores **uncompressed** file in S3 (so agent can read it normally)

## Security: Encryption During Transit

### ✅ HTTPS Encryption (In Transit)
- **All file uploads are encrypted during transit** via HTTPS/TLS
- API Gateway uses HTTPS endpoints (no HTTP allowed)
- Files are transmitted over encrypted connections
- **This is the standard and sufficient for most use cases**

### File Content Encryption (At Rest)
- **Regular uploaded files**: Stored in S3 **unencrypted** (but S3 bucket has encryption enabled)
- **`.cosine` files** (context items): Encrypted using Fernet symmetric encryption before storage
- S3 bucket-level encryption provides additional protection

### Authentication
- Files are authenticated via Bearer token (JWT from Cognito)
- User ID is validated from the JWT token
- Prevents unauthorized file uploads

## WebSocket vs REST API

### Files Are NOT Sent Via WebSocket
- Files are uploaded via **REST API** (`/files` endpoint)
- WebSocket is used for **chat messages only** (text, not files)
- After file upload, a notification is sent via WebSocket to trigger agent processing
- The agent reads files directly from S3 (not through WebSocket)

## Agent File Handling

### Can Agent Handle Raw (Uncompressed) Uploads?
**✅ YES** - The agent can handle both:
1. **Compressed uploads**: Backend automatically decompresses before storing in S3
2. **Uncompressed uploads**: Backend stores directly in S3

The agent reads files from S3 using `read_s3_file_tool()`, which expects **uncompressed** files. The backend ensures files are always stored uncompressed in S3, regardless of how they were uploaded.

## Recommendations

### For Large Files (>4.5MB) - **COMPRESSION REQUIRED**
- **Current behavior**: **MUST compress** or upload will fail at API Gateway
- **Why**: 
  - API Gateway has a hard 6MB request body limit
  - Base64 encoding adds ~33% overhead
  - 4.5MB * 1.33 = ~6MB (at the limit)
  - Files >4.5MB uncompressed will exceed the limit
- **Compression timeout**: 2 seconds per MB (up to 120 seconds) to allow time for large files
- **Error handling**: If compression fails/times out, user gets clear error message (no fallback to uncompressed)

### For Medium Files (1-4.5MB)
- **Current behavior**: Compress on frontend, decompress on backend
- **Why**: Reduces payload size significantly, stays well under API Gateway limit
- **Trade-off**: Slight compression overhead, but better reliability and faster uploads

### For Small Files (<1MB)
- **Current behavior**: Skip compression
- **Why**: Compression overhead not worth it for small files
- **Trade-off**: None - small files are fast either way

## Future Improvements

1. **Chunked uploads**: For files >6MB, implement multipart upload to S3 directly from frontend
2. **Progress indicators**: Better UI feedback during compression/upload
3. **Compression fallback**: If CompressionStream fails, automatically fall back to uncompressed
4. **File type detection**: Skip compression for already-compressed formats (zip, gz, etc.)

