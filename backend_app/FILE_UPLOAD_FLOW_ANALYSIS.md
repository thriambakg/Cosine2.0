# File Upload Flow Analysis

## Overview
This document analyzes the end-to-end file upload flows in the system and identifies opportunities for code sharing between user file uploads and agent-generated files.

---

## Flow 1: User File Upload (New Flow)

### Entry Point
- **Frontend**: `ChatPage.tsx` or `GlobalChatSidebar.tsx`
- **Service**: `FileUploadService` (frontend)
- **API Endpoint**: `/files` (REST API)

### Flow Steps

1. **Frontend File Selection & Compression**
   - User selects file(s) via file input
   - `FileUploadService` compresses files using gzip + base64
   - Files are sent to `/files` endpoint with message data

2. **File Upload Lambda** (`file_upload/app/lambda_function.py`)
   - Receives: `{user_id, session_id, message, files[], context_items[], model}`
   - **S3 Upload**:
     - Decodes base64 file data
     - Generates unique file ID: `uuid.uuid4()`
     - Creates S3 key: `users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}`
     - Uploads to S3 with metadata
   - **Session Variables Update**:
     - Gets existing `session_variables`
     - Merges `uploaded_files` (appends to existing)
     - Preserves `context_items` (merges, avoids duplicates)
     - Updates DynamoDB
   - **WebSocket Invocation**:
     - Invokes WebSocket processor Lambda (async)
     - Passes: `{type: 'chat', messageId, message, uploadedFiles, contextItems, model}`

3. **WebSocket Message Processor** (`websocket/message_processor/app/lambda_function.py`)
   - Receives file handler message
   - **Message Storage**:
     - Stores user message in `conversation_history`
     - Stores user message in `messages` array (for UI)
   - **Chat Agent Invocation**:
     - Invokes chat agent Lambda (synchronous for file messages)
     - Passes: `{user_id, session_id, message, uploaded_files, context_items, source: 'file_handler'}`
   - **Response Handling**:
     - If async delivery: Sends user message confirmation, waits for SQS response
     - If immediate response: Sends AI response immediately
   - **WebSocket Messages**:
     - `message_received` - Confirmation
     - `user_message_with_files` - User message with file metadata
     - `ai_response` - AI response (via SQS)
     - `session_updated` - Session variables update

4. **Chat Agent** (`Chat/agent.py`)
   - Receives message with `uploaded_files` array
   - Uses `get_session_files_tool` to read files from S3
   - Processes message and generates response
   - Sends response via SQS (async) or returns immediately

5. **SQS Response Handler** (`websocket/message_processor/app/lambda_function.py`)
   - Receives AI response from SQS
   - Stores in `messages` array
   - Sends `ai_response` via WebSocket
   - Updates session variables if needed

---

## Flow 2: Agent-Generated Files (Existing Flow)

### Entry Point
- **Agent Tools**: `generate_agent_file_tool`, `chart_generator`, etc.
- **Service**: `lambda_invocation.py` → `upload_file_and_notify()`

### Flow Steps

1. **Agent File Generation**
   - Agent tool generates file content (e.g., chart, CSV, HTML)
   - Calls `upload_file_and_notify()` from `lambda_invocation.py`

2. **File Upload** (`Chat/lambda_invocation.py`)
   - **S3 Upload**:
     - Handles compression/decompression if needed
     - Generates S3 key: `users/{user_id}/sessions/{session_id}/agent-files/{filename}`
     - Uploads to S3 with metadata
   - **Agent Files Processor Invocation**:
     - If `folder == "agent-files"`: Invokes `agent_files_processor` Lambda (async)
     - Passes: `{type: 'direct_invocation', user_id, session_id, s3_key, file_metadata}`

3. **Agent Files Processor** (`agent_files_processor/app/lambda_function.py`)
   - Receives direct invocation
   - **Session Variables Update**:
     - Gets existing `session_variables`
     - Appends to `agent_files` array (in `session_variables`)
     - Updates DynamoDB
   - **WebSocket Notification**:
     - Invokes WebSocket processor Lambda (async)
     - Passes: `{type: 'session_update', user_id, session_id, session_variables}`

4. **WebSocket Message Processor** (`websocket/message_processor/app/lambda_function.py`)
   - Receives `session_update` event
   - Sends `session_updated` message via WebSocket to frontend

---

## Code Duplication Analysis

### 1. S3 Upload Logic

**Current State:**
- **User Upload**: `file_upload/app/lambda_function.py` (lines 104-161)
  - Base64 decode
  - UUID generation
  - S3 key: `users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}`
  - S3 upload with metadata
  - Returns file metadata

- **Agent Upload**: `Chat/lambda_invocation.py` (lines 114-136)
  - Content handling (string/bytes)
  - S3 key: `users/{user_id}/sessions/{session_id}/{folder}/{filename}`
  - S3 upload with metadata
  - Returns file metadata

