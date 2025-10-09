# Global Chat Sidebar Implementation

## Overview

This document describes the implementation of a Cursor-style global chat sidebar that allows users to access AI chat from any page in the application. The sidebar integrates with the existing context window system and provides persistent chat sessions across the application.

## Key Features

1. **Global Accessibility**: Chat sidebar available on all pages
2. **Session Management**: Load and switch between chat sessions
3. **Context Integration**: Automatic opening with context-aware messages
4. **Shared WebSocket**: Single WebSocket connection shared across components
5. **Session Selection**: Open sessions from the AI Chat page in the sidebar
6. **Context Display**: Shows context items used for each session

## Architecture

### Context Providers

#### 1. WebSocketContext (`contexts/WebSocketContext.tsx`)

Manages a single WebSocket connection shared across the application:

```typescript
interface WebSocketContextType {
  websocket: WebSocket | null;
  isConnected: boolean;
  connect: (sessionId: string) => void;
  disconnect: () => void;
  sendMessage: (message: any) => boolean;
  activeSessionId: string | null;
}
```

**Features:**
- Single WebSocket connection management
- Automatic reconnection with exponential backoff
- Connection state tracking
- Message sending with error handling

#### 2. GlobalChatContext (`contexts/GlobalChatContext.tsx`)

Manages the global chat sidebar visibility and active session:

```typescript
interface GlobalChatContextType {
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  openWithSession: (sessionId: string) => void;
  close: () => void;
  toggle: () => void;
}
```

**Features:**
- Sidebar visibility control
- Active session tracking
- Convenience methods for opening/closing

### Components

#### GlobalChatSidebar (`components/layout/GlobalChatSidebar.tsx`)

The main sidebar component providing the chat interface:

**Features:**
- Slide-in animation from the right
- Model selection (Claude 3.5 Sonnet, Opus, Sonnet, Haiku)
- Message history display
- Real-time messaging via WebSocket
- Context bookmark showing items used in the session
- Refresh and close controls

**UI Layout:**
```
┌─────────────────────────┐
│  Header (AI Chat)       │
│  [Refresh] [Close]      │
├─────────────────────────┤
│  Model Selector         │
├─────────────────────────┤
│                         │
│  Message History        │
│  (scrollable)           │
│                         │
├─────────────────────────┤
│  Context Bookmark       │
│  [Expand/Collapse]      │
├─────────────────────────┤
│  Input Field            │
│  [Send Button]          │
└─────────────────────────┘
```

## Integration Points

### 1. AppLayout Integration

Added providers in the component hierarchy:

```tsx
<ClockProvider>
  <ContextWindowProvider>
    <WebSocketProvider>
      <GlobalChatProvider>
        {/* App content */}
        <GlobalChatSidebar />
      </GlobalChatProvider>
    </WebSocketProvider>
  </ContextWindowProvider>
</ClockProvider>
```

### 2. ContextWindow Integration

**Auto-open on context-aware messages:**

When a user sends a message with context items:
1. Generate a new session ID
2. Store context data in sessionStorage
3. Dispatch `create-context-session` event
4. **Automatically open GlobalChatSidebar with the new session**
5. Show success message with countdown
6. Clear context window after countdown

```typescript
// Generate session ID
const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Auto-open sidebar
openWithSession(newSessionId);
```

### 3. ChatPage Integration

**Session Selection:**

Added an "Open in sidebar" button next to each session in the chat history:

```tsx
<Tooltip title="Open in sidebar">
  <IconButton onClick={(e) => handleOpenInSidebar(session.session_id, e)}>
    <OpenInNewIcon />
  </IconButton>
</Tooltip>
```

**Handler:**
```typescript
const handleOpenInSidebar = (sessionId: string, event?: React.MouseEvent) => {
  if (event) {
    event.stopPropagation(); // Prevent loading in main page
  }
  openWithSession(sessionId);
};
```

## Backend Integration

### Context Prompt Handling

Modified to separate user-visible messages from AI prompts:

**WebSocket Message Processor (`backend_app/src/websocket/message_processor/app/lambda_function.py`):**

```python
# Store original user message for frontend display
original_user_message = message_text

if has_context:
    # Build enriched prompt with context (for AI only)
    enriched_message = build_context_prompt(message_text, context_items)
    
    # Send enriched message to AI, but keep original for frontend
    message_text = enriched_message

# Pass original_user_message to chat agent
ai_response = call_chat_agent(
    user_id, 
    message_text,  # Enriched message for AI
    model, 
    files, 
    session_id, 
    context_items if has_context else None,
    original_user_message if has_context else None  # Original for display
)
```

**Chat Lambda (`backend_app/src/Chat/lambda_handler.py`):**

```python
# Extract original message for display
original_message = None
if 'originalMessage' in event_body:
    original_message = event_body.get('originalMessage', '').strip()

# Use original_message for display if available
message_for_display = original_message if original_message else user_message

# Store in session
session_manager.update_session_context(
    session_id, user_id, message_for_display, response_content, model=model
)
```

**Result:**
- Users see only their original question in the chat UI
- AI receives the full enriched prompt with context data
- Context items are shown in a separate bookmark below the chat

## User Workflows

### Workflow 1: Context-Aware Analysis

1. User adds items to Context Window (tiles, articles, chat sessions)
2. User types a question and sends from Context Window
3. **GlobalChatSidebar automatically opens** with new session
4. Context data is sent to backend
5. AI analyzes with full context
6. User sees only their question, context shown in bookmark
7. Chat sidebar remains accessible from any page

### Workflow 2: Open Existing Session

