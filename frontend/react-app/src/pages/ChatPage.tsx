import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ENV_CONFIG } from '@/config/environment';
import { useChatPersistence } from '@/hooks/useChatPersistence';
import { useClock } from '@/contexts/ClockContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import { sessionManagementAPI } from '@/services/api';
import { ContextItem } from '@/components/tiles/common/contextManager';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Avatar,
  FormControl,
  Select,
  MenuItem,
  Chip,
  Button,
  Stack,
  CircularProgress,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Checkbox,
  Collapse,
} from '@mui/material';
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  InsertDriveFile as FileIcon,
  AttachFile as AttachFileIcon,
  Chat as ChatIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Psychology as BrainIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Dashboard as ContextIcon,
  OpenInNew as OpenInNewIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  status?: 'sending' | 'sent' | 'delivered' | 'error';
  files?: UploadedFile[];
}

interface UploadedFile {
  id: number;
  name: string;
  size: number;
  type: string;
  compressedData: string;
  compressedSize: number;
  compressionRatio: number;
}

interface WebSocketMessage {
  type: 'connection_established' | 'message_received' | 'ai_response' | 'error' | 'connection_establish' | 'edit_acknowledged';
  message_id?: string;
  session_id?: string;
  content?: string;
  message?: string;
  timestamp?: string;
  unchanged?: boolean;
}


// Custom styled components for Wall Street chic
const GlassCard = ({ children, sx = {}, ...props }: any) => (
  <Box
    sx={{
      background: 'rgba(15, 23, 42, 0.95)',
      border: '2px solid #374151',
      borderRadius: '0px',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      ...sx
    }}
    {...props}
  >
    {children}
  </Box>
);

const MessageBubble = ({ isUser, children, status, ...props }: any) => (
  <Box
    sx={{
      p: 2,
      maxWidth: '70%',
      borderRadius: '0px',
      position: 'relative',
      ...(isUser ? {
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        color: 'white',
        marginLeft: 'auto',
        border: '1px solid #3b82f6',
      } : {
        backgroundColor: 'rgba(15, 23, 42, 0.8)',
        color: 'white',
        marginRight: 'auto',
        border: '1px solid #374151',
      }),
    }}
    {...props}
  >
    {children}
    {isUser && status && (
      <Box sx={{ position: 'absolute', bottom: 4, right: 4 }}>
        {status === 'sending' && <CircularProgress size={12} sx={{ color: '#9ca3af' }} />}
        {status === 'sent' && <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '10px' }}>✓</Typography>}
        {status === 'delivered' && <Typography variant="caption" sx={{ color: '#22c55e', fontSize: '10px' }}>✓✓</Typography>}
        {status === 'error' && <Typography variant="caption" sx={{ color: '#ef4444', fontSize: '10px' }}>✗</Typography>}
      </Box>
    )}
  </Box>
);

// Typing animation component
const TypingText = ({ 
  text, 
  speed = 30, 
  onComplete
}: { 
  text: string; 
  speed?: number; 
  onComplete?: () => void;
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);

      return () => clearTimeout(timer);
    } else if (onComplete && currentIndex === text.length) {
      onComplete();
    }
  }, [currentIndex, text, speed, onComplete]);

  // Reset when text changes
  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
  }, [text]);

  return (
    <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
      {displayedText}
      {currentIndex < text.length && (
        <Box
          component="span"
          sx={{
            display: 'inline-block',
            width: '2px',
            height: '1.2em',
            backgroundColor: 'currentColor',
            marginLeft: '2px',
            animation: 'blink 1s infinite',
            '@keyframes blink': {
              '0%, 50%': { opacity: 1 },
              '51%, 100%': { opacity: 0 },
            },
          }}
        />
      )}
    </Typography>
  );
};

const FilePreview = ({ children, ...props }: any) => (
  <Box
    sx={{
      p: 1,
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      backgroundColor: 'rgba(55, 65, 81, 0.5)',
      borderRadius: '4px',
      border: '1px solid #374151',
    }}
    {...props}
  >
    {children}
  </Box>
);