**Shared Components:**
- S3 client initialization
- S3 key generation pattern
- Metadata structure
- Error handling

**Opportunity:** Create shared `S3FileUploader` utility class

---

### 2. Session Variables Update

**Current State:**
- **User Upload**: `file_upload/app/lambda_function.py` (lines 232-327)
  - Gets existing `session_variables`
  - Merges `uploaded_files` (appends)
  - Merges `context_items` (deduplicates by ID)
  - Updates DynamoDB

- **Agent Files**: `agent_files_processor/app/lambda_function.py` (lines 104-155)
  - Gets existing `session_variables`
  - Appends to `agent_files` array
  - Updates DynamoDB

- **WebSocket Processor**: `websocket/message_processor/app/lambda_function.py` (lines 1209-1256, 1601-1659)
  - Similar merge logic for `uploaded_files`
  - Similar merge logic for `context_items`

**Shared Components:**
- DynamoDB table access
- Session variable retrieval
- Array merging logic
- Decimal conversion for DynamoDB
- Context items deduplication

**Opportunity:** Create shared `SessionVariablesManager` utility class

---

### 3. File Metadata Structure

**Current State:**
- **User Upload**: 
  ```python
  {
    'file_id': str,
    'filename': str,
    's3_key': str,
    's3_url': str,
    'content_type': str,
    'file_size': int,
    'upload_timestamp': str
  }
  ```

- **Agent Files**:
  ```python
  {
    'filename': str,
    's3_key': str,
    's3_url': str,
    'file_size': int,
    'content_type': str,
    'upload_timestamp': str,
    'file_id': str,
    'generated_by': 'agent'
  }
  ```

**Shared Components:**
- Common fields: `filename`, `s3_key`, `s3_url`, `content_type`, `file_size`, `upload_timestamp`
- Different: `file_id` generation, `generated_by` field

**Opportunity:** Standardize file metadata structure with base class

---

### 4. WebSocket Notification

**Current State:**
- **User Upload**: `file_upload/app/lambda_function.py` → WebSocket processor (async)
- **Agent Files**: `agent_files_processor/app/lambda_function.py` → WebSocket processor (async)
- **Both**: Send `session_updated` messages

**Shared Components:**
- Lambda invocation pattern
- WebSocket processor function name
- Payload structure

**Opportunity:** Create shared `WebSocketNotifier` utility class

---

### 5. Decimal Conversion

**Current State:**
- **User Upload**: `file_upload/app/lambda_function.py` (lines 255-264)
- **WebSocket Processor**: `websocket/message_processor/app/lambda_function.py` (multiple places)
- **Agent Files Processor**: Uses `DecimalEncoder` class (lines 9-13)

**Shared Components:**
- Float to Decimal conversion logic
- Recursive conversion for dicts/lists

**Opportunity:** Create shared `DynamoDBConverter` utility class

---

## Recommended Shared Components

### 1. `file_utils.py` - Shared File Utilities

```python
# Location: backend_app/src/shared/file_utils.py

class S3FileUploader:
    """Unified S3 file uploader for user and agent files"""
    
    @staticmethod
    def upload_file(
        file_content: bytes,
        user_id: str,
        session_id: str,
        filename: str,
        content_type: str,
        folder: str = "files",  # "files" or "agent-files"
        metadata: Dict[str, str] = None
    ) -> Dict[str, Any]:
        """
        Upload file to S3 with standardized structure.
        Returns file metadata dict.
        """
        pass
    
    @staticmethod
    def generate_s3_key(
        user_id: str,
        session_id: str,
        filename: str,
        folder: str = "files"
    ) -> str:
        """Generate standardized S3 key"""
        pass

class FileMetadataBuilder:
    """Build standardized file metadata"""
    
    @staticmethod
    def build_user_file_metadata(
        file_id: str,
        filename: str,
        s3_key: str,
        s3_url: str,
        content_type: str,
        file_size: int
    ) -> Dict[str, Any]:
        """Build metadata for user-uploaded files"""
        pass
    
    @staticmethod
    def build_agent_file_metadata(
        filename: str,
        s3_key: str,
        s3_url: str,
        content_type: str,
        file_size: int,
        file_description: str = ""
    ) -> Dict[str, Any]:
        """Build metadata for agent-generated files"""
        pass
```

### 2. `session_variables_manager.py` - Session Variables Management