1. User navigates to AI Chat page
2. User clicks "Open in sidebar" icon on any session
3. GlobalChatSidebar opens with that session loaded
4. User can continue conversation
5. User navigates to another page (Dashboard, Portfolio, etc.)
6. GlobalChatSidebar remains open and functional

### Workflow 3: Switch Sessions

1. GlobalChatSidebar is open with Session A
2. User goes to AI Chat page
3. User clicks "Open in sidebar" on Session B
4. GlobalChatSidebar switches to Session B
5. WebSocket reconnects to Session B
6. User continues with Session B

## Styling & UX

### Design Principles

- **Cursor-inspired**: Similar to Cursor's AI panel
- **Non-intrusive**: Doesn't block main content
- **Smooth animations**: Slide-in/out transitions
- **Consistent theming**: Matches existing dark theme
- **Mobile-friendly**: Fixed width (500px) for consistency

### Visual Elements

```css
/* Slide-in animation */
@keyframes slideInFromRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

/* Dark theme colors */
- Background: rgba(15, 23, 42, 0.98)
- Border: #374151
- Accent: #3b82f6 (blue)
- Text: #ffffff, #9ca3af
```

## Session Context Display

### Context Bookmark

Displays context items used for the current session:

```
┌─────────────────────────┐
│ 📌 Context (3 items)  ▼ │
├─────────────────────────┤
│ • Crypto Tile           │
│   BTC • 7d        [tile]│
│ • News Article          │
│   Apple M5...   [article│
│ • Chat Session          │
│   Previous...    [chat] │
└─────────────────────────┘
```

**Features:**
- Collapsible/expandable
- Shows item type, title, subtitle
- Color-coded chips
- Persists across sessions (loaded from `session_variables`)

## Testing Checklist

- [ ] GlobalChatSidebar opens from ContextWindow
- [ ] GlobalChatSidebar opens from ChatPage session list
- [ ] WebSocket connection establishes correctly
- [ ] Messages send and receive properly
- [ ] Model switching works
- [ ] Context bookmark displays context items
- [ ] Context bookmark collapses/expands
- [ ] Session switching updates sidebar
- [ ] Sidebar remains open across page navigation
- [ ] Close button works
- [ ] Refresh button reloads session
- [ ] Original user message displays (not enriched prompt)
- [ ] Context items show in bookmark (not in message)
- [ ] Auto-reconnect works on connection loss

## Future Enhancements

1. **Resize Handle**: Allow users to adjust sidebar width
2. **Minimize Mode**: Collapse to a small icon when minimized
3. **Multi-Session Tabs**: Open multiple sessions in tabs
4. **Voice Input**: Add voice-to-text for messages
5. **File Upload**: Support file uploads from sidebar
6. **Quick Actions**: Add quick action buttons for common tasks
7. **Keyboard Shortcuts**: Add shortcuts (e.g., Cmd+K to open)
8. **Session Search**: Search within current session messages
9. **Export Chat**: Export session as markdown/PDF
10. **Theming**: Allow light/dark theme toggle

## Known Limitations

1. **Single Session**: Only one session open in sidebar at a time
2. **Fixed Width**: Sidebar has fixed 500px width
3. **No Mobile Support**: Optimized for desktop only
4. **No Offline Mode**: Requires active WebSocket connection
5. **Context Bookmark**: Shows all items, no filtering/search

## Dependencies

### Frontend
- `@mui/material`: UI components
- `@mui/icons-material`: Icons
- React Context API: State management
- WebSocket API: Real-time communication

### Backend
- AWS Lambda: Message processing
- AWS API Gateway: WebSocket management
- DynamoDB: Session storage
- Python context_builder: Prompt enrichment

## Files Modified/Created

### Created Files
- `frontend/react-app/src/contexts/WebSocketContext.tsx`
- `frontend/react-app/src/contexts/GlobalChatContext.tsx`
- `frontend/react-app/src/components/layout/GlobalChatSidebar.tsx`
- `docs/GLOBAL_CHAT_SIDEBAR_IMPLEMENTATION.md`

### Modified Files
- `frontend/react-app/src/components/layout/AppLayout.tsx`
- `frontend/react-app/src/components/layout/ContextWindow.tsx`
- `frontend/react-app/src/pages/ChatPage.tsx`
- `backend_app/src/websocket/message_processor/app/lambda_function.py`
- `backend_app/src/Chat/lambda_handler.py`

## Configuration

No additional configuration required. The sidebar uses existing environment variables:

- `WEBSOCKET_ENDPOINT`: WebSocket API Gateway endpoint
- `CHAT_SESSIONS_TABLE_NAME`: DynamoDB table for sessions

## Troubleshooting

### Sidebar not opening
- Check if GlobalChatProvider is in component tree
- Verify `openWithSession()` is being called
- Check browser console for errors

### WebSocket not connecting
- Verify `WEBSOCKET_ENDPOINT` environment variable
- Check AWS API Gateway WebSocket route configuration
- Ensure user is authenticated

### Context not showing
- Verify `session_variables.context_items` exists in DynamoDB
- Check that context items are being stored by message processor
- Ensure session loads correctly with `sessionAPI.getSession()`

### Messages not sending
- Check WebSocket connection state
- Verify `isConnected` is `true`
- Check browser network tab for WebSocket frames
- Ensure session ID is valid

## Conclusion

The Global Chat Sidebar provides a seamless, Cursor-like AI chat experience accessible from anywhere in the application. It integrates deeply with the existing context system, maintains persistent sessions, and provides a clean, intuitive UI for interacting with the AI assistant.


