import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ENV_CONFIG } from '@/config/environment';
import { useChatPersistence } from '@/hooks/useChatPersistence';
import { useClock } from '@/contexts/ClockContext';
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
  name: string;
  size: number;
  content: string;
}

interface WebSocketMessage {
  type: 'connection_established' | 'message_received' | 'ai_response' | 'error' | 'connection_establish' | 'edit_acknowledged';
  message_id?: string;
  session_id?: string;
  content?: string;
  message?: string;
  timestamp?: string;
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
  } = useChatPersistence(user?.id || '');
  
  // Use messages from current session
  const messages = currentSession?.messages || [];
  const [inputMessage, setInputMessage] = useState('');
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState('claude-3-sonnet');
  // Connection status variables - used internally for WebSocket logic
  const [_connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [_connectionError, setConnectionError] = useState<string | null>(null);
  const [typingMessages, setTypingMessages] = useState<Set<string>>(new Set());
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Message editing state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  
  // Clear loading state when session is deleted
  useEffect(() => {
    if (!currentSession && isLoadingChat) {
      console.log('🔴 DELETE: Clearing loading state due to session deletion');
      setIsLoadingChat(false);
    }
  }, [currentSession, isLoadingChat]);
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
        // Add AI response to messages
        const aiMessage: Message = {
          id: data.message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          text: data.content || 'No response content',
          sender: 'bot',
          timestamp: new Date(data.timestamp || Date.now()),
        };
        
        console.log('🤖 Received AI response:', {
          messageId: aiMessage.id,
          contentLength: aiMessage.text.length,
          currentSessionId: currentSession?.session_id,
          currentMessageCount: currentSession?.messages?.length || 0
        });
        
        // Add to persistence system
        addPersistedMessage(aiMessage);
        // Add to typing messages to trigger typing animation
        setTypingMessages(prev => new Set([...prev, aiMessage.id]));
        setIsLoadingChat(false);
        break;

      case 'edit_acknowledged':
        console.log('✏️ Edit acknowledged:', data.message_id);
        // UI has already been updated in handleSaveEdit, just log acknowledgment
        // The AI response will come as a separate 'ai_response' message
        break;

      case 'error':
        console.error('WebSocket error message:', data.message);
        setConnectionError(data.message || 'Unknown error');
        setIsLoadingChat(false);
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Remove auto-creation - let user start typing first
  // Sessions will be created when user actually sends a message

  const handleFileUpload = (files: FileList) => {
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setUploadedFiles(prev => [...prev, {
          name: file.name,
          size: file.size,
          content
        }]);
      };
      reader.readAsText(file);
    });
  };

  const handleFileRemove = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleEditMessage = (message: Message, messageIndex: number) => {
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
        
        setIsLoadingChat(true);
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

  const handleDeleteSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the session load
    try {
      await deleteSession(sessionId);
      console.log('📋 Session deleted:', sessionId);
    } catch (error) {
      console.error('📋 Error deleting session:', error);
    }
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
    if (!inputMessage.trim() || isLoadingChat) return;

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
        setIsLoadingChat(false);
        return;
      }
    }

    // Double-check we have a valid session before proceeding
    if (!sessionToUse?.session_id) {
      console.error('No valid session available for message sending');
      setIsLoadingChat(false);
      return;
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const userMessage: Message = {
      id: messageId,
      text: inputMessage,
      sender: 'user',
      timestamp: new Date(),
      status: 'sending',
      files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
    };

    // Add message to persistence system
    addPersistedMessage(userMessage);
    setInputMessage('');
    setUploadedFiles([]);
    setIsLoadingChat(true);

    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      const messageData = {
        type: 'chat',
        messageId: userMessage.id, // Include the message ID from frontend
        message: userMessage.text,
        model: selectedModel,
        files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        sessionId: sessionId, // Use the validated sessionId
        userId: user?.id,
        context: {
          currentPage: 'chat',
          sessionId: sessionId // Use the validated sessionId
        }
      };

      try {
        websocketRef.current.send(JSON.stringify(messageData));
        // Message status will be updated via WebSocket response
      } catch (error) {
        console.error('Error sending message:', error);
        setIsLoadingChat(false);
      }
    } else {
      console.error('WebSocket not connected');
      setIsLoadingChat(false);
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
          <Box sx={{ flex: 1, overflow: 'auto', px: sidebarCollapsed ? 0.5 : 1, minHeight: 0 }}>
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
                        <ListItemIcon sx={{ minWidth: '32px' }}>
                          <ChatIcon sx={{ color: '#9ca3af', fontSize: '1.1rem' }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Typography variant="caption" color="white" sx={{ fontWeight: 500, fontSize: '0.75rem' }}>
                              {session.title}
                            </Typography>
                          }
                          secondary={
                            <Typography variant="caption" color="#9ca3af" sx={{ display: 'block', fontSize: '0.7rem' }}>
                              {session.messages.length > 0 ? getFirstUserMessage(session.messages).substring(0, 40) + '...' : 'No messages'}
                              <br />
                              {new Date((session.created_at || session.last_updated || Date.now()) * 1000).toLocaleDateString()} • {session.message_count} msgs
                            </Typography>
                          }
                        />
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
        <Box sx={{ flex: 1, overflow: 'auto', p: 2, minHeight: 0 }}>
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
            {isLoadingChat && (
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
              disabled={isLoadingChat}
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
              disabled={isLoadingChat || !inputMessage.trim()}
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