```python
# Location: backend_app/src/shared/session_variables_manager.py

class SessionVariablesManager:
    """Unified session variables management"""
    
    @staticmethod
    def update_uploaded_files(
        user_id: str,
        session_id: str,
        new_files: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Add user-uploaded files to session_variables.
        Merges with existing files.
        Returns updated session_variables.
        """
        pass
    
    @staticmethod
    def update_agent_files(
        user_id: str,
        session_id: str,
        new_file: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Add agent-generated file to session_variables.
        Appends to agent_files array.
        Returns updated session_variables.
        """
        pass
    
    @staticmethod
    def merge_context_items(
        existing_items: List[Dict[str, Any]],
        new_items: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Merge context items, avoiding duplicates by ID.
        Returns merged list.
        """
        pass
    
    @staticmethod
    def convert_to_dynamodb_format(data: Any) -> Any:
        """Convert floats to Decimal for DynamoDB compatibility"""
        pass
```

### 3. `websocket_notifier.py` - WebSocket Notifications

```python
# Location: backend_app/src/shared/websocket_notifier.py

class WebSocketNotifier:
    """Unified WebSocket notification system"""
    
    @staticmethod
    def notify_session_update(
        user_id: str,
        session_id: str,
        session_variables: Dict[str, Any]
    ) -> bool:
        """
        Send session_updated message via WebSocket processor.
        Returns True if successful.
        """
        pass
```

### 4. `dynamodb_converter.py` - DynamoDB Format Conversion

```python
# Location: backend_app/src/shared/dynamodb_converter.py

class DynamoDBConverter:
    """Convert data to/from DynamoDB format"""
    
    @staticmethod
    def to_dynamodb(data: Any) -> Any:
        """Convert floats to Decimal, handle nested structures"""
        pass
    
    @staticmethod
    def from_dynamodb(data: Any) -> Any:
        """Convert Decimal to float, handle nested structures"""
        pass
```

---

## Implementation Plan

### Phase 1: Create Shared Utilities
1. Create `shared/` directory structure
2. Implement `dynamodb_converter.py`
3. Implement `file_utils.py` (S3 uploader, metadata builder)
4. Implement `session_variables_manager.py`
5. Implement `websocket_notifier.py`

### Phase 2: Refactor User Upload Flow
1. Update `file_upload/app/lambda_function.py` to use shared utilities
2. Remove duplicate S3 upload code
3. Remove duplicate session variables update code
4. Remove duplicate Decimal conversion code

### Phase 3: Refactor Agent Files Flow
1. Update `Chat/lambda_invocation.py` to use shared S3 uploader
2. Update `agent_files_processor/app/lambda_function.py` to use shared utilities
3. Standardize file metadata structure

### Phase 4: Refactor WebSocket Processor
1. Update `websocket/message_processor/app/lambda_function.py` to use shared utilities
2. Consolidate session variables update logic
3. Use shared WebSocket notifier

---

## Benefits of Consolidation

1. **Reduced Code Duplication**: ~40% reduction in file-related code
2. **Consistency**: Standardized file metadata, S3 keys, error handling
3. **Maintainability**: Single source of truth for file operations
4. **Testing**: Easier to test shared utilities
5. **Bug Fixes**: Fix once, apply everywhere
6. **Performance**: Optimized shared code paths

---

## Current File Locations

### User Upload Flow
- `file_upload/app/lambda_function.py` - REST API endpoint
- `websocket/message_processor/app/lambda_function.py` - Message processing
- `websocket/message_processor/app/file_upload_handler.py` - Compression utilities (unused?)

### Agent Files Flow
- `Chat/lambda_invocation.py` - File upload and notification
- `agent_files_processor/app/lambda_function.py` - Session variables update
- `Chat/agent.py` - File generation tools

### Shared (Potential)
- `Chat/compression_helper.py` - Compression utilities (used by web scraper)
- `Chat/tools/s3_file_reader.py` - S3 file reading (used by agent)

---

## Notes

- The `file_upload_handler.py` in WebSocket processor appears to be unused (compression is done in frontend)
- Agent files use `agent-files` folder, user files use `files` folder
- Both flows update `session_variables` but in different ways
- Context items merging logic is duplicated in multiple places
- `compression_helper.py` already exists in `Chat/` directory and is used by web scraper
- Decimal conversion logic is duplicated in 17+ files across the codebase

---

## Specific Code Duplication Examples

### Example 1: Decimal Conversion (17+ files)

**Pattern Found:**
```python
# file_upload/app/lambda_function.py (lines 255-264)
def convert_floats_to_decimal(obj):
    if isinstance(obj, float):
        from decimal import Decimal
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    else:
        return obj

# websocket/message_processor/app/lambda_function.py (lines 48-65)
def convert_floats_to_decimal(obj):
    # Same implementation

# agent_files_processor/app/lambda_function.py (lines 9-13)
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)
```

**Solution:** Create `shared/dynamodb_converter.py` with unified conversion logic.

---

### Example 2: S3 Key Generation