export default function ChatPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const { clockTimezone, clockMilitaryTime } = useClock();
  const { openWithSession } = useGlobalChat();
  
  // Chat persistence system
  const {
    currentSession,
    sessions,
    isLoading: persistenceLoading,
    createNewSession,
    loadSession,
    deleteSession,
    addMessage: addPersistedMessage,
    truncateMessagesAfter,
    loadSessionsFromBackend,
    updateSessionContext,
  } = useChatPersistence(user?.id || '');
  
  // Use messages from current session
  const messages = currentSession?.messages || [];
  const [inputMessage, setInputMessage] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState('claude-3-sonnet');
  const [missedResponseNotification] = useState<string | null>(null);
  // Connection status variables - used internally for WebSocket logic
  const [_connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [_connectionError, setConnectionError] = useState<string | null>(null);
  const [typingMessages, setTypingMessages] = useState<Set<string>>(new Set());
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  
  // Session-specific state tracking
  const [sessionLoadingStates, setSessionLoadingStates] = useState<Record<string, boolean>>({});
  const [pendingMessages, setPendingMessages] = useState<Record<string, Message[]>>({});
  const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());
  const [sentMessageIds, setSentMessageIds] = useState<Set<string>>(new Set());
  
  // Helper function to get current session loading state
  const getCurrentSessionLoading = useCallback(() => {
    return currentSession?.session_id ? sessionLoadingStates[currentSession.session_id] || false : false;
  }, [currentSession?.session_id, sessionLoadingStates]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Session selection for context
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  
  // Message editing state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  
  // Context state
  const [sessionContext, setSessionContext] = useState<ContextItem[]>([]);
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [isFilesExpanded, setIsFilesExpanded] = useState(false);
  
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  
  // Clear loading state when session is deleted or changed
  useEffect(() => {
    if (!currentSession) {
      console.log('🔴 DELETE: Clearing loading state due to session deletion');
      
      // Clear any session-specific state
      setSessionLoadingStates({});
      setPendingMessages({});
    }
  }, [currentSession]);

  // Handle session switching and message caching
  const previousSessionIdRef = useRef<string | null>(null);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    const currentSessionId = currentSession?.session_id;
    
    // Debug session switching
    console.log('🔄 SESSION EFFECT: Current session:', {
      sessionId: currentSessionId,
      messageCount: currentSession?.messages?.length || 0,
      messages: currentSession?.messages?.map(m => ({ id: m.id, sender: m.sender, text: m.text.substring(0, 30) + '...' })) || []
    });
    
    // If we're switching to a session that has no messages but we expect it to have messages,
    // trigger a reload from the persistence system
    if (currentSessionId && currentSession && currentSession.messages.length === 0) {
      console.log('🔄 SESSION EFFECT: Session has no messages, checking if we should reload');
      // The persistence system should handle this through its caching mechanism
    }
    
    // If we switched to a different session, handle the transition
    if (previousSessionIdRef.current && 
        previousSessionIdRef.current !== currentSessionId) {
      
      console.log('🔄 SESSION SWITCH: From', previousSessionIdRef.current, 'to', currentSessionId);
      
      // Removed automatic session change dispatch - sidebar only changes via manual "Open in Sidebar"
      
      // Process any cached messages for the new session
      if (currentSessionId && pendingMessages[currentSessionId]) {
        console.log('🔄 SESSION SWITCH: Processing cached messages for session:', currentSessionId);
        const cachedMessages = pendingMessages[currentSessionId];
        
        // Add cached messages to the persistence system
        cachedMessages.forEach(message => {
          addPersistedMessage(message);
          setTypingMessages(prev => new Set([...prev, message.id]));
        });
        
        // Clear cached messages for this session
        setPendingMessages(prev => {
          const updated = { ...prev };
          delete updated[currentSessionId];
          return updated;
        });
      }
      
      // Clear any pending timeout
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
    
    previousSessionIdRef.current = currentSessionId || null;
  }, [currentSession?.session_id, pendingMessages, addPersistedMessage]);



  // Process cached messages immediately when they're added for the current session
  useEffect(() => {
    const currentSessionId = currentSession?.session_id;
    if (currentSessionId && pendingMessages[currentSessionId]) {
      console.log('🔄 IMMEDIATE: Processing cached messages for current session:', currentSessionId);
      const cachedMessages = pendingMessages[currentSessionId];
      
      // Add cached messages to the persistence system
      cachedMessages.forEach(message => {
        addPersistedMessage(message);
        setTypingMessages(prev => new Set([...prev, message.id]));
      });
      
      // Clear cached messages for this session
      setPendingMessages(prev => {
        const updated = { ...prev };
        delete updated[currentSessionId];
        return updated;
      });
    }
  }, [pendingMessages, currentSession?.session_id, addPersistedMessage]);

  // Safety timeout to clear loading state after 60 seconds for each session
  useEffect(() => {
    const currentSessionId = currentSession?.session_id;
    if (currentSessionId && sessionLoadingStates[currentSessionId]) {
      // Clear any existing timeout
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      
      // Set new timeout for this session
      loadingTimeoutRef.current = setTimeout(() => {
        console.log('⏰ TIMEOUT: Clearing loading state after 60 seconds for session:', currentSessionId);
        setSessionLoadingStates(prev => ({
          ...prev,
          [currentSessionId]: false
        }));
        loadingTimeoutRef.current = null;
      }, 60000); // 60 seconds
    }
    
    // Cleanup on unmount
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [currentSession?.session_id, sessionLoadingStates]);
  const editContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/');
    }
  }, [user, isLoading, navigate]);

  // Handle click outside to cancel editing
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editingMessage && editContainerRef.current && !editContainerRef.current.contains(event.target as Node)) {
        handleCancelEdit();
      }
    };

    if (editingMessage) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [editingMessage]);

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    if (!user?.id || !ENV_CONFIG.websocketUrl) {
      console.error('Cannot connect: missing user ID or WebSocket URL');
      setConnectionError('Missing user ID or WebSocket URL');
      return;
    }

    // Prevent multiple connections
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.CONNECTING) {
      console.log('🔄 WebSocket connection already in progress, skipping');
      return;
    }

    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      console.log('✅ WebSocket already connected, skipping');
      return;
    }

    try {
      setConnectionStatus('connecting');
      setConnectionError(null);

      // Close existing connection if any
      if (websocketRef.current) {
        websocketRef.current.close();
        websocketRef.current = null;
      }

      // Create WebSocket URL with user ID as query parameter
      const wsUrl = `${ENV_CONFIG.websocketUrl}?userId=${user.id}`;
      console.log('🔌 Connecting to WebSocket:', wsUrl);

      const ws = new WebSocket(wsUrl);
      websocketRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        setConnectionStatus('connected');
        setConnectionError(null); // Clear any previous errors
        reconnectAttemptsRef.current = 0;
        
        // Send a connection establishment message (not a chat message) only if not already established
        if (!connectionEstablished) {
          const connectionMessage = {
            type: 'connection_establish',
            userId: user.id,
            timestamp: new Date().toISOString()
          };
          
          try {
            const messageString = JSON.stringify(connectionMessage);
            console.log('📤 Sending connection establishment message:', messageString);
            ws.send(messageString);
            console.log('📤 Sent connection establishment message successfully');
            setConnectionEstablished(true);
          } catch (error) {
            console.error('Error sending connection message:', error);
          }
        } else {
          console.log('📤 Connection already established, skipping message');
        }
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          console.log('📨 Received WebSocket message:', data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('❌ WebSocket disconnected:', event.code, event.reason);
        setConnectionStatus('disconnected');
        setConnectionEstablished(false); // Reset connection established flag
        
        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          console.log(`🔄 Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectWebSocket();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionError('Unable to connect. Please refresh the page to try again.');
          setConnectionStatus('error');
        }
      };

      ws.onerror = (error) => {
        // Log error for debugging but don't show to user
        console.warn('🔧 WebSocket connection issue detected (handling gracefully):', error.type);
        // Don't set error status immediately - let onclose handle reconnection
        // This prevents showing error messages for temporary connection issues
        console.log('🔄 WebSocket error occurred, waiting for connection to close for retry');
        
        // Only set error status if we've exhausted reconnection attempts
        if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionStatus('error');
          setConnectionError('Connection lost. Please refresh to reconnect.');
        }
      };

    } catch (error) {
      console.warn('🔧 WebSocket connection creation issue (handling gracefully):', error);
      setConnectionStatus('error');
      setConnectionError('Unable to establish connection. Please try again.');
    }
  }, [user?.id]);

  const handleWebSocketMessage = useCallback((data: WebSocketMessage) => {
    switch (data.type) {
      case 'connection_established':
        console.log('🔗 Session established:', data.session_id);
        setConnectionEstablished(true);
        // Note: Message saving is now handled by the persistence hook's retry mechanism
        break;

      case 'message_received':
        // Message status tracking is handled by persistence system
        console.log('📨 Message received confirmation:', data.message_id);
        break;

      case 'ai_response':
        // Only process AI responses for the current session
        if (data.session_id && currentSession?.session_id && data.session_id !== currentSession.session_id) {
          console.log('🤖 AI response for different session, ignoring:', data.session_id, 'vs', currentSession.session_id);
          break;
        }
        
        // Check if we've already processed this message
        const messageId = data.message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (processedMessageIds.has(messageId)) {
          console.log('🤖 Duplicate AI response ignored:', messageId);
          break;
        }
        
        // Add AI response to messages
        const aiMessage: Message = {
          id: messageId,
          text: data.content || 'No response content',
          sender: 'bot',
          timestamp: new Date(data.timestamp || Date.now()),
        };
        
        // Mark message as processed
        setProcessedMessageIds(prev => new Set([...prev, messageId]));
        
        console.log('🤖 Received AI response:', {
          messageId: aiMessage.id,
          contentLength: aiMessage.text.length,
          currentSessionId: currentSession?.session_id,
          responseSessionId: data.session_id,
          currentMessageCount: currentSession?.messages?.length || 0
        });
        
        // Check if this response is for the currently viewed session
        const responseSessionId = data.session_id;
        if (responseSessionId === currentSession?.session_id) {
          // Add to persistence system
          addPersistedMessage(aiMessage);
          // Add to typing messages to trigger typing animation
          setTypingMessages(prev => new Set([...prev, aiMessage.id]));
          // Clear loading state for this session
          if (responseSessionId) {
            setSessionLoadingStates(prev => ({
              ...prev,
              [responseSessionId]: false
            }));
          }
          
          console.log('📡 Adding AI response to current ChatPage session');
        }
        
        // Always dispatch AI response event for sidebar (regardless of current session)
        // This allows the sidebar to receive responses for its active session
        const aiResponseEvent = new CustomEvent('chatpage-ai-response', {
          detail: {
            messageId: messageId,
            content: data.content || 'No response content',
            sessionId: responseSessionId,
            userId: user?.id,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(aiResponseEvent);
        console.log('📡 Dispatched AI response to sidebar:', {
          messageId,
          sessionId: responseSessionId,
          userId: user?.id,
          contentLength: (data.content || '').length
        });
        
        if (responseSessionId && responseSessionId !== currentSession?.session_id) {
          // Cache the message for the session it belongs to
          console.log('🤖 Caching AI response for session:', responseSessionId);
          setPendingMessages(prev => ({
            ...prev,
            [responseSessionId]: [...(prev[responseSessionId] || []), aiMessage]
          }));
          // Clear loading state for that session
          setSessionLoadingStates(prev => ({
            ...prev,
            [responseSessionId]: false
          }));
        }
        break;

      case 'edit_acknowledged':
        console.log('✏️ Edit acknowledged:', data.message_id);
        
        // Check if message was unchanged (user clicked edit but didn't change text)
        if (data.unchanged) {
          console.log('⚠️ Edit acknowledged but message unchanged - no AI response expected');
          // Clear loading state since no AI response will come
          if (currentSession?.session_id) {
            setSessionLoadingStates(prev => ({
              ...prev,
              [currentSession.session_id]: false
            }));
          }
        } else {
          // UI has already been updated in handleSaveEdit, just log acknowledgment
          // The AI response will come as a separate 'ai_response' message
          console.log('✅ Edit acknowledged - waiting for AI response');
        }
        break;

      case 'error':
        console.error('WebSocket error message:', data.message);
        setConnectionError(data.message || 'Unknown error');
        // Clear loading state for current session on error
        if (currentSession?.session_id) {
          setSessionLoadingStates(prev => ({
            ...prev,
            [currentSession.session_id]: false
          }));
        }
        break;

      default:
        console.warn('Unknown WebSocket message type:', data.type);
    }
  }, []);

  // Connect to WebSocket when user is available
  useEffect(() => {
    if (user?.id && ENV_CONFIG.websocketUrl) {
      connectWebSocket();
    }

    // Add global error handler for unhandled WebSocket errors
    const handleGlobalError = (event: ErrorEvent) => {
      if (event.message && event.message.includes('WebSocket')) {
        console.warn('🔧 Global WebSocket error caught (handling gracefully):', event.message);
        // Don't propagate the error to avoid showing it to users
        event.preventDefault();
      }
    };

    window.addEventListener('error', handleGlobalError);

    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      window.removeEventListener('error', handleGlobalError);
    };
  }, [user?.id, ENV_CONFIG.websocketUrl]);

  // Load context when session changes
  useEffect(() => {
    console.log('📌 Session changed, checking for context:', {
      hasSession: !!currentSession,
      sessionId: currentSession?.session_id,
      hasSessionVariables: !!currentSession?.session_variables,
      hasContextItems: !!currentSession?.session_variables?.context_items,
      contextItemsLength: currentSession?.session_variables?.context_items?.length || 0
    });
    
  }, [currentSession]);

  // Load session context when session changes
  useEffect(() => {
    if (currentSession?.session_variables?.context_items) {
      setSessionContext(currentSession.session_variables.context_items);
      console.log('✅ ChatPage: Set session context:', currentSession.session_variables.context_items.length, 'items');
    } else {
      setSessionContext([]);
      console.log('📭 ChatPage: No context items in session');
    }
  }, [currentSession?.session_id, currentSession?.session_variables]);

  // Listen for sidebar messages and other events
  useEffect(() => {
    const handleSidebarMessage = (event: CustomEvent) => {
      const messageData = event.detail;
      console.log('📤 ChatPage received message from sidebar:', messageData);
      
      // Ensure we're on the same session as the sidebar
      if (messageData.sessionId && messageData.userId === user?.id) {
        // If ChatPage is on a different session, switch to the sidebar's session
        if (currentSession?.session_id !== messageData.sessionId) {
          console.log('🔄 Switching ChatPage to sidebar session:', messageData.sessionId);
          // Load the session that the sidebar is using
          loadSession(messageData.sessionId);
        }
        
        // Add the user message to ChatPage immediately
        const userMessage: Message = {
          id: messageData.messageId,
          text: messageData.message,
          sender: 'user',
          timestamp: new Date(messageData.timestamp),
        };
        addPersistedMessage(userMessage);
        console.log('✅ Added sidebar message to ChatPage UI');
        
        // Set loading state for the session to show "AI is thinking" indicator
        if (messageData.sessionId) {
          setSessionLoadingStates(prev => ({
            ...prev,
            [messageData.sessionId]: true
          }));
          console.log('💭 ChatPage showing AI is thinking for sidebar message (session loading)');
        }
        
        // Update ChatPage's selected model to match the sidebar's selection
        if (messageData.model && messageData.model !== selectedModel) {
          console.log('🔄 Updating ChatPage model from sidebar:', messageData.model);
          setSelectedModel(messageData.model);
        }
        
        // Don't re-send the message - sidebar already sent it via WebSocket
        // ChatPage just mirrors the UI state
        console.log('📋 ChatPage mirrored sidebar message (sidebar already sent via WebSocket)');
      }
    };
    
    // Also listen to shared WebSocket messages (for sidebar-initiated messages)
    const handleSharedWebSocketMessage = (event: CustomEvent) => {
      const data = event.detail;
      
      // Only process AI responses (user messages already handled by sidebar-send-message event)
      // Accept responses with no session_id (edit responses sometimes omit it) or matching session_id
      if (data.type === 'ai_response' && (!data.session_id || data.session_id === currentSession?.session_id)) {
        const messageId = data.message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Check for duplicate
        if (processedMessageIds.has(messageId)) {
          console.log('🤖 Duplicate AI response from shared WebSocket ignored:', messageId);
          return;
        }
        
        console.log('🤖 ChatPage received AI response from shared WebSocket:', messageId);
        
        // Process the same way as direct WebSocket
        const aiMessage: Message = {
          id: messageId,
          text: data.content || 'No response content',
          sender: 'bot',
          timestamp: new Date(data.timestamp || Date.now()),
        };
        
        setProcessedMessageIds(prev => new Set([...prev, messageId]));
        addPersistedMessage(aiMessage);
        setTypingMessages(prev => new Set([...prev, aiMessage.id]));
        
        // Clear loading state for this session (use currentSession if response has no session_id)
        const sessionIdToClear = data.session_id || currentSession?.session_id;
        if (sessionIdToClear) {
          setSessionLoadingStates(prev => ({
            ...prev,
            [sessionIdToClear]: false
          }));
          console.log('🔄 Cleared loading state for session:', sessionIdToClear);
        }
        
        console.log('✅ ChatPage processed AI response from shared WebSocket');
      }
    };
    
    const handleSidebarEdit = (event: CustomEvent) => {
      const editData = event.detail;
      console.log('✏️ ChatPage mirroring Sidebar edit:', editData);
      
      if (editData.sessionId === currentSession?.session_id && editData.userId === user?.id) {
        // Update message and truncate messages after it using the persistence system
        truncateMessagesAfter(editData.messageId, editData.newText);
        
        // Set loading state
        if (currentSession?.session_id) {
          setSessionLoadingStates(prev => ({
            ...prev,
            [currentSession.session_id]: true
          }));
        }
        
        console.log('✅ ChatPage mirrored Sidebar edit');
      }
    };
    
    // Handle AI processing cancellation from sidebar
    const handleCancelAIProcessing = (event: CustomEvent) => {
      const { sessionId, source } = event.detail;
      
      // Only process if it's from sidebar and matches current session
      if (source === 'sidebar' && sessionId === currentSession?.session_id) {
        console.log('🛑 ChatPage received cancel from sidebar, clearing loading state');
        setSessionLoadingStates(prev => ({
          ...prev,
          [sessionId]: false
        }));
      }
    };

    // Handle context updates from sidebar
    const handleContextSync = (event: CustomEvent) => {
      const { sessionId, contextItems } = event.detail;
      console.log('🔄 ChatPage: Received context sync from Sidebar:', { sessionId, itemCount: contextItems.length });
      
      if (sessionId === currentSession?.session_id) {
        setSessionContext(contextItems);
        console.log('✅ ChatPage: Synced context from Sidebar');
        
        // Update sessions list with new context
        updateSessionContext(sessionId, contextItems);
      }
    };
    
    window.addEventListener('sidebar-send-message', handleSidebarMessage as any);
    window.addEventListener('sidebar-edit-message', handleSidebarEdit as any);
    window.addEventListener('websocket-message', handleSharedWebSocketMessage as any);
    window.addEventListener('cancel-ai-processing', handleCancelAIProcessing as any);
    window.addEventListener('session-context-updated', handleContextSync as any);
    return () => {
      window.removeEventListener('sidebar-send-message', handleSidebarMessage as any);
      window.removeEventListener('sidebar-edit-message', handleSidebarEdit as any);
      window.removeEventListener('websocket-message', handleSharedWebSocketMessage as any);
      window.removeEventListener('cancel-ai-processing', handleCancelAIProcessing as any);
      window.removeEventListener('session-context-updated', handleContextSync as any);
    };
  }, [user?.id, currentSession?.session_id, processedMessageIds, addPersistedMessage, truncateMessagesAfter, loadSession, loadSessionsFromBackend, updateSessionContext]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Remove auto-creation - let user start typing first
  // Sessions will be created when user actually sends a message

  // Helper function to convert Uint8Array to base64 without stack overflow
  const convertUint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
    const chunkSize = 8192; // Process in 8KB chunks to avoid stack overflow
    let result = '';
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      result += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
    }
    
    return result;
  };

  const compressFile = async (file: File): Promise<{compressedData: string, originalSize: number, compressedSize: number}> => {
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
            const base64Data = convertUint8ArrayToBase64(uint8Array);
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
          const compressedBase64 = convertUint8ArrayToBase64(compressedData);
          
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
          const base64Data = convertUint8ArrayToBase64(uint8Array);
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
  };

  const handleFileUpload = async (files: FileList) => {
    const maxFileSize = 50 * 1024 * 1024; // 50MB limit
    const allowedTypes = [
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
      'application/sql', 'text/sql'
    ];
    
    console.log(`📁 User selected ${files.length} file(s) for upload`);
    
    for (const file of Array.from(files)) {
      console.log(`📁 Processing file: ${file.name} (${file.type}, ${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      
      // Validate file size
      if (file.size > maxFileSize) {
        console.error(`❌ File ${file.name} is too large: ${(file.size / 1024 / 1024).toFixed(2)} MB (max: 50 MB)`);
        alert(`File ${file.name} is too large. Maximum size is 50MB.`);
        continue;
      }
      
      // Validate file type
      if (!allowedTypes.includes(file.type)) {
        console.error(`❌ Unsupported file type: ${file.type} for ${file.name}`);
        alert(`File type ${file.type} is not supported.`);
        continue;
      }
      
      try {
        console.log(`🔄 Compressing file: ${file.name}`);
        // Compress the file
        const { compressedData, originalSize, compressedSize } = await compressFile(file);
        
        const compressionRatio = compressedSize / originalSize;
        console.log(`📦 File compression: ${file.name} - ${originalSize} -> ${compressedSize} bytes (${(compressionRatio * 100).toFixed(1)}%)`);
        
        const uploadedFile = {
          id: Date.now() + Math.random(),
          name: file.name,
          size: originalSize,
          type: file.type,
          compressedData,
          compressedSize,
          compressionRatio
        };
        
        setUploadedFiles(prev => {
          const newFiles = [...prev, uploadedFile];
          console.log(`✅ File added to upload queue: ${file.name} (${newFiles.length} total files)`);
          return newFiles;
        });
      } catch (error) {
        console.error(`❌ Failed to compress file ${file.name}:`, error);
        alert(`Failed to process file ${file.name}. Please try again.`);
      }
    }
  };

  const handleFileRemove = (index: number) => {
    setUploadedFiles(prev => {
      const fileToRemove = prev[index];
      const newFiles = prev.filter((_, i) => i !== index);
      console.log(`🗑️ File removed from upload queue: ${fileToRemove?.name} (${newFiles.length} files remaining)`);
      return newFiles;
    });
  };

  const handleEditMessage = (message: Message, messageIndex: number) => {
    // Check if AI is currently processing for this session
    const isCurrentlyProcessing = currentSession?.session_id && sessionLoadingStates[currentSession.session_id];
    
    if (isCurrentlyProcessing) {
      console.log('🛑 Cancelling ongoing AI processing for edit');
      
      // Immediately clear the loading state to stop "AI is thinking" indicator
      if (currentSession?.session_id) {
        setSessionLoadingStates(prev => ({
          ...prev,
          [currentSession.session_id]: false
        }));
      }
      
      // Notify via event for any other listeners
      const cancelEvent = new CustomEvent('cancel-ai-processing', {
        detail: {
          sessionId: currentSession?.session_id,
          reason: 'user_edit',
          timestamp: Date.now()
        }
      });
      window.dispatchEvent(cancelEvent);
      console.log('📡 Dispatched cancel-ai-processing event');
    }
    
    setEditingMessage(message);
    setEditingMessageIndex(messageIndex);
    setEditText(message.text);
  };

  const handleSaveEdit = async () => {
    if (!editingMessage || editingMessageIndex === null || !editText.trim()) return;
    
    try {
      // Send edit message via WebSocket
      if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
        const messageData = {
          type: 'edit_message',
          messageId: editingMessage.id,
          newText: editText,
          model: selectedModel,
          sessionId: currentSession?.session_id,
          userId: user?.id,
          context: {
            currentPage: 'chat',
            sessionId: currentSession?.session_id
          }
        };

        // Immediately update the local UI to show the edited message and remove subsequent messages
        truncateMessagesAfter(editingMessage.id, editText);
        
        websocketRef.current.send(JSON.stringify(messageData));
        
        // Clear editing state
        setEditingMessage(null);
        setEditingMessageIndex(null);
        setEditText('');
        
        // Set loading state for the current session
        if (currentSession?.session_id) {
          setSessionLoadingStates(prev => ({
            ...prev,
            [currentSession.session_id]: true
          }));
        }
        
        // Dispatch event to sidebar to mirror the edit
        const editEvent = new CustomEvent('chatpage-edit-message', {
          detail: {
            messageId: editingMessage.id,
            newText: editText,
            sessionId: currentSession?.session_id,
            userId: user?.id,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(editEvent);
        console.log('📡 ChatPage dispatched edit event to Sidebar');
      }
    } catch (error) {
      console.error('Error sending edit message:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setEditingMessageIndex(null);
    setEditText('');
  };

  // Send message with files to File Handler
  const sendMessageWithFilesToFileHandler = async (message: any, files: any[], sessionId: string, userId: string) => {
    try {
      const filesData = files.map(file => ({
        filename: file.name,
        content_type: file.type,
        data: file.compressedData // Already base64 encoded from compression
      }));

      const response = await fetch(`${ENV_CONFIG.apiGatewayUrl}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          message: {
            id: message.id,
            text: message.text,
            timestamp: message.timestamp
          },
          files: filesData,
          context_items: sessionContext // Include existing context
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('📁 Message with files sent to File Handler:', result);
      return result;
    } catch (error) {
      console.error('❌ Error sending message with files to File Handler:', error);
      throw error;
    }
  };

  const handleDeleteSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the session load
    try {
      await deleteSession(sessionId);
      console.log('📋 Session deleted:', sessionId);
    } catch (error) {
      console.error('📋 Error deleting session:', error);
    }
  };

  // Session selection handlers for context
  const handleSessionSelect = (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the session load
    setSelectedSessions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  };


  const handleOpenInSidebar = (sessionId: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation(); // Prevent loading the session in the main page
    }
    console.log(`📂 Opening session in GlobalChatSidebar: ${sessionId}`);
    
    // Set timestamp to prevent session restoration conflicts
    sessionStorage.setItem('last-opened-session', Date.now().toString());
    
    // Immediately open the sidebar with the session
    openWithSession(sessionId);
    
    // Dispatch custom event to force load the session in GlobalChatSidebar
    const manualSessionEvent = new CustomEvent('manual-session-open', {
      detail: {
        sessionId: sessionId,
        userId: user?.id,
        timestamp: Date.now()
      }
    });
    window.dispatchEvent(manualSessionEvent);
    
    // If this is the current session, we can also share the WebSocket connection
    // The GlobalChatSidebar will handle loading the session data
  };

  const getFirstUserMessage = (messages: any[]) => {
    return messages.find(msg => msg.sender === 'user')?.text || 'No user messages';
  };

  // Format timestamp using clock's timezone and military time settings
  const formatTimestamp = (timestamp: Date | number | string): string => {
    try {
      // Ensure we have a Date object
      let dateObj: Date;
      if (timestamp instanceof Date) {
        dateObj = timestamp;
      } else if (typeof timestamp === 'number') {
        // Handle Unix timestamp (could be seconds or milliseconds)
        if (timestamp > 1000000000000) {
          // Milliseconds
          dateObj = new Date(timestamp);
        } else {
          // Seconds
          dateObj = new Date(timestamp * 1000);
        }
      } else if (typeof timestamp === 'string') {
        dateObj = new Date(timestamp);
      } else {
        console.warn('Invalid timestamp format:', timestamp);
        dateObj = new Date();
      }

      // Validate the date
      if (isNaN(dateObj.getTime())) {
        console.warn('Invalid date created from timestamp:', timestamp);
        dateObj = new Date();
      }


      let timeString: string;
      
      if (clockTimezone === 'local') {
        // Use local timezone
        if (clockMilitaryTime) {
          timeString = dateObj.toLocaleTimeString('en-US', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          });
        } else {
          timeString = dateObj.toLocaleTimeString('en-US', { 
            hour12: true,
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      } else if (clockTimezone === 'UTC') {
        // Use UTC timezone
        if (clockMilitaryTime) {
          timeString = dateObj.toLocaleTimeString('en-US', { 
            timeZone: 'UTC',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          });
        } else {
          timeString = dateObj.toLocaleTimeString('en-US', { 
            timeZone: 'UTC',
            hour12: true,
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      } else {
        // Use specified timezone
        if (clockMilitaryTime) {
          timeString = dateObj.toLocaleTimeString('en-US', { 
            timeZone: clockTimezone,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          });
        } else {
          timeString = dateObj.toLocaleTimeString('en-US', { 
            timeZone: clockTimezone,
            hour12: true,
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      }
      
      return timeString;
    } catch (error) {
      console.error('Error formatting timestamp:', error, 'timestamp:', timestamp);
      // Fallback to current time
      return new Date().toLocaleTimeString();
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || getCurrentSessionLoading()) return;

    // Create a new session if none exists (only when user actually sends a message)
    let sessionToUse = currentSession;
    let sessionId = sessionToUse?.session_id;
    
    if (!sessionToUse || !sessionId) {
      try {
        // createNewSession returns the session_id
        sessionId = await createNewSession();
        console.log('📋 Created new session with ID:', sessionId);
        
        // Get the updated session from state
        sessionToUse = currentSession;
        
        // If state hasn't updated yet, create a minimal session object
        if (!sessionToUse && sessionId) {
          sessionToUse = {
            session_id: sessionId,
            title: new Date().toLocaleString(),
            model: selectedModel,
            created_at: Date.now(),
            last_updated: Date.now(),
            message_count: 0,
            messages: []
          };
        }
      } catch (error) {
        console.error('Failed to create new session:', error);
        return;
      }
    }

    // Double-check we have a valid session before proceeding
    if (!sessionToUse?.session_id) {
      console.error('No valid session available for message sending');
      return;
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${user?.id || 'anonymous'}`;
    
    // Check if we've already sent this message
    if (sentMessageIds.has(messageId)) {
      console.log('📤 Duplicate message prevented:', messageId);
      return;
    }
    
    // Also check if we've already sent a message with the same content recently
    const recentMessages = currentSession?.messages?.slice(-5) || [];
    const isDuplicateContent = recentMessages.some(msg => {
      if (msg.text !== inputMessage.trim() || msg.sender !== 'user') {
        return false;
      }
      
      // Handle different timestamp formats
      let msgTime;
      if (msg.timestamp instanceof Date) {
        msgTime = msg.timestamp.getTime();
      } else if (typeof msg.timestamp === 'number') {
        msgTime = msg.timestamp;
      } else if (typeof msg.timestamp === 'string') {
        msgTime = new Date(msg.timestamp).getTime();
      } else {
        // If timestamp is invalid, assume it's recent to be safe
        msgTime = Date.now();
      }
      
      return (Date.now() - msgTime) < 5000; // Within last 5 seconds
    });
    
    if (isDuplicateContent) {
      console.log('📤 Duplicate content message prevented:', inputMessage.trim());
      return;
    }
    
    const userMessage: Message = {
      id: messageId,
      text: inputMessage,
      sender: 'user',
      timestamp: new Date(),
      status: 'sending',
      files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
    };
    
    // Mark message as sent
    setSentMessageIds(prev => new Set([...prev, messageId]));
    console.log('📤 Message marked as sent:', messageId, 'Total sent messages:', sentMessageIds.size + 1);

    // Add message to persistence system
    console.log('📤 Adding user message to persistence:', {
      messageId: userMessage.id,
      text: userMessage.text,
      sessionId: sessionToUse?.session_id,
      currentMessageCount: currentSession?.messages?.length || 0
    });
    
    addPersistedMessage(userMessage);
    setInputMessage('');
    setUploadedFiles([]);
    
    // Mirror user message to GlobalChatSidebar
    const userMessageEvent = new CustomEvent('chatpage-message', {
      detail: {
        messageId: userMessage.id,
        sender: 'user',
        text: userMessage.text,
        sessionId: sessionToUse?.session_id,
        userId: user?.id,
        timestamp: Date.now()
      }
    });
    window.dispatchEvent(userMessageEvent);
    console.log('📡 Dispatched user message to sidebar:', userMessage.id);
    
    // Set loading state for the current session
    if (sessionToUse?.session_id) {
      setSessionLoadingStates(prev => ({
        ...prev,
        [sessionToUse.session_id]: true
      }));
    }

    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      // Route messages with files to File Handler, messages without files to WebSocket
      if (uploadedFiles.length > 0) {
        console.log(`📁 Message has ${uploadedFiles.length} files, routing to File Handler...`);
        try {
          await sendMessageWithFilesToFileHandler(userMessage, uploadedFiles, sessionToUse?.session_id || '', user?.id || '');
          console.log('✅ Message with files sent to File Handler');
          return; // Exit early, File Handler will orchestrate the rest
        } catch (error) {
          console.error('❌ Error sending message with files to File Handler:', error);
          // Fall back to WebSocket without files
          console.log('🔄 Falling back to WebSocket without files');
        }
      }
      
      // Prepare context items for WebSocket (no files)
      const contextItems = [...sessionContext];
      
      // Send the chat message with context items
      const messageData = {
        type: 'chat',
        messageId: userMessage.id, // Include the message ID from frontend
        message: userMessage.text,
        model: selectedModel,
        sessionId: sessionId, // Use the validated sessionId
        userId: user?.id,
        contextItems: contextItems, // Include files and other context
        context: {
          currentPage: 'chat',
          sessionId: sessionId // Use the validated sessionId
        },
      };

      try {
        websocketRef.current.send(JSON.stringify(messageData));
        // Message status will be updated via WebSocket response
      } catch (error) {
        console.error('Error sending message:', error);
        // Clear loading state for current session on error
        if (sessionToUse?.session_id) {
          setSessionLoadingStates(prev => ({
            ...prev,
            [sessionToUse.session_id]: false
          }));
        }
      }
    } else {
      console.error('WebSocket not connected');
      // Clear loading state for current session on error
      if (sessionToUse?.session_id) {
        setSessionLoadingStates(prev => ({
          ...prev,
          [sessionToUse.session_id]: false
        }));
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };


  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress sx={{ color: '#22c55e' }} />
      </Box>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <Box sx={{ 
      height: 'calc(100vh - 64px)', 
      maxHeight: 'calc(100vh - 64px)',
      display: 'flex', 
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background Effects */}
      <Box sx={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)'
      }} />

      {/* Sidebar */}
      <Drawer
        variant="persistent"
        anchor="left"
        open={sidebarOpen}
        sx={{
          width: sidebarOpen ? (sidebarCollapsed ? 60 : 300) : 0,
          flexShrink: 0,
          transition: 'width 0.3s ease-in-out',
          '& .MuiDrawer-paper': {
            width: sidebarOpen ? (sidebarCollapsed ? 60 : 300) : 0,
            boxSizing: 'border-box',
            backgroundColor: 'transparent',
            border: 'none',
            position: 'relative',
            transition: 'width 0.3s ease-in-out',
            overflow: 'hidden',
          },
        }}
      >
        <GlassCard sx={{ height: 'calc(100vh - 64px)', maxHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Sidebar Header */}
          <Box sx={{ p: 2, borderBottom: '2px solid #374151', minHeight: 64 }}>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              {!sidebarCollapsed && (
                <Box display="flex" alignItems="center" gap={1}>
                  <Tooltip title="Collapse sidebar">
                    <IconButton 
                      onClick={() => setSidebarCollapsed(true)}
                      sx={{ color: '#3b82f6', p: 0 }}
                    >
                      <ChatIcon />
                    </IconButton>
                  </Tooltip>
                  <Typography variant="h6" fontWeight={700} color="white" sx={{ textTransform: 'uppercase' }}>
                    Chat History
                  </Typography>
                </Box>
              )}
              {sidebarCollapsed && (
                <Box display="flex" alignItems="center" justifyContent="center" sx={{ width: '100%' }}>
                  <Tooltip title="Expand sidebar">
                    <IconButton 
                      onClick={() => setSidebarCollapsed(false)}
                      sx={{ color: '#3b82f6', p: 0 }}
                    >
                      <ChatIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              {!sidebarCollapsed && (
                <Box display="flex" alignItems="center" gap={1}>
                  <Tooltip title="Close sidebar">
                    <IconButton 
                      onClick={() => setSidebarOpen(false)}
                      sx={{ color: '#9ca3af' }}
                    >
                      <CloseIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            </Box>
          </Box>

          {/* New Chat Button */}
          {!sidebarCollapsed && (
            <Box sx={{ p: 2 }}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => createNewSession()}
                disabled={persistenceLoading}
                sx={{
                  borderColor: '#374151',
                  color: 'white',
                  textTransform: 'uppercase',
                  '&:hover': {
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                {persistenceLoading ? 'Creating...' : 'New Chat'}
              </Button>
            </Box>
          )}
          
          {/* Collapsed New Chat Button */}
          {sidebarCollapsed && (
            <Box sx={{ p: 1, display: 'flex', justifyContent: 'center' }}>
              <Tooltip title="New Chat">
                <IconButton
                  onClick={() => createNewSession()}
                  disabled={persistenceLoading}
                  sx={{
                    color: '#9ca3af',
                    '&:hover': {
                      color: '#3b82f6',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  <AddIcon />
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {/* Chat Sessions */}
          <Box 
            sx={{ 
              flex: 1, 
              overflow: 'auto', 
              px: sidebarCollapsed ? 0.5 : 1, 
              minHeight: 0,
              '&::-webkit-scrollbar': {
                width: '6px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'rgba(55, 65, 81, 0.3)',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(59, 130, 246, 0.5)',
                borderRadius: '3px',
              },
              '&::-webkit-scrollbar-thumb:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
              },
            }}
          >
            <List>
              {sessions.map((session) => (
                <ListItem key={session.session_id} disablePadding>
                  <ListItemButton
                    onClick={() => loadSession(session.session_id)}
                    sx={{
                      borderRadius: '4px',
                      mb: 0.5,
                      p: sidebarCollapsed ? 0.5 : 1,
                      justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                      backgroundColor: currentSession?.session_id === session.session_id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                      '&:hover': {
                        backgroundColor: currentSession?.session_id === session.session_id ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)',
                      },
                    }}
                  >
                    {sidebarCollapsed ? (
                      <Tooltip title={session.title} placement="right">
                        <ChatIcon sx={{ color: '#9ca3af', fontSize: '1.2rem' }} />
                      </Tooltip>
                    ) : (
                      <>
                        {/* Selection Checkbox */}
                        <Checkbox
                          checked={selectedSessions.has(session.session_id)}
                          onClick={(e) => handleSessionSelect(session.session_id, e)}
                          sx={{
                            color: '#9ca3af',
                            '&.Mui-checked': { color: '#3b82f6' },
                            p: 0.5,
                            mr: 0.5,
                            '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' }
                          }}
                          size="small"
                        />
                        <ListItemIcon sx={{ minWidth: '32px' }}>
                          <ChatIcon sx={{ color: '#9ca3af', fontSize: '1.1rem' }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="caption" color="white" sx={{ fontWeight: 500, fontSize: '0.75rem' }}>
                                {session.title}
                              </Typography>
                              {session.session_variables?.context_items && session.session_variables.context_items.length > 0 && (
                                <Chip
                                  label={`${session.session_variables.context_items.length}`}
                                  size="small"
                                  icon={<ContextIcon sx={{ fontSize: '0.7rem !important' }} />}
                                  sx={{
                                    height: '16px',
                                    fontSize: '0.6rem',
                                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                                    color: '#10b981',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    '& .MuiChip-icon': {
                                      marginLeft: '2px',
                                      marginRight: '-4px',
                                    }
                                  }}
                                />
                              )}
                            </Box>
                          }
                          secondary={
                            <Typography variant="caption" color="#9ca3af" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              {session.messages.length > 0 ? getFirstUserMessage(session.messages).substring(0, 40) + '...' : 'No messages'}
                              <br />
                              {new Date((session.created_at || session.last_updated || Date.now()) * 1000).toLocaleDateString()} • {session.message_count} msgs
                            </Typography>
                          }
                        />
                        <Tooltip title="Open in sidebar">
                          <IconButton
                            onClick={(e) => handleOpenInSidebar(session.session_id, e)}
                            sx={{
                              color: '#9ca3af',
                              padding: '2px',
                              mr: 0.5,
                              '&:hover': {
                                color: '#3b82f6',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <OpenInNewIcon sx={{ fontSize: '0.9rem' }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            onClick={(e) => handleDeleteSession(session.session_id, e)}
                            sx={{
                              color: '#9ca3af',
                              padding: '2px',
                              '&:hover': {
                                color: '#ef4444',
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                              },
                            }}
                          >
                            <DeleteIcon sx={{ fontSize: '0.9rem' }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>


          {/* AI Model Selector */}
          <Box sx={{ p: sidebarCollapsed ? 1 : 2, borderTop: '2px solid #374151' }}>
            {sidebarCollapsed ? (
              <Box display="flex" alignItems="center" justifyContent="center">
                <Tooltip title={`AI Model: ${selectedModel}`} placement="right">
                  <BrainIcon sx={{ color: '#9ca3af' }} />
                </Tooltip>
              </Box>
            ) : (
              <Box>
                <Typography variant="caption" color="#9ca3af" sx={{ textTransform: 'uppercase', mb: 1, display: 'block' }}>
                  AI Model
                </Typography>
                <FormControl size="small" fullWidth>
                  <Select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    sx={{
                      color: 'white',
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#374151',
                      },
                      '& .MuiSelect-select': {
                        padding: '8px 12px',
                        fontSize: '0.875rem',
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#6b7280',
                      },
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#3b82f6',
                      },
                    }}
                  >
                    <MenuItem value="claude-3-sonnet">Claude 3 Sonnet</MenuItem>
                    <MenuItem value="claude-3-haiku">Claude 3 Haiku</MenuItem>
                    <MenuItem value="nova-lite">Amazon Nova Lite</MenuItem>
                    <MenuItem value="gpt-oss-120b">GPT-OSS 120B</MenuItem>
                    <MenuItem value="gpt-oss-20b">GPT-OSS 20B</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            )}
          </Box>
        </GlassCard>
      </Drawer>

      {/* Main Chat Area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', height: 'calc(100vh - 64px)', maxHeight: 'calc(100vh - 64px)', overflow: 'hidden' }}>
        {/* Floating Menu */}
        <Box sx={{ 
          position: 'absolute', 
          top: 16, 
          right: 16, 
          zIndex: 1000,
          display: 'flex',
          gap: 1,
          alignItems: 'center'
        }}>
          {/* Sidebar Toggle - Only shows when sidebar is completely closed */}
          {!sidebarOpen && (
            <Tooltip title="Open Chat History">
              <IconButton 
                onClick={() => setSidebarOpen(true)}
                sx={{ 
                  color: '#3b82f6',
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  border: '1px solid #374151',
                  '&:hover': {
                    color: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                <ChatIcon />
              </IconButton>
            </Tooltip>
          )}
          
        </Box>

        {/* Messages */}
        <Box sx={{ 
          flex: 1, 
          overflow: 'auto', 
          p: 2, 
          minHeight: 0,
          '&::-webkit-scrollbar': {
            width: '6px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'rgba(55, 65, 81, 0.3)',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(59, 130, 246, 0.5)',
            borderRadius: '3px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
          },
        }}>
          <Stack spacing={2}>
            {messages.length === 0 && !currentSession && (
              <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center', 
                height: '100%',
                textAlign: 'center',
                color: '#9ca3af'
              }}>
                <BotIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
                <Typography variant="h6" gutterBottom>
                  Welcome to Cosine AI
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  Start a conversation by typing a message below
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                  Or select a previous chat from the sidebar
                </Typography>
              </Box>
            )}
            {messages.map((message, messageIndex) => (
              <Box key={message.id} display="flex" gap={2}>
                <Avatar sx={{ bgcolor: message.sender === 'user' ? '#3b82f6' : '#374151', width: 32, height: 32 }}>
                  {message.sender === 'user' ? <PersonIcon /> : <BotIcon />}
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <MessageBubble isUser={message.sender === 'user'} status={(message as any).status || 'sent'}>
                    {editingMessage && editingMessage.id === message.id ? (
                      <Box ref={editContainerRef} sx={{ position: 'relative' }}>
                        <TextField
                          fullWidth
                          multiline
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              handleCancelEdit();
                            } else if (e.key === 'Enter' && e.shiftKey === false) {
                              e.preventDefault();
                              if (editText.trim()) {
                                handleSaveEdit();
                              }
                            }
                          }}
                          variant="outlined"
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              color: 'white',
                              paddingRight: '60px', // Space for send button
                              '& fieldset': {
                                borderColor: '#374151',
                              },
                              '&:hover fieldset': {
                                borderColor: '#3b82f6',
                              },
                              '&.Mui-focused fieldset': {
                                borderColor: '#3b82f6',
                              },
                            },
                          }}
                        />
                        <Box
                          sx={{
                            position: 'absolute',
                            bottom: 8,
                            right: 8,
                            display: 'flex',
                            gap: 0.5,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Tooltip title="Cancel (Esc)">
                            <IconButton
                              size="small"
                              onClick={handleCancelEdit}
                              sx={{
                                color: '#9ca3af',
                                '&:hover': { color: '#ef4444' },
                                width: 28,
                                height: 28,
                              }}
                            >
                              <CloseIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Send (Enter)">
                            <IconButton
                              size="small"
                              onClick={handleSaveEdit}
                              disabled={!editText.trim()}
                              sx={{
                                color: editText.trim() ? '#22c55e' : '#6b7280',
                                '&:hover': { 
                                  color: editText.trim() ? '#16a34a' : '#6b7280',
                                  backgroundColor: editText.trim() ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                                },
                                width: 28,
                                height: 28,
                              }}
                            >
                              <SendIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>
                    ) : (
                      <>
                        {message.sender === 'bot' && typingMessages.has(message.id) ? (
                          <TypingText 
                            text={message.text} 
                            speed={2}
                            onComplete={() => {
                              setTypingMessages(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(message.id);
                                return newSet;
                              });
                            }}
                          />
                        ) : (
                          <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
                            {message.text}
                          </Typography>
                        )}
                        {(message as any).files && (message as any).files.length > 0 && (
                          <Stack spacing={1} mt={1}>
                            {(message as any).files.map((file: any) => (
                              <FilePreview key={file.name}>
                                <FileIcon sx={{ color: '#22c55e' }} />
                                <Typography variant="body2" color="white">
                                  {file.name}
                                </Typography>
                                <Typography variant="caption" color="#9ca3af">
                                  ({(file.size / 1024).toFixed(1)} KB)
                                </Typography>
                              </FilePreview>
                            ))}
                          </Stack>
                        )}
                      </>
                    )}
                  </MessageBubble>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="caption" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
                      {formatTimestamp(message.timestamp)}
                    </Typography>
                    {message.sender === 'user' && !editingMessage && (
                      <Tooltip title="Edit message">
                        <IconButton
                          size="small"
                          onClick={() => handleEditMessage(message, messageIndex)}
                          sx={{ 
                            color: '#9ca3af',
                            '&:hover': { color: '#3b82f6' }
                          }}
                        >
                          <EditIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              </Box>
            ))}
            {getCurrentSessionLoading() && (
              <Box display="flex" gap={2}>
                <Avatar sx={{ bgcolor: '#374151', width: 32, height: 32 }}>
                  <BotIcon />
                </Avatar>
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={20} sx={{ color: '#22c55e' }} />
                  <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
                    AI is thinking...
                  </Typography>
                </Box>
              </Box>
            )}
            
            {missedResponseNotification && (
              <Box 
                sx={{ 
                  p: 2, 
                  backgroundColor: 'rgba(59, 130, 246, 0.1)', 
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: 2,
                  mb: 2
                }}
              >
                <Typography variant="body2" color="#3b82f6" sx={{ textAlign: 'center' }}>
                  ℹ️ {missedResponseNotification}
                </Typography>
              </Box>
            )}
            <div ref={messagesEndRef} />
          </Stack>
        </Box>

        {/* File Upload Area - Compact */}
        {uploadedFiles.length > 0 && (
          <GlassCard sx={{ p: 1, borderTop: '2px solid #374151', flexShrink: 0 }}>
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="caption" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
                Files:
              </Typography>
              {uploadedFiles.map((file, index) => (
                <Chip
                  key={index}
                  label={file.name}
                  size="small"
                  onDelete={() => handleFileRemove(index)}
                  sx={{
                    backgroundColor: '#374151',
                    color: 'white',
                    fontSize: '0.75rem',
                    height: 24,
                    '& .MuiChip-deleteIcon': {
                      color: '#9ca3af',
                      fontSize: '1rem',
                    },
                  }}
                />
              ))}
            </Box>
          </GlassCard>
        )}

        {/* Context Items - Collapsible */}
        {sessionContext.length > 0 && (
          <Box sx={{ borderTop: '2px solid #374151', backgroundColor: 'rgba(15, 23, 42, 0.95)' }}>
            <Box
              sx={{
                p: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
              }}
              onClick={() => setIsContextExpanded(!isContextExpanded)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ContextIcon sx={{ color: '#10b981', fontSize: '1rem' }} />
                <Typography variant="body2" sx={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
                  Context ({sessionContext.length} {sessionContext.length === 1 ? 'item' : 'items'})
                </Typography>
              </Box>
              {isContextExpanded ? <ExpandLessIcon fontSize="small" sx={{ color: '#9ca3af' }} /> : <ExpandMoreIcon fontSize="small" sx={{ color: '#9ca3af' }} />}
            </Box>
            <Collapse in={isContextExpanded}>
              <List dense sx={{ py: 0, px: 1, maxHeight: 150, overflow: 'auto' }}>
                {sessionContext.map((item, index) => (
                  <ListItem 
                    key={index} 
                    sx={{ 
                      py: 0.5, 
                      px: 1,
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        '& .remove-context-btn': {
                          opacity: 1,
                        }
                      }
                    }}
                  >
                    {/* Delete button on the left */}
                    <IconButton
                      size="small"
                      className="remove-context-btn"
                      onClick={async () => {
                        const newContext = sessionContext.filter((_, i) => i !== index);
                        setSessionContext(newContext);
                        console.log(`🗑️ Removed context item: ${item.title}`);
                        
                        // Notify Sidebar of context change immediately
                        if (currentSession?.session_id) {
                          const syncEvent = new CustomEvent('session-context-updated', {
                            detail: { sessionId: currentSession.session_id, contextItems: newContext }
                          });
                          window.dispatchEvent(syncEvent);
                        }
                        
                        // Persist the updated context to backend immediately
                        if (currentSession?.session_id && user?.id) {
                          try {
                            await sessionManagementAPI.updateSession(currentSession.session_id, user.id, {
                              session_variables: {
                                context_items: newContext,
                                context_added_at: Date.now(),
                              }
                            });
                            console.log('✅ Updated context in backend');
                            
                            // Update sessions list with new context
                            updateSessionContext(currentSession.session_id, newContext);
                          } catch (error) {
                            console.error('❌ Failed to update context in backend:', error);
                          }
                        }
                      }}
                      sx={{ 
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        color: '#dc2626',
                        mr: 1,
                        '&:hover': { color: '#ef4444' }
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                    
                    {/* Content on the right */}
                    <ListItemText
                      primary={item.title}
                      secondary={item.subtitle}
                      primaryTypographyProps={{
                        fontSize: '0.75rem',
                        color: '#ffffff',
                      }}
                      secondaryTypographyProps={{
                        fontSize: '0.65rem',
                        color: '#9ca3af',
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </Collapse>
          </Box>
        )}

        {/* Uploaded Files - Separate Section */}
        {currentSession?.session_variables?.uploaded_files && currentSession.session_variables.uploaded_files.length > 0 && (
          <Box sx={{ borderTop: '2px solid #374151', backgroundColor: 'rgba(15, 23, 42, 0.95)' }}>
            <Box
              sx={{
                p: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
              }}
              onClick={() => setIsFilesExpanded(!isFilesExpanded)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FileIcon sx={{ color: '#3b82f6', fontSize: '1rem' }} />
                <Typography variant="body2" sx={{ color: '#3b82f6', fontSize: '0.8rem', fontWeight: 600 }}>
                  Files ({currentSession.session_variables.uploaded_files.length} {currentSession.session_variables.uploaded_files.length === 1 ? 'file' : 'files'})
                </Typography>
              </Box>
              {isFilesExpanded ? <ExpandLessIcon fontSize="small" sx={{ color: '#9ca3af' }} /> : <ExpandMoreIcon fontSize="small" sx={{ color: '#9ca3af' }} />}
            </Box>
            <Collapse in={isFilesExpanded}>
              <List dense sx={{ py: 0, px: 1, maxHeight: 150, overflow: 'auto' }}>
                {currentSession.session_variables.uploaded_files.map((file: any, index: number) => (
                  <ListItem 
                    key={index} 
                    sx={{ 
                      py: 0.5, 
                      px: 1,
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        '& .remove-file-btn': {
                          opacity: 1,
                        }
                      }
                    }}
                  >
                    {/* Delete button on the left */}
                    <IconButton
                      size="small"
                      className="remove-file-btn"
                      onClick={async () => {
                        const newFiles = currentSession.session_variables.uploaded_files.filter((_: any, i: number) => i !== index);
                        const updatedSession = {
                          ...currentSession,
                          session_variables: {
                            ...currentSession.session_variables,
                            uploaded_files: newFiles
                          }
                        };
                        setCurrentSession(updatedSession);
                        console.log(`🗑️ Removed file: ${file.filename}`);
                        
                        // Persist the updated files to backend immediately
                        if (currentSession?.session_id && user?.id) {
                          try {
                            await sessionManagementAPI.updateSession(currentSession.session_id, user.id, {
                              session_variables: {
                                ...currentSession.session_variables,
                                uploaded_files: newFiles,
                                files_added_at: Date.now(),
                              }
                            });
                            console.log('✅ Updated files in backend');
                          } catch (error) {
                            console.error('❌ Failed to update files in backend:', error);
                          }
                        }
                      }}
                      sx={{ 
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        color: '#dc2626',
                        mr: 1,
                        '&:hover': { color: '#ef4444' }
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                    
                    {/* Content on the right */}
                    <ListItemText
                      primary={file.filename}
                      secondary={`${(file.file_size / 1024).toFixed(1)} KB • ${file.content_type}`}
                      primaryTypographyProps={{
                        fontSize: '0.75rem',
                        color: '#ffffff',
                      }}
                      secondaryTypographyProps={{
                        fontSize: '0.65rem',
                        color: '#9ca3af',
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </Collapse>
          </Box>
        )}

        {/* Input Area - Compact with Paperclip */}
        <GlassCard sx={{ p: 2, borderTop: '2px solid #374151', flexShrink: 0 }}>
          <Box display="flex" alignItems="flex-end" gap={1}>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileUpload(e.target.files!)}
              multiple
              style={{ display: 'none' }}
            />
            <Tooltip title="Upload files">
              <IconButton
                onClick={() => fileInputRef.current?.click()}
                sx={{
                  color: '#9ca3af',
                  '&:hover': {
                    color: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                <AttachFileIcon />
              </IconButton>
            </Tooltip>
            <TextField
              fullWidth
              multiline
              maxRows={3}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask me about stocks, crypto, portfolio optimization..."
              disabled={getCurrentSessionLoading()}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'rgba(55, 65, 81, 0.3)',
                  color: 'white',
                  '& fieldset': {
                    borderColor: '#374151',
                  },
                  '&:hover fieldset': {
                    borderColor: '#6b7280',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#3b82f6',
                  },
                },
                '& .MuiInputBase-input::placeholder': {
                  color: '#9ca3af',
                  opacity: 1,
                },
              }}
            />
            <IconButton
              onClick={handleSendMessage}
              disabled={getCurrentSessionLoading() || !inputMessage.trim()}
              sx={{
                color: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                '&:hover': {
                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                },
                '&:disabled': {
                  color: '#6b7280',
                  backgroundColor: 'rgba(55, 65, 81, 0.3)',
                },
              }}
            >
              <SendIcon />
            </IconButton>
          </Box>
        </GlassCard>
      </Box>
    </Box>
  );
}
