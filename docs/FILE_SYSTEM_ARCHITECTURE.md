# File System Architecture

## Overview

A Dropbox-like virtual file system for storing context items and files from chat sessions. Users can organize items into nested folder structures for later analysis.

## Architecture Decision: Hybrid S3 + DynamoDB

**Why S3 for content:**
- DynamoDB has 400KB item size limit (context items can be entire DynamoDB rows)
- S3 is 10x cheaper for large objects
- No file size limits
- Optimized for large file storage

**Why DynamoDB for metadata:**
- Fast queries for folder structure
- Atomic operations for folder/file management
- Easy to query user's file system structure
- Small metadata size (pointers, not content)

**Security:**
- IAM policies restrict Lambda to `users/{UID}/filesys/*` only
- Presigned URLs for file access (no direct S3 URLs)
- User ID validation on every operation
- S3 bucket policies prevent unauthorized access

## Storage Structure

### S3 Structure
```
users/{user_id}/filesys/
  ├── folder1/
  │   ├── file1.json (context item)
  │   ├── file2.png (agent file)
  │   └── subfolder/
  │       └── file3.json
  └── folder2/
      └── file4.json
```

### DynamoDB Schema (user-profiles table)

Add `filesystem_metadata` attribute:

```json
{
  "user_id": "string",
  "filesystem_metadata": {
    "root_folder_id": "string",
    "folders": {
      "folder_id": {
        "id": "string",
        "name": "string",
        "parent_id": "string | null",  // null for root
        "created_at": "number",
        "updated_at": "number",
        "path": "string"  // e.g., "/folder1/subfolder"
      }
    },
    "items": {
      "item_id": {
        "id": "string",
        "name": "string",
        "type": "context_item | uploaded_file | agent_file",
        "folder_id": "string",
        "s3_key": "string",  // Relative path: "folder1/file1.json"
        "metadata": {
          // Type-specific metadata
          "original_data": {...},  // For context items
          "file_size": "number",   // For files
          "content_type": "string" // For files
        },
        "created_at": "number",
        "updated_at": "number"
      }
    }
  }
}
```

## API Endpoints

### File System Management Lambda (`/filesystem`)

**Operations:**
1. `add_item` - Add context item or file to filesystem
2. `delete_item` - Delete item from filesystem
3. `create_folder` - Create new folder
4. `delete_folder` - Delete folder (and all contents)
5. `move_item` - Move item to different folder
6. `rename_item` - Rename item or folder
7. `list_folder` - List contents of folder
8. `get_item` - Get item metadata

### File Return Lambda (`/file-download`)

**Updated to handle:**
- `filesys` path prefix
- Generate presigned URLs for filesys items
- Validate user access to filesys items

## Data Flow

1. **Adding Context Item:**
   - Frontend sends context item data
   - Lambda stores JSON in S3: `users/{UID}/filesys/{folder_path}/{item_id}.json`
   - Lambda updates DynamoDB metadata
   - Returns item metadata

2. **Adding File:**
   - Frontend sends file (or references existing session file)
   - Lambda copies file to S3: `users/{UID}/filesys/{folder_path}/{filename}`
   - Lambda updates DynamoDB metadata
   - Returns item metadata

3. **Reading Item:**
   - Frontend requests item
   - Lambda reads metadata from DynamoDB
   - Lambda generates presigned URL for S3 object
   - Returns presigned URL + metadata

4. **Moving Item:**
   - Lambda updates S3 key (copy + delete)
   - Lambda updates DynamoDB metadata
   - Returns updated metadata

## Security Considerations

1. **IAM Policies:**
   - Lambda role restricted to `users/{UID}/filesys/*` for specific user
   - No cross-user access possible

2. **Validation:**
   - Every operation validates `user_id` from auth token
   - S3 key validation ensures path starts with `users/{UID}/filesys/`

3. **Presigned URLs:**
   - Short expiration (1 hour)
   - Generated on-demand
   - No direct S3 URLs exposed

4. **Bucket Policies:**
   - Deny public access
   - Only Lambda roles can access
   - KMS encryption enabled

## Environment Variables

**File System Lambda:**
- `USER_PROFILES_TABLE_NAME`
- `CHAT_FILES_BUCKET_NAME`
- `S3_BASE_URL` (e.g., `https://cosine-chat-files-production.s3.amazonaws.com`)

**File Return Lambda:**
- `S3_BASE_URL` (for constructing full URLs from relative paths)