**Pattern Found:**
```python
# file_upload/app/lambda_function.py (line 119)
s3_key = f"users/{user_id}/sessions/{session_id}/files/{file_id}_{filename}"

# Chat/lambda_invocation.py (line 115)
s3_key = f"users/{user_id}/sessions/{session_id}/{folder}/{filename}"

# websocket/message_processor/app/file_upload_handler.py (line 109)
s3_key = f"users/{user_id}/sessions/{session_id}/files/{unique_filename}"
```

**Solution:** Standardize in `shared/file_utils.py` with `generate_s3_key()` method.

---

### Example 3: Session Variables Merge Logic

**Pattern Found:**
```python
# file_upload/app/lambda_function.py (lines 286-304)
existing_files = existing_session_vars.get('uploaded_files', [])
all_files = existing_files + uploaded_files_decimal
merged_session_vars['uploaded_files'] = all_files

existing_context_items = existing_session_vars.get('context_items', [])
if context_items_decimal and len(context_items_decimal) > 0:
    existing_ids = {item.get('id') for item in existing_context_items if item.get('id')}
    new_items = [item for item in context_items_decimal if item.get('id') not in existing_ids]
    merged_context_items = existing_context_items + new_items

# websocket/message_processor/app/lambda_function.py (lines 1215-1235)
# Same logic duplicated

# agent_files_processor/app/lambda_function.py (lines 129-133)
agent_files = session_variables.get('agent_files', [])
agent_files.append(agent_file_metadata)
session_variables['agent_files'] = agent_files
```

**Solution:** Create `SessionVariablesManager` with `merge_uploaded_files()` and `merge_context_items()` methods.

---

### Example 4: File Metadata Structure

**Pattern Found:**
```python
# file_upload/app/lambda_function.py (lines 147-155)
uploaded_files.append({
    'file_id': file_id,
    'filename': filename,
    's3_key': s3_key,
    's3_url': s3_url,
    'content_type': content_type,
    'file_size': file_size,
    'upload_timestamp': str(int(datetime.utcnow().timestamp()))
})

# Chat/lambda_invocation.py (lines 141-150)
file_metadata = {
    'filename': filename,
    's3_key': s3_key,
    's3_url': f"https://{bucket_name}.s3.amazonaws.com/{s3_key}",
    'file_size': len(file_content),
    'content_type': content_type,
    'upload_timestamp': str(int(datetime.utcnow().timestamp())),
    'file_id': filename.split('.')[0] if '.' in filename else filename,
    'generated_by': 'agent'
}
```

**Solution:** Standardize with `FileMetadataBuilder` class.

---

## Priority Recommendations

### High Priority (Immediate Impact)

1. **Create `shared/dynamodb_converter.py`**
   - Consolidate Decimal conversion (used in 17+ files)
   - Impact: Fix once, apply everywhere
   - Effort: Low (1-2 hours)

2. **Create `shared/session_variables_manager.py`**
   - Consolidate session variables merge logic
   - Impact: Fixes context items deduplication bugs
   - Effort: Medium (3-4 hours)

3. **Standardize S3 Key Generation**
   - Create `shared/file_utils.py` with `generate_s3_key()`
   - Impact: Consistent file organization
   - Effort: Low (1-2 hours)

### Medium Priority (Next Sprint)

4. **Create `shared/websocket_notifier.py`**
   - Consolidate WebSocket Lambda invocations
   - Impact: Consistent notification pattern
   - Effort: Low (2-3 hours)

5. **Refactor File Upload Flows**
   - Update both flows to use shared utilities
   - Impact: Reduced code duplication
   - Effort: Medium (4-6 hours)

### Low Priority (Future)

6. **Standardize File Metadata**
   - Create `FileMetadataBuilder` class
   - Impact: Consistent metadata structure
   - Effort: Low (2-3 hours)

---

## Migration Strategy

### Step 1: Create Shared Utilities (No Breaking Changes)
- Create `shared/` directory
- Implement utilities as new modules
- No changes to existing code yet

### Step 2: Update One Flow at a Time
- Start with user upload flow (newer, less critical)
- Test thoroughly
- Then update agent files flow

### Step 3: Remove Duplicate Code
- After both flows use shared utilities
- Remove duplicate implementations
- Update tests

---

## Testing Strategy

1. **Unit Tests**: Test shared utilities in isolation
2. **Integration Tests**: Test each flow end-to-end
3. **Regression Tests**: Ensure no functionality is broken
4. **Performance Tests**: Ensure no performance degradation

---

## Estimated Impact

- **Lines of Code Reduced**: ~500-700 lines
- **Files Affected**: 5-7 files
- **Bugs Fixed**: Context items deduplication, Decimal conversion inconsistencies
- **Maintenance Burden**: Reduced by ~40%
- **Time to Implement**: 12-16 hours total

