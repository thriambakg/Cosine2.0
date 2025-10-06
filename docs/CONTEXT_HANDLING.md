# Context Handling Architecture

## Overview
Context-aware messages (from the Context Window feature) are now processed at the **WebSocket message processor layer**, not in the Chat lambda. This provides a cleaner separation of concerns.

## Flow

```
Frontend (ChatPage) sends message via WebSocket
    ↓
WebSocket Message Processor Lambda receives message
    ↓
Extracts contextItems from message_data
    ↓
IF contextItems present:
    - Stores in session_variables (DynamoDB)
    - Builds enriched prompt with context_builder
    - Enriches message_text with context data
    ↓
Calls Chat Lambda with enriched message_text
    ↓
Chat Lambda processes as normal
    (message already contains full context)
    ↓
AI agent receives enriched prompt
    ↓
Response sent back to frontend
```

## Key Files

### WebSocket Message Processor
**File**: `backend_app/src/websocket/message_processor/app/lambda_function.py`

- Imports `context_builder` from Lambda layer
- Extracts `contextItems` from incoming WebSocket messages
- Calls `build_context_prompt()` to enrich user message
- Stores context in DynamoDB `session_variables`
- Passes enriched message to Chat lambda

**Key Functions**:
- `process_message()` - Extracts and processes context items
- `call_chat_agent()` - Updated to handle enriched messages

### Context Builder Module
**File**: `backend_app/src/websocket/message_processor/app/context_builder.py`

Contains all context formatting logic:
- `build_context_prompt()` - Main function to build enriched prompts
- `format_tile_context()` - Formats tile data (stock, crypto, news)
- `format_article_context()` - Formats individual articles
- `format_chat_context()` - Formats previous chat sessions
- `extract_context_summary()` - Creates metadata summary

### Chat Lambda (Fallback)
**File**: `backend_app/src/Chat/lambda_handler.py`

- Imports `context_builder` for fallback scenarios
- Only processes `contextItems` if called directly (not via WebSocket)
- Logs fallback usage for debugging

## Context Item Types

### 1. Tile Context
- **Type**: `tile`
- **Sub-types**: `stock`, `crypto`, `news`, `stock_screener`, `portfolio`
- **Data**: Frontend tile data + backend API data

### 2. Article Context
- **Type**: `article`
- **Data**: Title, URL, description, source, date
- **Note**: Stub for `web_article_reader` tool (future)

### 3. Chat Context
- **Type**: `chat`
- **Data**: Trimmed message history (first 2 + last 3)
- **Model**: Original model used in session

## Session Storage

Context items are stored in DynamoDB `session_variables`:

```json
{
  "user_id": "...",
  "session_id": "...",
  "session_variables": {
    "context_items": [...],
    "context_added_at": 1234567890,
    "context_summary": {
      "total_items": 3,
      "by_type": {
        "tile": 2,
        "article": 1
      },
      "symbols": ["BTC", "AAPL"],
      "article_count": 1
    }
  }
}
```

## Local Import

The `context_builder.py` module is now included directly in the WebSocket message processor Lambda package.

### Deployment
1. Deploy the entire `websocket/message_processor/app/` directory as a Lambda function
2. All required files are included:
   - `lambda_function.py` - Main handler
   - `context_builder.py` - Context enrichment logic
   - `tools/web_article_reader.py` - Article reading stub
   - `requirements.txt` - Dependencies

## Error Handling

- If `context_builder` import fails: Falls back to passing raw message
- If context enrichment fails: Logs error, continues with original message
- If session storage fails: Logs error, continues with enriched message

## Benefits of This Architecture

1. ✅ **Separation of Concerns**: WebSocket layer handles message routing, Chat lambda handles AI logic
2. ✅ **Single Enrichment Point**: Context is enriched once, before reaching Chat lambda
3. ✅ **Backwards Compatible**: Chat lambda has fallback for direct API calls
4. ✅ **Scalable**: Context building logic is reusable across lambdas
5. ✅ **Performance**: Context enrichment happens asynchronously in WebSocket layer

## Testing

To test context-aware messages:

1. Add items to Context Window in frontend
2. Send message via WebSocket
3. Check CloudWatch logs for:
   ```
   📌 Context-aware message detected with N context items
   📌 Context summary: {...}
   📌 Stored context in session_variables
   📌 Enhanced message with context (length: X)
   ```
4. Verify AI response uses context data

## Future Improvements

- [ ] Implement `web_article_reader` tool for full article content
- [ ] Add token limit checking for large context items
- [ ] Implement context expiration/cleanup
- [ ] Add context visualization in frontend
- [ ] Support custom context item types

