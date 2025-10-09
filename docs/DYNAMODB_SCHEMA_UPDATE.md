# DynamoDB Schema Update: session_variables Attribute

## Current State

The `chat-sessions` DynamoDB table currently has the following attributes:
- `user_id` (String) - Partition Key
- `session_id` (String) - Sort Key
- `created_at` (Number) - Unix timestamp
- `expires_at` (Number) - TTL attribute
- `last_updated` (Number) - Unix timestamp
- `message_count` (Number)
- `messages` (List) - Array of message objects
- `model` (String) - AI model used
- `title` (String) - Session title

## Required Addition

We need to add a `session_variables` attribute to store context and other session-specific metadata.

### Attribute Structure

```json
{
  "session_variables": {
    "context_items": [
      {
        "id": "string",
        "type": "tile|article|chat",
        "title": "string",
        "subtitle": "string",
        "data": {
          // Type-specific data
        },
        "timestamp": "number"
      }
    ],
    // Other session-specific variables can be added here
  }
}
```

## Good News: No Schema Migration Required

**DynamoDB is schema-less**, which means:
1. You don't need to explicitly create new columns/attributes
2. You can start writing `session_variables` immediately
3. Existing items without `session_variables` will simply not have that attribute
4. New items with `session_variables` will store it normally

## Current Implementation Status

### ✅ Already Implemented

1. **WebSocket Message Processor** (`backend_app/src/websocket/message_processor/app/lambda_function.py`)
   - Reads context from incoming messages
   - Enriches context with API data
   - Stores `session_variables` in DynamoDB
   - **This is already writing the attribute to the database**

2. **Frontend Context Handling**
   - Context Window collects context items
   - ChatPage sends context with messages
   - GlobalChatSidebar displays context bookmark

### ❌ Not Yet Implemented

1. **Session Management Lambda** (`backend_app/src/session_management/app/lambda_function.py`)
   - Does NOT currently read/write `session_variables`
   - Needs to be updated to:
     - Return `session_variables` when getting a session
     - Allow updating `session_variables` when updating a session
     - Preserve `session_variables` when updating other fields

## Required Changes

### 1. Update `get_session` Function

```python
def get_session(user_id: str, session_id: str) -> Dict[str, Any]:
    """Get a specific session by ID"""
    try:
        response = table.get_item(
            Key={'user_id': user_id, 'session_id': session_id}
        )
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json_dumps_safe({'error': 'Session not found'})
            }
        
        session = response['Item']
        
        # Ensure session_variables is included in response
        if 'session_variables' not in session:
            session['session_variables'] = {}
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe(session)
        }
    except Exception as e:
        logger.error(f"Error getting session: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Internal server error'})
        }
```

### 2. Update `list_sessions` Function

```python
def list_sessions(user_id: str) -> Dict[str, Any]:
    """List all sessions for a user"""
    try:
        response = table.query(
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={':user_id': user_id},
            ScanIndexForward=False  # Sort by newest first
        )
        
        sessions = response.get('Items', [])
        
        # Ensure all sessions have session_variables
        for session in sessions:
            if 'session_variables' not in session:
                session['session_variables'] = {}
        
        return {
            'statusCode': 200,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({
                'sessions': sessions,
                'count': len(sessions)
            })
        }
    except Exception as e:
        logger.error(f"Error listing sessions: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Internal server error'})
        }
```

### 3. Update `update_session_metadata` Function

```python
def update_session_metadata(user_id: str, session_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Update session metadata (title, model, session_variables, etc.)"""
    try:
        # Build update expression
        update_expression_parts = []
        expression_attribute_values = {}
        
        if 'title' in metadata:
            update_expression_parts.append('title = :title')
            expression_attribute_values[':title'] = metadata['title']
        
        if 'model' in metadata:
            update_expression_parts.append('model = :model')
            expression_attribute_values[':model'] = metadata['model']
        
        # Handle session_variables update
        if 'session_variables' in metadata:
            update_expression_parts.append('session_variables = :session_variables')
            expression_attribute_values[':session_variables'] = metadata['session_variables']
        
        if update_expression_parts:
            update_expression_parts.append('last_updated = :last_updated')
            expression_attribute_values[':last_updated'] = int(time.time())
            
            update_expression = 'SET ' + ', '.join(update_expression_parts)
            
            table.update_item(
                Key={'user_id': user_id, 'session_id': session_id},
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expression_attribute_values
            )
        
        return get_session(user_id, session_id)
    except Exception as e:
        logger.error(f"Error updating session metadata: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json_dumps_safe({'error': 'Internal server error'})
        }
```

## Testing

### Verify in AWS Console

1. Go to DynamoDB Console
2. Select `cosine-production-chat-sessions` (or your environment's table)
3. Click "Explore table items"
4. Look for a session that was created with context
5. You should see a `session_variables` attribute with `context_items` array

### Verify via API

```bash
# Get a session and check for session_variables
curl -X GET "https://your-api-gateway-url/session?user_id=USER_ID&session_id=SESSION_ID"
```

Expected response:
```json
{
  "session_id": "...",
  "user_id": "...",
  "title": "...",
  "model": "...",
  "messages": [...],
  "session_variables": {
    "context_items": [...]
  },
  ...
}
```

## Deployment Checklist

- [ ] Update `session_management/app/lambda_function.py` with changes above
- [ ] Test locally with a session that has context
- [ ] Deploy updated Lambda
- [ ] Verify session_variables are returned in API responses
- [ ] Test context bookmark display in frontend with real database data
- [ ] Update any API documentation to include session_variables

## Notes

- The WebSocket message processor is already writing `session_variables` correctly
- The frontend is already sending context items correctly
- We just need the Session Management Lambda to read/write this attribute
- No Terraform changes needed (DynamoDB is schema-less)
- Backward compatible - old sessions without `session_variables` will work fine


