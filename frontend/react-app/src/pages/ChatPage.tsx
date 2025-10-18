import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useChatPersistence } from '@/hooks/useChatPersistence';
import { useClock } from '@/contexts/ClockContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import { sessionManagementAPI } from '@/services/api';
import { ContextItem } from '@/components/tiles/common/contextManager';
// NEW: Import shared file upload service
import { FileUploadService, UploadedFile } from '@/services/fileUploadService';
// NEW: Import unified messaging system
import { useUnifiedMessaging } from '@/hooks/useUnifiedMessaging';
import { unifiedMessageHandler } from '@/services/unifiedMessageHandler';
import AgentFileAttachment from '@/components/chat/AgentFileAttachment';
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
  files?: Array<{
  name: string;
  size: number;
    type: string;
  }> | UploadedFile[]; // Support both formats for backward compatibility
  file_data?: Array<{
    filename: string;
    file_type: string;
    file_size: number;
    download_url: string;
    created_by?: string;
  }>;
}

// UploadedFile interface now imported from shared FileUploadService

// WebSocket message handling is now done by the unified MessagingService


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
        {status === 'sending' && <CircularProgress size={12} sx={{ color: '#3b82f6' }} />}
        {status === 'sent' && <Typography variant="caption" sx={{ color: '#22c55e', fontSize: '12px', fontWeight: 'bold' }}>✓</Typography>}
        {status === 'delivered' && <Typography variant="caption" sx={{ color: '#16a34a', fontSize: '12px', fontWeight: 'bold' }}>✓✓</Typography>}
        {status === 'error' && <Typography variant="caption" sx={{ color: '#dc2626', fontSize: '12px', fontWeight: 'bold' }}>✗</Typography>}
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
    updateSessionContext,
    updateSessionFiles,
    updateSessionVariables,
  } = useChatPersistence(user?.id || '');
  
  // Use messages from current session
  const messages = currentSession?.messages || [];
  const [inputMessage, setInputMessage] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState('claude-3-sonnet');
  const [missedResponseNotification] = useState<string | null>(null);
  // Typing messages for AI response animation
  const [typingMessages, setTypingMessages] = useState<Set<string>>(new Set());
  
  // Session-specific state tracking
  const [sessionLoadingStates, setSessionLoadingStates] = useState<Record<string, boolean>>({});
  const [pendingMessages, setPendingMessages] = useState<Record<string, Message[]>>({});
  // Removed unused state variables
  
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
  const previousContextRef = useRef<ContextItem[]>([]);
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [isFilesExpanded, setIsFilesExpanded] = useState(false);
  
  // Function to detect if context has changed
  const hasContextChanged = useCallback(() => {
    const currentContext = sessionContext;
    const previousContext = previousContextRef.current;
    
    // Compare lengths first (quick check)
    if (currentContext.length !== previousContext.length) {
      return true;
    }
    
    // Compare each item by ID and timestamp
    for (let i = 0; i < currentContext.length; i++) {
      const current = currentContext[i];
      const previous = previousContext[i];
      
      if (!previous || 
          current.id !== previous.id || 
          current.timestamp !== previous.timestamp) {
        return true;
      }
    }
    
    return false;
  }, [sessionContext]);
  
  // Update previous context when session changes
  useEffect(() => {
    if (currentSession?.session_id) {
      previousContextRef.current = [...sessionContext];
    }
  }, [currentSession?.session_id, sessionContext]);
  
  // NEW: Unified messaging system for centralized message handling
  const {
    messages: unifiedMessages,
    isProcessing: isUnifiedProcessing,
    crossInterfaceLoading,
    sendMessage: sendUnifiedMessage,
    sendContextMessage: sendUnifiedContextMessage,
    sendFileMessage: sendUnifiedFileMessage,
    sendFollowupMessage: sendUnifiedFollowupMessage,
    sendEditMessage: sendUnifiedEditMessage
  } = useUnifiedMessaging({
    sessionId: currentSession?.session_id || null,
    userId: user?.id,
    source: 'chatpage',
    onMessageUpdate: (update) => {
      console.log('📨 ChatPage: Received unified message update:', update.type);
    }
  });

  // Sync unified messages with local persistence system
  useEffect(() => {
    if (!currentSession?.session_id || unifiedMessages.length === 0) return;

    console.log('🔄 ChatPage: Syncing unified messages with persistence system', {
      sessionId: currentSession.session_id,
      unifiedMessageCount: unifiedMessages.length,
      localMessageCount: currentSession.messages.length
    });

    // Only sync messages that belong to the current session
    const sessionMessages = unifiedMessages.filter(msg => msg.sessionId === currentSession.session_id);
    
    if (sessionMessages.length === 0) {
      console.log('🔄 ChatPage: No unified messages for current session, skipping sync');
      return;
    }

    // Get messages that exist in unified cache but not in local persistence
    const localMessageIds = new Set(currentSession.messages.map(m => m.id));
    const newMessages = sessionMessages.filter(unifiedMsg => !localMessageIds.has(unifiedMsg.id));

    // Only add truly new messages to prevent duplication
    if (newMessages.length > 0) {
      console.log(`📨 ChatPage: Found ${newMessages.length} new messages to add to persistence`);
      newMessages.forEach(unifiedMsg => {
        console.log('📨 ChatPage: Adding unified message to persistence:', unifiedMsg.id);
        addPersistedMessage({
          id: unifiedMsg.id,
          text: unifiedMsg.text,
          sender: unifiedMsg.sender === 'ai' ? 'bot' : unifiedMsg.sender,
          timestamp: new Date(unifiedMsg.timestamp),
          files: unifiedMsg.files
        });
      });
    } else {
      console.log('🔄 ChatPage: All unified messages already exist in persistence, skipping sync');
    }
  }, [unifiedMessages, currentSession?.session_id, currentSession?.messages, addPersistedMessage]);

  // Listen for AI response typing events from unified messaging system
  useEffect(() => {
    const handleAITyping = (event: CustomEvent) => {
      const { sessionId, messageId } = event.detail;
      
      // Only handle typing for current session
      if (sessionId === currentSession?.session_id) {
        console.log('🤖 ChatPage: Received AI typing event for message:', messageId);
        setTypingMessages(prev => new Set([...prev, messageId]));
        
        // Clear loading state when AI starts responding (with small delay to ensure loading wheel is visible)
        if (currentSession?.session_id) {
          console.log('🤖 ChatPage: AI started typing, clearing loading state for session:', currentSession.session_id);
          setTimeout(() => {
            setSessionLoadingStates(prev => ({
              ...prev,
              [currentSession.session_id]: false
            }));
            // Broadcast loading state clearing to other interfaces
            unifiedMessageHandler.broadcastLoadingState(currentSession.session_id, false, 'chatpage');
          }, 100); // Small delay to ensure loading wheel is visible
        }
      }
    };

    window.addEventListener('ai-response-typing', handleAITyping as EventListener);
    
    return () => {
      window.removeEventListener('ai-response-typing', handleAITyping as EventListener);
    };
  }, [currentSession?.session_id]);

  // Listen for session variable updates (including file uploads)
  useEffect(() => {
    const handleSessionVariablesUpdate = (event: CustomEvent) => {
      const { sessionId, sessionVariables } = event.detail;
      console.log('📁 ChatPage: Received session variables update:', { sessionId, fileCount: sessionVariables?.uploaded_files?.length || 0 });
      
      if (sessionId === currentSession?.session_id) {
        // Update session variables in persistence system
        updateSessionVariables(sessionId, sessionVariables);
        console.log('✅ ChatPage: Updated session variables in real-time');
      }
    };

    window.addEventListener('session-variables-updated', handleSessionVariablesUpdate as any);
    
    return () => {
      window.removeEventListener('session-variables-updated', handleSessionVariablesUpdate as any);
    };
  }, [currentSession?.session_id]);
  
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
    
    // Set model from session if available
    if (currentSession?.model) {
      setSelectedModel(currentSession.model);
    }
    
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

  // WebSocket connection and message handling is now done by the unified MessagingService

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

  // Note: All message handling is now done by the unified messaging system

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Remove auto-creation - let user start typing first
  // Sessions will be created when user actually sends a message

  // NEW: Use shared file upload service
  const handleFileUpload = async (files: FileList) => {
    console.log(`📁 ChatPage: User selected ${files.length} file(s) for upload`);
    
    try {
      // Use shared file upload service
      const processedFiles = await FileUploadService.processFiles(files);
      
      // Add processed files to state
      setUploadedFiles(prev => {
        const newFiles = [...prev, ...processedFiles];
        console.log(`✅ ChatPage: Added ${processedFiles.length} files to upload queue (${newFiles.length} total files)`);
        return newFiles;
      });
    } catch (error) {
      console.error('❌ ChatPage: Failed to process files:', error);
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
    if (!editingMessage || editingMessageIndex === null || !editText.trim() || isUnifiedProcessing) return;
    
    try {
      console.log('✏️ ChatPage: Sending edit message via unified system');
      
      // Send edit message via unified system
      const result = await sendUnifiedEditMessage(editText, editingMessage.id, selectedModel);
      
      if (result.success) {
        console.log('✅ ChatPage: Edit message sent successfully');

        // Immediately update the local UI to show the edited message and remove subsequent messages
        truncateMessagesAfter(editingMessage.id, editText);
        
        // Clear editing state
        setEditingMessage(null);
        setEditingMessageIndex(null);
        setEditText('');
      } else {
        console.error('❌ ChatPage: Failed to send edit message:', result.error);
      }
    } catch (error) {
      console.error('❌ ChatPage: Error sending edit message:', error);
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
    if (!inputMessage.trim() || getCurrentSessionLoading() || isUnifiedProcessing) return;

    console.log('📤 ChatPage: Sending message via unified messaging system');
    
    // Clear input and files immediately when sending
    setInputMessage('');
    if (uploadedFiles.length > 0) {
      console.log('📁 ChatPage: Clearing uploaded files immediately on send');
      setUploadedFiles([]);
    }
    
    // Set loading state for current session
    if (currentSession?.session_id) {
      console.log('🔄 ChatPage: Setting loading state to true for session:', currentSession.session_id);
      setSessionLoadingStates(prev => ({
        ...prev,
        [currentSession.session_id]: true
      }));
    }
    
    try {
      let result;
      
      // Determine message type and send accordingly
      if (uploadedFiles.length > 0) {
        // File message
        console.log(`📁 ChatPage: Sending file message with ${uploadedFiles.length} files`);
        result = await sendUnifiedFileMessage(inputMessage, uploadedFiles as unknown as File[], selectedModel);
      } else if (sessionContext.length > 0 && hasContextChanged()) {
        // Context message (only if context has changed)
        console.log(`📋 ChatPage: Sending context message with ${sessionContext.length} context items (context changed)`);
        result = await sendUnifiedContextMessage(inputMessage, sessionContext, selectedModel);
        // Update previous context after sending
        previousContextRef.current = [...sessionContext];
      } else if (currentSession?.session_id) {
        // Followup message (existing session)
        console.log('🔄 ChatPage: Sending followup message to existing session');
        result = await sendUnifiedFollowupMessage(inputMessage, selectedModel);
      } else {
        // New message (no session)
        console.log('🆕 ChatPage: Sending new message (will create session)');
        result = await sendUnifiedMessage({
          text: inputMessage,
            model: selectedModel,
          type: 'new_message'
        });
      }
      
      if (result.success) {
        console.log('✅ ChatPage: Message sent successfully via unified system');
    
        // Update session ID if a new session was created
        if (result.sessionId && result.sessionId !== currentSession?.session_id) {
          console.log('🔄 ChatPage: New session created, loading session:', result.sessionId);
          loadSession(result.sessionId);
        }
      } else {
        console.error('❌ ChatPage: Failed to send message:', result.error);
        // Clear loading state on error
        if (currentSession?.session_id) {
          setSessionLoadingStates(prev => ({
            ...prev,
            [currentSession.session_id]: false
          }));
        }
        // Handle error (could show toast notification)
      }
      } catch (error) {
      console.error('❌ ChatPage: Error sending message via unified system:', error);
      // Clear loading state on error
      if (currentSession?.session_id) {
        setSessionLoadingStates(prev => ({
          ...prev,
          [currentSession.session_id]: false
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
                    value={selectedModel || 'claude-3-sonnet'}
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
                    <MenuItem value="claude-3-sonnet" title="Strikes ideal balance between intelligence and speed">
                      Balanced
                    </MenuItem>
                    <MenuItem value="claude-3-haiku" title="Fastest, most compact model for near-instant responsiveness">
                      Fast
                    </MenuItem>
                    <MenuItem value="nova-lite" title="Multimodal understanding model for text, images, and videos">
                      Multimodal
                    </MenuItem>
                    <MenuItem value="gpt-oss-120b" title="Complex reasoning, extended thinking, sophisticated analysis">
                      Deep
                    </MenuItem>
                    <MenuItem value="gpt-oss-20b" title="Intelligent reasoning, complex problem-solving, efficient">
                      Smart
                    </MenuItem>
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
                          <>
                            <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
                              {message.text}
                            </Typography>
                            
                            {/* Display agent file returns */}
                            {message.sender === 'bot' && (() => {
                              // First check for direct file_data from WebSocket
                              if (message.file_data && Array.isArray(message.file_data)) {
                                return (
                                  <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                                      📁 Files returned by AI:
                                    </Typography>
                                    {message.file_data.map((file: any, index: number) => (
                                      <AgentFileAttachment
                                        key={index}
                                        filename={file.filename}
                                        fileType={file.file_type}
                                        fileSize={file.file_size}
                                        downloadUrl={file.download_url}
                                        createdBy={file.created_by}
                                      />
                                    ))}
                                  </Box>
                                );
                              }
                              
                              return null;
                            })()}
                          </>
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
            {(getCurrentSessionLoading() || (currentSession?.session_id && crossInterfaceLoading[currentSession.session_id])) && (
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
                        const newFiles = currentSession.session_variables?.uploaded_files?.filter((_: any, i: number) => i !== index) || [];
                        
                        // Update the session using the hook function
                        updateSessionFiles(currentSession.session_id, newFiles);
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
