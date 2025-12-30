import React, { useState, useCallback, useEffect, useRef, memo, useMemo } from 'react';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import {
  Box,
  Typography,
  IconButton,
  TextField,
    CircularProgress,
    Chip,
    FormControl,
  Select,
  MenuItem,
  SelectChangeEvent,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Drawer,
  Menu,
  ListItemIcon,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  AttachFile as AttachFileIcon,
  InsertDriveFile as FileIcon,
  Download as DownloadIcon,
  Person as PersonIcon,
  SmartToy as SmartToyIcon,
  Dashboard as ContextIcon,
  Share as ShareIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';
import ChatImportExportDialog from '../dialogs/ChatImportExportDialog';
import { useGlobalChat } from '../../contexts/GlobalChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDualScreenMode } from '../../contexts/DualScreenModeContext';
// COMMENTED OUT: Old WebSocket context (replaced by messaging service)
// import { useWebSocket } from '../../contexts/WebSocketContext';
import { ContextItem } from '../tiles/common/contextManager';
import ContextItemRow from '../context/ContextItemRow';
import { sessionManagementAPI } from '../../services/api';
// COMMENTED OUT: useMessagingService (replaced with unified architecture)
// import { useMessagingService } from '../../hooks/useMessagingService';
// NEW: Import unified messaging system
import { useUnifiedMessaging } from '../../hooks/useUnifiedMessaging';
import { unifiedMessageHandler } from '../../services/unifiedMessageHandler';
// NEW: Import shared file upload service
import { FileUploadService, UploadedFile } from '../../services/fileUploadService';
// Import useChatPersistence for session variable updates
import { useChatPersistence } from '../../hooks/useChatPersistence';
import { usePersistentModel } from '../../hooks/usePersistentModel';

// Typing animation component (same as ChatPage)
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

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  files?: Array<{
    name: string;
    size: number;
    type: string;
  }>;
}

// UploadedFile interface now imported from shared FileUploadService

interface ChatSession {
  session_id: string;
  title: string;
  model: string;
  created_at: number;
  last_updated: number;
  message_count: number;
  messages: Message[];
  session_variables?: {
    context_items?: any[];
    context_added_at?: string;
    [key: string]: any;
  };
}

// Hoisted input bar to preserve local state across parent re-renders
// Memoized edit input component to prevent re-renders on every keystroke
const MessageEditInput = memo(({ 
  value, 
  onChange, 
  onSave, 
  onCancel 
}: { 
  value: string; 
  onChange: (value: string) => void; 
  onSave: () => void; 
  onCancel: () => void;
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSave();
      }
    }
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <TextField
        fullWidth
        multiline
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        variant="outlined"
        sx={{
          '& .MuiOutlinedInput-root': {
            color: 'white',
            fontSize: '0.875rem',
            paddingRight: '60px',
            '& fieldset': {
              borderColor: 'rgba(59, 130, 246, 0.3)',
            },
            '&:hover fieldset': {
              borderColor: 'rgba(59, 130, 246, 0.5)',
            },
            '&.Mui-focused fieldset': {
              borderColor: 'rgba(59, 130, 246, 0.7)',
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
        }}
      >
        <Tooltip title="Cancel (Esc)">
          <IconButton
            size="small"
            onClick={onCancel}
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
            onClick={onSave}
            disabled={!value.trim()}
            sx={{
              color: value.trim() ? '#22c55e' : '#6b7280',
              '&:hover': { 
                color: value.trim() ? '#16a34a' : '#6b7280',
                backgroundColor: value.trim() ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
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
  );
});

const SidebarMessageInputBar = memo(({ disabled, placeholder, onSend }: { disabled: boolean; placeholder: string; onSend: (text: string) => Promise<void> | void }) => {
  const [value, setValue] = useState('');
  const onSendClick = async () => {
    if (!value.trim()) return;
    const text = value;
    setValue('');
    await onSend(text);
  };
  const onKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSendClick();
    }
  };
  return (
    <>
      <TextField
        fullWidth
        multiline
        maxRows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyPress={onKeyPress}
        placeholder={placeholder}
        disabled={disabled}
        sx={{
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'rgba(31, 41, 55, 0.8)',
            border: '1px solid #374151',
            borderRadius: 2,
            '&:hover': {
              borderColor: '#6b7280',
            },
            '&.Mui-focused': {
              borderColor: '#3b82f6',
            },
          },
          '& .MuiOutlinedInput-input': {
            color: '#ffffff',
            fontSize: '0.875rem',
            '&::placeholder': {
              color: '#9ca3af',
              opacity: 1,
            },
          },
          // Scrollbar styling to match main scroll area (for multiline textarea)
          '& textarea': {
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
          },
        }}
      />
      <IconButton
        onClick={() => void onSendClick()}
        disabled={disabled}
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
    </>
  );
});

const GlobalChatSidebar: React.FC = () => {
  const { isVisible, setIsVisible, activeSessionId, setActiveSessionId, close } = useGlobalChat();
  const { user } = useAuth();
  const { isDualScreenMode, sidebarWidth: dualScreenSidebarWidth, setSidebarWidth: setDualScreenSidebarWidth } = useDualScreenMode();
  
  // Get updateSessionVariables and addPersistedMessage from useChatPersistence
  const { 
    updateSessionAgentFiles, 
    updateSessionVariables,
    addMessage: addPersistedMessage,
    truncateMessagesAfter
  } = useChatPersistence(user?.id || '');
  // COMMENTED OUT: Old WebSocket context (replaced by messaging service)
  // const { connect: connectWebSocket, sendMessage, isConnected } = useWebSocket();
  
  // Local state for the mirror (using unified system for messages)
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessionContext, setSessionContext] = useState<ContextItem[]>([]);
  const previousContextRef = useRef<ContextItem[]>([]);
  
  // Update previous context when session changes (but not on every sessionContext change)
  // This effect should ONLY run when activeSessionId changes, not when sessionContext.length changes
  useEffect(() => {
    if (activeSessionId) {
      // When a new session is loaded, initialize the refs to match the current context
      // This prevents showing indicator for items that were already in the session
      previousContextRef.current = [...sessionContext];
      previousContextLengthRef.current = sessionContext.length;
      console.log('🔄 Session loaded - initialized context refs:', { 
        contextLength: sessionContext.length,
        refLength: previousContextLengthRef.current 
      });
    } else {
      // When session is cleared, reset the refs
      previousContextRef.current = [];
      previousContextLengthRef.current = 0;
      console.log('🔄 Session cleared - reset context refs');
    }
  }, [activeSessionId]); // Only depend on activeSessionId, NOT sessionContext.length
  
  // Track context changes for animation indicator
  // Works even when sidebar is open but no session is loaded
  // Only shows indicator when items are ADDED, not removed
  // This effect MUST run after the session initialization effect
  useEffect(() => {
    const currentLength = sessionContext.length;
    const previousLength = previousContextLengthRef.current;
    
    console.log('🔍 Context tracking effect:', { currentLength, previousLength, activeSessionId });
    
    // Only trigger if length INCREASED (items were added)
    // This includes the first item (0 -> 1)
    if (currentLength > previousLength) {
      console.log('✅ Context length increased - showing indicator');
      // Context items added - show indicator (works with or without active session)
      setShowContextIndicator(true);
      previousContextLengthRef.current = currentLength;
      // Hide indicator after animation completes (3 seconds for 3 flashes)
      const timer = setTimeout(() => {
        setShowContextIndicator(false);
      }, 3000);
      return () => clearTimeout(timer);
    } else if (currentLength < previousLength) {
      // Items were removed - update ref but don't show indicator
      console.log('📉 Context length decreased - updating ref only');
      previousContextLengthRef.current = currentLength;
    } else if (currentLength === 0 && previousLength > 0) {
      // Reset when context is cleared
      console.log('🔄 Context cleared - resetting ref');
      previousContextLengthRef.current = 0;
    } else {
      console.log('➡️ Context length unchanged or initialized');
    }
  }, [sessionContext.length, activeSessionId]);
  
  const { selectedModel, setSelectedModel } = usePersistentModel();
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [currentAgentLog, setCurrentAgentLog] = useState<string | null>(null);
  // Session-specific loading states (matching ChatPage pattern)
  // Note: Currently only used for timeout management, but kept for consistency with ChatPage
  const [, setSessionLoadingStates] = useState<Record<string, boolean>>({});
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Removed inline collapses; using side panels instead
  const [isFilesPanelOpen, setIsFilesPanelOpen] = useState(false);
  const [typingMessages, setTypingMessages] = useState<Set<string>>(new Set());
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
  const [shareMenuAnchor, setShareMenuAnchor] = useState<null | HTMLElement>(null);
  const [importExportDialogOpen, setImportExportDialogOpen] = useState(false);
  const [importExportMode, setImportExportMode] = useState<'import' | 'export'>('export');
  const handleSidebarRemoveContextItem = useCallback(async (index: number) => {
    const newContext = sessionContext.filter((_, i) => i !== index);
    setSessionContext(newContext);
    if (activeSessionId) {
      const syncEvent = new CustomEvent('session-context-updated', {
        detail: { sessionId: activeSessionId, contextItems: newContext }
      });
      window.dispatchEvent(syncEvent);
    }
    if (activeSessionId && user?.id) {
      try {
        await sessionManagementAPI.updateSession(activeSessionId, user.id, {
          session_variables: {
            context_items: newContext,
            context_added_at: Date.now(),
          }
        });
        console.log('✅ Updated context in backend (sidebar)');
      } catch (error) {
        console.error('❌ Failed to update context in backend (sidebar):', error);
      }
    }
  }, [sessionContext, activeSessionId, user?.id]);
  
  // File upload state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Animation state for context and files indicators
  const [showContextIndicator, setShowContextIndicator] = useState(false);
  const [showFilesIndicator, setShowFilesIndicator] = useState(false);
  const previousContextLengthRef = useRef<number>(0);
  const previousFilesLengthRef = useRef<number>(0);
  
  // Track files changes for animation indicator (must be after uploadedFiles declaration)
  // Only shows indicator when files are ADDED, not removed
  useEffect(() => {
    const currentLength = uploadedFiles.length;
    const previousLength = previousFilesLengthRef.current;
    
    if (activeSessionId && currentLength > previousLength) {
      // Files added - show indicator
      setShowFilesIndicator(true);
      previousFilesLengthRef.current = currentLength;
      // Hide indicator after animation completes (3 seconds for 3 flashes)
      const timer = setTimeout(() => {
        setShowFilesIndicator(false);
      }, 3000);
      return () => clearTimeout(timer);
    } else if (activeSessionId && currentLength < previousLength) {
      // Files were removed - update ref but don't show indicator
      previousFilesLengthRef.current = currentLength;
    } else if (!activeSessionId) {
      // Reset when session is cleared
      previousFilesLengthRef.current = 0;
    }
  }, [uploadedFiles.length, activeSessionId]);
  // COMMENTED OUT: Old WebSocket ref (replaced by messaging service)
  // const sidebarWebSocketRef = useRef<WebSocket | null>(null);
  
  // Message editing state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(56);
  const [visibleCount, setVisibleCount] = useState<number>(50);
  const userNearBottomRef = useRef<boolean>(true);
  const editContainerRef = useRef<HTMLDivElement>(null);
  // Note: Message deduplication is now handled by unified messaging system
  // Use dual screen mode width if enabled, otherwise use local state
  const [localSidebarWidth, setLocalSidebarWidth] = useState(400);
  const sidebarWidth = isDualScreenMode ? dualScreenSidebarWidth : localSidebarWidth;
  
  // Create a stable setter function that always uses the correct setter based on mode
  const setSidebarWidth = useCallback((width: number) => {
    if (isDualScreenMode) {
      setDualScreenSidebarWidth(width);
    } else {
      setLocalSidebarWidth(width);
    }
  }, [isDualScreenMode, setDualScreenSidebarWidth]);
  
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const previewWidthRef = useRef<number>(400); // Store preview width in ref to avoid state updates during drag

  // COMMENTED OUT: Old messaging service handler (replaced by unified handler)
  /*
  const handleMessagingServiceMessage = useCallback((data: WebSocketMessage) => {
    switch (data.type) {
      case 'ai_response':
        const messageId = data.message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Check for duplicate
        if (processedMessageIdsRef.current.has(messageId)) {
          console.log('🤖 Duplicate AI response ignored (MessagingService):', messageId);
          return;
        }
        
        console.log('🤖 Sidebar MessagingService: Processing AI response for session:', data.session_id);
        
        // Mark as processed
        processedMessageIdsRef.current.add(messageId);
        
        // Clear loading state
        setIsLoadingMessage(false);
        
        // Add AI response with full text for typing animation
        const aiMessage = {
          id: messageId,
          sender: 'ai' as const,
          text: data.content || 'No response content',
          timestamp: Date.now(),
        };
        
        setMessages(prev => [...prev, aiMessage]);
        
        // Also add to shared cache
        addToSharedCache({
          id: messageId,
          sender: 'ai',
          text: data.content || 'No response content',
          timestamp: Date.now(),
          sessionId: data.session_id || activeSessionId || '',
        });
        
        // Add to typing messages for streaming effect
        setTypingMessages(prev => new Set([...prev, messageId]));
        
        console.log('✅ Sidebar MessagingService: Added AI response');
        break;
        
      case 'message_received':
        console.log('✅ Sidebar MessagingService: Message received confirmation:', data.message_id);
        break;
        
      case 'edit_acknowledged':
        console.log('✏️ Sidebar MessagingService: Edit acknowledged:', data.message_id);
        
        if (data.unchanged) {
          console.log('⚠️ Edit acknowledged but message unchanged - no AI response expected');
          setIsLoadingMessage(false);
        } else {
          console.log('✅ Edit acknowledged - waiting for AI response');
        }
        break;
        
      case 'user_message_with_files':
        console.log('📁 Sidebar MessagingService: User message with files received:', data.message_id);
        // Handle file message updates if needed
        break;
        
      case 'session_updated':
        console.log('📁 Sidebar MessagingService: Session updated:', data.session_variables);
        // Handle session updates if needed
        break;
        
      case 'ai_response':
        console.log('🤖 Sidebar MessagingService: AI response received:', data.message_id);
        
        // Check if we've already processed this message
        const aiResponseMessageId = data.message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (processedMessageIdsRef.current.has(aiResponseMessageId)) {
          console.log('🤖 Duplicate AI response ignored:', aiResponseMessageId);
          break;
        }
        
        // Mark as processed
        processedMessageIdsRef.current.add(aiResponseMessageId);
        
        // Clear loading state
        setIsLoadingMessage(false);
        
        // Add AI response to sidebar messages
        const aiResponseMessage: Message = {
          id: aiResponseMessageId,
          text: data.content || 'No response content',
          sender: 'ai',
          timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        };
        
        setMessages(prev => [...prev, aiResponseMessage]);
        
        // Add AI response to shared cache for bidirectional sync
        addToSharedCache({
          id: aiResponseMessage.id,
          sender: aiResponseMessage.sender,
          text: aiResponseMessage.text,
          timestamp: aiResponseMessage.timestamp,
          sessionId: data.session_id || activeSessionId || '',
        });
        console.log('📨 Sidebar: Added AI response to shared cache:', aiResponseMessage.id);
        
        // Dispatch AI response event to ChatPage
        const aiResponseEvent = new CustomEvent('sidebar-ai-response', {
          detail: {
            messageId: aiResponseMessageId,
            content: data.content || 'No response content',
            sessionId: data.session_id,
            userId: user?.id,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(aiResponseEvent);
        console.log('📡 Dispatched AI response to ChatPage:', {
          messageId: aiResponseMessageId,
          sessionId: data.session_id,
          userId: user?.id,
          contentLength: (data.content || '').length
        });
        break;
        
      case 'connection_established':
        console.log('🔗 Sidebar MessagingService: Connection established for session:', data.session_id);
        // COMMENTED OUT: Connection status update (not needed with unified architecture)
        // setIsMessagingServiceConnected(true);
        // console.log('✅ Sidebar: Connection status updated to true');
        break;
        
      default:
        console.log('📨 Sidebar MessagingService: Unknown message type:', data.type);
    }
  }, []);
  */

  // COMMENTED OUT: Unified handler moved after shared message cache hook

  // COMMENTED OUT: No longer using MessagingService directly (replaced with ChatPage mirroring)
  // const handleMessagingServiceSessionUpdate = useCallback((update: SessionUpdate) => {
  //   console.log('📁 Sidebar MessagingService: Session update received:', update);
  //   // Handle session updates if needed
  // }, []);

  // const handleMessagingServiceBroadcast = useCallback((message: BroadcastMessage) => {
  //   console.log('📡 Sidebar MessagingService: Broadcast received:', message.type, 'from:', message.source);
  //   
  //   // Only process broadcasts from ChatPage for the current session
  //   if (message.source === 'chatpage' && message.sessionId === activeSessionId) {
  //     switch (message.type) {
  //       case 'ai_response':
  //         // Handle AI response from ChatPage
  //         console.log('🤖 Sidebar MessagingService: Processing AI response from ChatPage');
  //         break;
  //       case 'session_update':
  //         // Handle session update from ChatPage
  //         console.log('📁 Sidebar MessagingService: Processing session update from ChatPage');
  //         break;
  //     }
  //   }
  // }, [activeSessionId]);

  // COMMENTED OUT: useMessagingService hook (replaced with direct MessagingService calls)
  // const messagingService = useMessagingService({
  //   sessionId: activeSessionId || undefined,
  //   userId: user?.id,
  //   onMessage: handleMessagingServiceMessage,
  //   onSessionUpdate: handleMessagingServiceSessionUpdate,
  //   onBroadcast: handleMessagingServiceBroadcast
  // });

  // COMMENTED OUT: Connection monitoring (not needed with unified architecture)
  // const [isMessagingServiceConnected, setIsMessagingServiceConnected] = useState(false);
  // 
  // // Monitor messaging service connection status
  // useEffect(() => {
  //   if (!activeSessionId) {
  //     setIsMessagingServiceConnected(false);
  //     return;
  //   }
  // 
  //   // Check connection status periodically
  //   const checkConnection = () => {
  //     const isConnected = MessagingService.hasConnection(activeSessionId);
  //     setIsMessagingServiceConnected(isConnected);
  //   };
  // 
  //   // Check immediately
  //   checkConnection();
  // 
  //   // Check more frequently initially, then less frequently
  //   const interval = setInterval(checkConnection, 500);
  // 
  //   return () => clearInterval(interval);
  // }, [activeSessionId]);

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
    sessionId: activeSessionId,
    userId: user?.id,
    source: 'sidebar',
    onMessageUpdate: (update) => {
      console.log('📨 Sidebar: Received unified message update:', update.type);
    }
  });

  // Use messages from unified messaging system (real-time) as primary source
  // Fall back to persistence system for initial load or when unified messages aren't available
  // Merge both sources to ensure we show all messages (matching ChatPage pattern)
  // Memoize persistenceMessages to prevent infinite loops
  const persistenceMessages = useMemo(() => {
    return currentSession?.messages || [];
  }, [currentSession?.messages, currentSession?.session_id]);
  
  // Create a merged list, prioritizing unified messages (real-time) but including persistence messages
  // Use a Map to deduplicate by message ID, with unified messages taking precedence
  // Memoize unifiedMessageList to prevent unnecessary recalculations
  const unifiedMessageList = useMemo(() => {
    return unifiedMessages || [];
  }, [unifiedMessages]);
  
  const messages = useMemo(() => {
    if (!activeSessionId) {
      return unifiedMessageList;
    }
    
    const messageMap = new Map<string, any>();
    
    // First add persistence messages (for initial load)
    // Note: persistence messages use 'bot' for AI, but we convert to 'ai' for consistency
    persistenceMessages.forEach((msg: any) => {
      const sender = (msg.sender === 'bot' || msg.sender === 'ai') ? 'ai' : 'user';
      let timestamp: number;
      const msgTimestamp = msg.timestamp;
      if (msgTimestamp && typeof msgTimestamp === 'object' && msgTimestamp instanceof Date) {
        timestamp = msgTimestamp.getTime();
      } else if (typeof msgTimestamp === 'number') {
        timestamp = msgTimestamp;
      } else {
        timestamp = Date.now();
      }
      
      messageMap.set(msg.id, {
        id: msg.id,
        sender: sender as 'user' | 'ai',
        text: msg.text,
        timestamp: timestamp,
        sessionId: activeSessionId,
        source: 'database' as const,
        files: msg.files
      });
    });
    
    // Then add/override with unified messages (real-time updates) for this session
    const filteredUnified = unifiedMessageList.filter(msg => msg.sessionId === activeSessionId);
    filteredUnified.forEach(msg => {
      messageMap.set(msg.id, msg);
    });
    
    // Convert to sorted array
    const merged = Array.from(messageMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    
    return merged;
  }, [unifiedMessageList, activeSessionId, persistenceMessages]);

  // Subscribe to agent log updates
  useEffect(() => {
    if (!activeSessionId) {
      setCurrentAgentLog(null);
      return;
    }

    // Get initial agent log if available
    const initialLog = unifiedMessageHandler.getCurrentAgentLog(activeSessionId);
    setCurrentAgentLog(initialLog);

    // Subscribe to updates
    const unsubscribe = unifiedMessageHandler.onAgentLogUpdate((sessionId, logMessage) => {
      if (sessionId === activeSessionId) {
        setCurrentAgentLog(logMessage);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeSessionId]);

  // Sync unified messages with local persistence system (DEBOUNCED for performance)
  // This runs asynchronously to avoid blocking message display (matching ChatPage pattern)
  // Use ref to track last synced message IDs to prevent infinite loops
  const lastSyncedMessageIdsRef = useRef<Set<string>>(new Set());
  const lastSyncedSessionIdRef = useRef<string>('');
  
  useEffect(() => {
    if (!activeSessionId || !currentSession || unifiedMessages.length === 0) return;

    // Only sync if currentSession matches activeSessionId (prevents syncing to wrong session)
    if (currentSession.session_id !== activeSessionId) {
      return;
    }

    // Reset tracking if session changed
    if (lastSyncedSessionIdRef.current !== activeSessionId) {
      lastSyncedMessageIdsRef.current = new Set();
      lastSyncedSessionIdRef.current = activeSessionId;
    }

    // Debounce persistence sync to avoid blocking UI updates
    // Messages are displayed immediately from unified cache, persistence happens in background
    const syncTimeout = setTimeout(() => {
      // Only sync messages that belong to the active session
      const filteredSessionMessages = unifiedMessages.filter(msg => msg.sessionId === activeSessionId);
      
      if (filteredSessionMessages.length === 0) {
        return;
      }

      // Get messages that exist in unified cache but not in local persistence
      const localMessageIds = new Set(currentSession.messages.map(m => m.id));
      const newMessages = filteredSessionMessages.filter(unifiedMsg => 
        !localMessageIds.has(unifiedMsg.id) && !lastSyncedMessageIdsRef.current.has(unifiedMsg.id)
      );

      // Only add truly new messages to prevent duplication
      if (newMessages.length > 0) {
        // Adding new messages to persistence
        // Batch persistence operations asynchronously using requestIdleCallback or setTimeout fallback
        const schedulePersistence = (callback: () => void) => {
          if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            (window as any).requestIdleCallback(callback, { timeout: 1000 });
          } else {
            setTimeout(callback, 0);
          }
        };
        
        schedulePersistence(() => {
          newMessages.forEach(unifiedMsg => {
            // Only add if session matches (prevents adding to wrong session)
            if (currentSession.session_id === activeSessionId) {
              addPersistedMessage({
                id: unifiedMsg.id,
                text: unifiedMsg.text,
                sender: unifiedMsg.sender === 'ai' ? 'bot' : unifiedMsg.sender,
                timestamp: new Date(unifiedMsg.timestamp),
                files: unifiedMsg.files
              }, activeSessionId);
              // Track that we've synced this message
              lastSyncedMessageIdsRef.current.add(unifiedMsg.id);
            }
          });
        });
      }
    }, 100); // 100ms debounce - messages display immediately, persistence happens shortly after

    return () => clearTimeout(syncTimeout);
  }, [unifiedMessages, activeSessionId, currentSession?.session_id, currentSession?.messages?.length, addPersistedMessage]);

  // Subscribe to loading state updates from unified messaging system (matching ChatPage pattern)
  useEffect(() => {
    const unsubscribe = unifiedMessageHandler.subscribeToLoadingState((sessionId, isLoading, source) => {
      // Update for sidebar source OR cross-interface loading (for universal edit updates)
      // Also update for active session to ensure universal visibility of edits
      const isActiveSession = sessionId === activeSessionId;
      if (source === 'sidebar' || (source === 'chatpage' && isLoading) || (isActiveSession && isLoading)) {
        setSessionLoadingStates(prev => ({
          ...prev,
          [sessionId]: isLoading
        }));
        // Also update local loading state for active session
        if (isActiveSession) {
          setIsLoadingMessage(isLoading);
        }
      } else if (isActiveSession && !isLoading) {
        // Always clear loading state for active session when it's cleared (for universal edit updates)
        setSessionLoadingStates(prev => ({
          ...prev,
          [sessionId]: false
        }));
        setIsLoadingMessage(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeSessionId]);


  // Only auto-scroll when user is near bottom AND new message appended (length or last id changed)
  const prevMessagesMetaRef = useRef<{ length: number; lastId?: string }>({ length: 0, lastId: undefined });
  useEffect(() => {
    const currLength = messages?.length || 0;
    const lastId = currLength > 0 ? messages[currLength - 1].id : undefined;
    const { length: prevLength, lastId: prevLastId } = prevMessagesMetaRef.current;
    const appended = currLength > prevLength || (lastId && lastId !== prevLastId);
    if (appended && userNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
    prevMessagesMetaRef.current = { length: currLength, lastId };
  }, [messages]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const nearTop = el.scrollTop <= 50;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 50;
    userNearBottomRef.current = nearBottom;
    if (nearTop) {
      setVisibleCount((prev) => Math.min((messages?.length || 0), prev + 50));
    }
  }, [messages?.length]);

  // Listen for AI response typing events from unified messaging system
  useEffect(() => {
    const handleAITyping = (event: CustomEvent) => {
      const { sessionId, messageId } = event.detail;
      
      // Only handle typing for active session
      if (sessionId === activeSessionId) {
        console.log('🤖 Sidebar: Received AI typing event for message:', messageId);
        setTypingMessages(prev => new Set([...prev, messageId]));
        
        // Clear the timeout since AI is responding
        // NOTE: Loading state is cleared by unifiedMessageHandler when first chunk arrives
        // Don't clear it here to avoid race conditions and ensure it stays until chunk actually arrives
        if (activeSessionId && loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
          console.log('🔄 Sidebar: Cleared timeout for session:', activeSessionId);
        }
      }
    };

    window.addEventListener('ai-response-typing', handleAITyping as EventListener);
    
    return () => {
      window.removeEventListener('ai-response-typing', handleAITyping as EventListener);
    };
  }, [activeSessionId]);

  // Listen for file-message-sent events to reset timeout (matching ChatPage pattern)
  useEffect(() => {
    if (!activeSessionId) return;

    const handleFileMessageSent = (event: CustomEvent) => {
      const { sessionId } = event.detail;
      if (sessionId === activeSessionId) {
        console.log('🔄 Sidebar: Received file-message-sent event, resetting timeout for session:', sessionId);
        // Clear existing timeout
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
        // Re-set the timeout to effectively restart it from now
        // This ensures the 5-minute timeout only counts from when AI processing actually starts
        setLoadingTimeout(sessionId);
      }
    };

    const setLoadingTimeout = (sessionId: string) => {
      // Clear any existing timeout
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      
      // Set new 5-minute timeout
      loadingTimeoutRef.current = setTimeout(() => {
        console.log(`⏰ Sidebar: 5-minute timeout reached for session ${sessionId}`);
        
        // Clear loading state
        setSessionLoadingStates(prev => ({
          ...prev,
          [sessionId]: false
        }));
        
        setIsLoadingMessage(false);
        
        // Add helpful timeout message to guide user
        if (sessionId) {
          addPersistedMessage({
            id: `timeout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            text: "⏰ **Processing Extended**: Your request is taking longer than usual to process. The AI is still working on your request and may take up to 15 minutes to complete. Please refresh the page periodically to check for updates, or start a new conversation if you would like to talk about something else.",
            sender: 'bot',
            timestamp: new Date()
          }, sessionId);
        }
        
        loadingTimeoutRef.current = null;
      }, 300000); // 5 minutes (300,000 ms)
    };

    window.addEventListener('file-message-sent', handleFileMessageSent as any);
    
    return () => {
      window.removeEventListener('file-message-sent', handleFileMessageSent as any);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [activeSessionId, addPersistedMessage]);

  // Listen for session variable updates (including file uploads)
  useEffect(() => {
    const handleSessionVariablesUpdate = (event: CustomEvent) => {
      const { sessionId, sessionVariables } = event.detail;
      console.log('📁 Sidebar: Received session variables update:', { sessionId, fileCount: sessionVariables?.uploaded_files?.length || 0 });
      
      if (sessionId === activeSessionId) {
        // Update session variables in persistence system
        updateSessionVariables(sessionId, sessionVariables);
        console.log('✅ Sidebar: Updated session variables in real-time');
      }
    };

    window.addEventListener('session-variables-updated', handleSessionVariablesUpdate as any);
    
    return () => {
      window.removeEventListener('session-variables-updated', handleSessionVariablesUpdate as any);
    };
  }, [activeSessionId]);

  // COMMENTED OUT: Unified message handler (replaced with simple ChatPage mirroring)
  // const handleUnifiedMessage = useCallback((messageData: any, source: 'websocket' | 'chatpage' | 'context') => {
  //   // ... complex unified handler logic removed for simplicity
  // }, [activeSessionId, user?.id, addToSharedCache]);

  // Available models with nicknames and tooltips
  const availableModels = [
    { value: 'claude-sonnet-4', label: 'Balanced', tooltip: 'Strikes ideal balance between intelligence and speed' },
    { value: 'claude-haiku-4-5', label: 'Fast', tooltip: 'Fastest, most compact model for near-instant responsiveness' },
    { value: 'nova-lite', label: 'Multimodal', tooltip: 'Multimodal understanding model for text, images, and videos' },
    { value: 'gpt-oss-120b', label: 'Deep', tooltip: 'Complex reasoning, extended thinking, sophisticated analysis' },
    { value: 'gpt-oss-20b', label: 'Smart', tooltip: 'Intelligent reasoning, complex problem-solving, efficient' },
  ];

  // Removed unconditional smooth scroll; handled by guarded effect above

  // Debug uploaded files changes
  useEffect(() => {
    console.log(`📁 Sidebar: uploadedFiles state changed:`, uploadedFiles.length, 'files');
    if (uploadedFiles.length > 0) {
      console.log(`📁 Sidebar: Files in state:`, uploadedFiles.map(f => f.name));
    }
  }, [uploadedFiles]);

  // COMMENTED OUT: Old typewriter effect (replaced by TypingText component)
  // const typewriterEffect = (messageId: string, fullText: string, speed: number = 2) => {
  //   // Implementation removed - now using TypingText component
  // };

  // DUPLICATE REMOVED: Handler functions are defined above

  // Edit message handlers
  const handleEditMessage = (message: Message, messageIndex: number) => {
    // Check if AI is currently processing
    if (isLoadingMessage) {
      console.log('🛑 Sidebar cancelling ongoing AI processing for edit');
      
      // Immediately clear the loading state to stop "AI is thinking" indicator
      setIsLoadingMessage(false);
      
      // Notify ChatPage and other listeners
      const cancelEvent = new CustomEvent('cancel-ai-processing', {
        detail: {
          sessionId: activeSessionId,
          reason: 'user_edit',
          source: 'sidebar',
          timestamp: Date.now()
        }
      });
      window.dispatchEvent(cancelEvent);
      console.log('📡 Sidebar dispatched cancel-ai-processing event');
    }
    
    setEditingMessage(message);
    setEditingMessageIndex(messageIndex);
    setEditText(message.text);
  };

  // Ref to prevent duplicate edit sends
  const isSavingEditRef = useRef(false);
  
  const handleSaveEdit = async () => {
    if (!editingMessage || editingMessageIndex === null || !editText.trim() || !activeSessionId || isSavingEditRef.current) return;
    
    // Prevent double-clicks by setting ref immediately
    isSavingEditRef.current = true;
    
    // Store the editing message ID before clearing state
    const editingMessageId = editingMessage.id;
    const editingMessageText = editText;
    
    let result;
    try {
      console.log('✏️ Sidebar: Sending edit message via unified system');
      
      // Send edit message via unified system (same as ChatPage)
      result = await sendUnifiedEditMessage(editText, editingMessage.id, selectedModel);
      
      if (result.success) {
        console.log('✅ Sidebar: Edit message sent successfully');

        // Immediately update the local UI to show the edited message and remove subsequent messages
        // This matches ChatPage behavior and ensures real-time truncation
        truncateMessagesAfter(editingMessageId, editingMessageText);
        
        // CRITICAL: Update sidebar's local currentSession to match truncation
        // The sidebar has its own currentSession state that needs to be synced
        if (currentSession && currentSession.session_id === activeSessionId) {
          const messageIndex = currentSession.messages.findIndex(msg => msg.id === editingMessageId);
          if (messageIndex >= 0) {
            const truncatedMessages = currentSession.messages.slice(0, messageIndex + 1);
            truncatedMessages[messageIndex] = {
              ...truncatedMessages[messageIndex],
              text: editingMessageText
            };
            setCurrentSession({
              ...currentSession,
              messages: truncatedMessages,
              message_count: truncatedMessages.length,
              last_updated: Date.now()
            });
            console.log('✏️ Sidebar: Updated local currentSession with truncation:', truncatedMessages.length, 'messages');
          }
        }
        
        // CRITICAL: Force unified handler notification to ensure UI updates immediately
        // The unified handler's applyLocalEditAndTruncate should have already truncated the cache
        // but we force a notification to ensure the sidebar's merged messages update
        if (activeSessionId) {
          const latestMessages = unifiedMessageHandler.getMessagesForSession(activeSessionId);
          unifiedMessageHandler.notifyMessageUpdate(activeSessionId, latestMessages);
          console.log('✏️ Sidebar: Forced message refresh after truncation:', latestMessages.length, 'messages');
        }
        
        // Clear editing state AFTER truncation to allow immediate re-editing
        setEditingMessage(null);
        setEditingMessageIndex(null);
        setEditText('');
        
        // Loading state will be managed by the unified handler
      } else {
        console.error('❌ Sidebar: Failed to send edit message:', result.error);
        // Don't clear editing state on error so user can retry
      }
    } catch (error) {
      console.error('❌ Sidebar: Error sending edit message:', error);
      // Don't clear editing state on error so user can retry
    } finally {
      // Always reset the ref to allow subsequent edits
      isSavingEditRef.current = false;
    }
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setEditingMessageIndex(null);
    setEditText('');
  };

  // File upload handlers (same as ChatPage)
  // File compression and validation now handled by shared FileUploadService

  const handleFileUpload = async (files: FileList) => {
    console.log(`📁 Sidebar: User selected ${files.length} file(s) for upload`);
    setIsProcessingFiles(true);
    
    try {
      // Use shared file upload service
      const processedFiles = await FileUploadService.processFiles(files);
      
      // Add processed files to state
      setUploadedFiles(prev => {
        const newFiles = [...prev, ...processedFiles];
        console.log(`✅ Sidebar: Added ${processedFiles.length} files to upload queue (${newFiles.length} total files)`);
        return newFiles;
      });
    } catch (error) {
      console.error('❌ Sidebar: Failed to process files:', error);
    } finally {
      setIsProcessingFiles(false);
    }
  };

  // Load session from database
  const loadSessionFromDatabase = async (sessionId: string) => {
    if (!user?.id) return;

    try {
      console.log('📋 Loading session from database:', sessionId);
      const session = await sessionManagementAPI.getSession(sessionId, user.id);
      
      if (session) {
        console.log('✅ Session loaded from database successfully:', {
          sessionId: session.session_id,
          messageCount: session.messages?.length || 0,
          hasContext: !!session.session_variables?.context_items
        });
        
        // Update session data
        setCurrentSession(session);
        // Don't reset model - keep user's persistent selection

        // Load existing messages into unified messaging system only if not already loaded
        // For new sessions, messages might already be in cache from the message send
        // so we merge instead of overwriting
        const existingMessages = unifiedMessageHandler.getMessagesForSession(sessionId);
        if (session.messages && session.messages.length > 0) {
          console.log('📨 Sidebar: Loading existing messages into unified system:', session.messages.length);
          if (existingMessages.length === 0) {
            unifiedMessageHandler.loadExistingMessages(sessionId, session.messages);
          } else {
            console.log('📨 Sidebar: Messages already in unified system, merging with database messages');
            // Merge database messages with cache to ensure nothing is lost
            unifiedMessageHandler.loadExistingMessages(sessionId, session.messages);
          }
        } else if (existingMessages.length > 0) {
          // No messages in database yet, but we have cached messages (new session)
          // Ensure they're preserved by triggering an update
          console.log('📨 Sidebar: No database messages yet, but have cached messages, preserving them');
          unifiedMessageHandler.notifyMessageUpdate(sessionId, existingMessages);
        }

        // Load context if available
        if (session.session_variables?.context_items) {
          setSessionContext(session.session_variables.context_items);
        } else {
          setSessionContext([]);
        }
        
        // Don't reconnect WebSocket here - it should already be connected
        // Reconnecting will close the existing connection and miss AI responses
        console.log('✅ Session data loaded into sidebar');
      } else {
        console.log('⚠️ Session not found in database');
      }
    } catch (error: any) {
      console.error('❌ Failed to load session:', error);
      
      if (error?.response?.status === 404) {
        console.log('🔄 Session not found (404) - might be newly created');
      }
    }
  };

  // Mirror ChatPage's current session
  useEffect(() => {
    if (!isVisible) return;

    // Removed automatic session change mirroring - only manual "Open in Sidebar" should change the sidebar

    // COMMENTED OUT: Old event handlers (replaced with session-specific mirroring in useEffect)
    // const handleChatPageMessage = (event: CustomEvent) => {
    //   const messageData = event.detail;
    //   console.log('📨 GlobalChatSidebar mirroring ChatPage message:', messageData);
    //   
    //   // Use unified handler for ChatPage messages
    //   handleUnifiedMessage(messageData, 'chatpage');
    // };

    // const handleChatPageEdit = (event: CustomEvent) => {
    //   const editData = event.detail;
    //   console.log('✏️ GlobalChatSidebar mirroring ChatPage edit:', editData);
    //   
    //   // Use unified handler for ChatPage edits
    //   handleUnifiedMessage({ ...editData, type: 'edit' }, 'chatpage');
    // };

    // const handleChatPageAIResponse = (event: CustomEvent) => {
    //   const responseData = event.detail;
    //   console.log('🤖 GlobalChatSidebar mirroring AI response:', responseData);
    //   
    //   // Use unified handler for ChatPage AI responses
    //   handleUnifiedMessage({ ...responseData, sender: 'ai' }, 'chatpage');
    // };
    
    // Handle AI processing cancellation from ChatPage
    const handleCancelAIProcessing = (event: CustomEvent) => {
      const { sessionId, source } = event.detail;
      
      // Only process if it's NOT from sidebar (to avoid self-triggering) and matches active session
      if (source !== 'sidebar' && sessionId === activeSessionId) {
        console.log('🛑 Sidebar received cancel from ChatPage, clearing loading state');
        setIsLoadingMessage(false);
      }
    };

    // COMMENTED OUT: Old event listeners (replaced with session-specific mirroring in useEffect)
    // window.addEventListener('chatpage-message', handleChatPageMessage as EventListener);
    // window.addEventListener('chatpage-edit-message', handleChatPageEdit as EventListener);
    // window.addEventListener('chatpage-ai-response', handleChatPageAIResponse as EventListener);
    window.addEventListener('cancel-ai-processing', handleCancelAIProcessing as EventListener);
    
    return () => {
      // window.removeEventListener('chatpage-message', handleChatPageMessage as EventListener);
      // window.removeEventListener('chatpage-edit-message', handleChatPageEdit as EventListener);
      // window.removeEventListener('chatpage-ai-response', handleChatPageAIResponse as EventListener);
      window.removeEventListener('cancel-ai-processing', handleCancelAIProcessing as EventListener);
    };
  }, [isVisible, activeSessionId, user?.id]);

  // Handle manual session opening from ChatPage
  useEffect(() => {
    if (!isVisible) return;

    const handleManualSessionOpen = async (event: CustomEvent) => {
      const sessionData = event.detail;
      console.log('📂 GlobalChatSidebar opening session:', sessionData);
      
      if (sessionData.sessionId && sessionData.userId === user?.id) {
        setActiveSessionId(sessionData.sessionId);
        // Load the session data from database
        await loadSessionFromDatabase(sessionData.sessionId);
        
        // The useMessagingService hook will automatically connect when activeSessionId changes
        console.log('🔌 Sidebar: Session opened, useMessagingService hook will handle connection');
      }
    };

    window.addEventListener('manual-session-open', handleManualSessionOpen as any);
    
    return () => {
      window.removeEventListener('manual-session-open', handleManualSessionOpen as any);
    };
  }, [isVisible, user?.id, setActiveSessionId]);

  // Handle session variables updates (e.g., new files uploaded)
  useEffect(() => {
    if (!isVisible) return;

    const handleSessionVariablesUpdate = (event: CustomEvent) => {
      const { sessionId, sessionVariables } = event.detail;
      console.log('📁 GlobalChatSidebar: Session variables updated:', sessionId, sessionVariables);
      console.log('📁 Sidebar: Uploaded files count:', sessionVariables?.uploaded_files?.length || 0);
      
      if (sessionId === activeSessionId) {
        // Update current session with new session variables
        setCurrentSession(prev => prev ? {
          ...prev,
          session_variables: sessionVariables
        } : null);
        
        console.log('✅ Updated sidebar session variables in real-time');
        console.log('📁 Sidebar: Files section should now show', sessionVariables?.uploaded_files?.length || 0, 'files');
      }
    };

    window.addEventListener('session-variables-updated', handleSessionVariablesUpdate as EventListener);
    
    return () => {
      window.removeEventListener('session-variables-updated', handleSessionVariablesUpdate as EventListener);
    };
  }, [isVisible, activeSessionId]);

  // Handle context sessions from global handler
  useEffect(() => {
    const handleContextSessionReady = async (event: CustomEvent) => {
      const contextData = event.detail;
      console.log('🎯 GlobalChatSidebar: Context session ready:', contextData);
      
      if (!user?.id) {
        console.log('⚠️ GlobalChatSidebar: No user, skipping context session');
        return;
      }
      
      if (contextData.userId === user.id) {
        console.log('🎯 GlobalChatSidebar: Processing context session:', contextData.sessionId);
        
        // Clear any existing session - this is a new context session
        if (activeSessionId && activeSessionId !== contextData.sessionId) {
          console.log('🎯 GlobalChatSidebar: Clearing old session:', activeSessionId);
          setCurrentSession(null);
          setSessionContext([]);
        }
        
        // Open the sidebar
        setIsVisible(true);
        
        // Update the active session ID (context will persist to sessionStorage)
        console.log('🎯 Setting activeSessionId to:', contextData.sessionId);
        setActiveSessionId(contextData.sessionId);
        // Also update sessionStorage immediately to ensure it's set before WebSocket reads it
        sessionStorage.setItem('global-chat-active-session', contextData.sessionId);
        
        // Also update the GlobalChatContext's session state immediately
        setCurrentSession({
          session_id: contextData.sessionId,
          title: new Date().toLocaleString(),
          model: selectedModel, // Use persistent model selection
          created_at: Date.now(),
          last_updated: Date.now(),
          message_count: 0,
          messages: []
        });
        
        // Set context items
        setSessionContext(contextData.contextItems || []);
        
        // Note: User message will be added by unified messaging system
        
        // Show loading state
        setIsLoadingMessage(true);
        
        // Send the contextualized message via unified messaging system
        console.log('📤 Sidebar: Sending context message via unified messaging system...');
        
        try {
          // Send context message with context items
          const result = await sendUnifiedContextMessage(
            contextData.userMessage,
            contextData.contextItems || [],
            selectedModel,
            contextData.sessionId
          );
          
          if (result.success) {
            console.log('✅ Sidebar: Context message sent successfully via unified system');
          } else {
            console.error('❌ Sidebar: Failed to send context message:', result.error);
            setIsLoadingMessage(false);
          }
        } catch (error) {
          console.error('❌ Sidebar: Error sending context message via unified system:', error);
          setIsLoadingMessage(false);
        }
      }
    };

    window.addEventListener('context-session-ready', handleContextSessionReady as any);
    
    return () => {
      window.removeEventListener('context-session-ready', handleContextSessionReady as any);
    };
  }, [user?.id, activeSessionId, setIsVisible, setActiveSessionId]);

  // Listen for items being added to sidebar context
  useEffect(() => {
    const handleAddToSidebarContext = async (event: CustomEvent) => {
      const contextItem = event.detail;
      console.log('📌 Adding item to sidebar context:', contextItem);
      
      // Add to context even if there's no active session
      // Session will be created when user sends first message
      // Update previous context ref to mark that context has changed
      // This ensures the next message will send context data
      previousContextRef.current = sessionContext; // Keep the old context for change detection
      
      const newContext = [...sessionContext, contextItem];
      setSessionContext(newContext);
      // Context updated
      console.log('🎯 Sidebar: Context change detection scenario completed - context data is ready for next message');
      // Context items added
      
      console.log('✅ Added to sidebar context', activeSessionId ? '(with active session)' : '(no session yet - will create on first message)');
      console.log('📌 Context item data:', JSON.stringify(contextItem, null, 2));
      
      // Dispatch success event for feedback
      const successEvent = new CustomEvent('sidebar-context-success', {
        detail: { contextItem }
      });
      window.dispatchEvent(successEvent);
      
      // Only persist to backend if there's an active session
      // If no session, it will be persisted when session is created on first message
      if (activeSessionId && user?.id) {
        try {
          await sessionManagementAPI.updateSession(activeSessionId, user.id, {
            session_variables: {
              context_items: newContext,
              context_added_at: Date.now(),
            }
          });
          console.log('✅ Persisted context to backend');
          
          // Notify ChatPage of context change AFTER a small delay
          // This ensures the tracking effect has time to detect the addition and show the indicator
          setTimeout(() => {
            const syncEvent = new CustomEvent('session-context-updated', {
              detail: { sessionId: activeSessionId, contextItems: newContext }
            });
            window.dispatchEvent(syncEvent);
          }, 100);
        } catch (error) {
          console.error('❌ Failed to persist context to backend:', error);
        }
      } else {
        console.log('ℹ️ Context stored locally - will be persisted when session is created');
      }
    };

    const handleAddMultipleToSidebarContext = async (event: CustomEvent) => {
      const contextItems = event.detail;
      console.log(`📌 Adding ${contextItems.length} items to sidebar context:`, contextItems);
      
      // Add all items to context even if there's no active session
      // Session will be created when user sends first message
      const newContext = [...sessionContext, ...contextItems];
      setSessionContext(newContext);
      console.log(`✅ Added ${contextItems.length} items to sidebar context`, activeSessionId ? '(with active session)' : '(no session yet - will create on first message)');
      
      // Dispatch success event for feedback
      const successEvent = new CustomEvent('sidebar-context-success', {
        detail: { contextItems }
      });
      window.dispatchEvent(successEvent);
      
      // Only persist to backend if there's an active session
      // If no session, it will be persisted when session is created on first message
      if (activeSessionId && user?.id) {
        try {
          await sessionManagementAPI.updateSession(activeSessionId, user.id, {
            session_variables: {
              context_items: newContext,
              context_added_at: Date.now(),
            }
          });
          console.log('✅ Persisted context to backend');
          
          // Notify ChatPage of context change AFTER a small delay
          // This ensures the tracking effect has time to detect the addition and show the indicator
          setTimeout(() => {
            const syncEvent = new CustomEvent('session-context-updated', {
              detail: { sessionId: activeSessionId, contextItems: newContext }
            });
            window.dispatchEvent(syncEvent);
          }, 100);
        } catch (error) {
          console.error('❌ Failed to persist context to backend:', error);
        }
      } else {
        console.log('ℹ️ Context stored locally - will be persisted when session is created');
      }
    };

    window.addEventListener('add-to-sidebar-context', handleAddToSidebarContext as any);
    window.addEventListener('add-multiple-to-sidebar-context', handleAddMultipleToSidebarContext as any);
    
    return () => {
      window.removeEventListener('add-to-sidebar-context', handleAddToSidebarContext as any);
      window.removeEventListener('add-multiple-to-sidebar-context', handleAddMultipleToSidebarContext as any);
    };
  }, [activeSessionId, sessionContext, user?.id, isVisible, setIsVisible]);

  // Listen for context updates from ChatPage
  useEffect(() => {
    const handleContextSync = (event: CustomEvent) => {
      const { sessionId, contextItems } = event.detail;
      console.log('🔄 Sidebar: Received context sync from ChatPage:', { sessionId, itemCount: contextItems.length });
      
      if (sessionId === activeSessionId) {
        const currentLength = sessionContext.length;
        const syncLength = contextItems.length;
        
        // Only update the ref if the lengths are the same (we're just syncing, not adding)
        // If sync length is different, let the tracking effect handle it
        if (currentLength === syncLength) {
          // Update the length ref to match the synced context
          // This prevents the tracking effect from thinking items were added when we're just syncing
          previousContextLengthRef.current = syncLength;
        }
        
        setSessionContext(contextItems);
        console.log('✅ Sidebar: Synced context from ChatPage');
      }
    };

    window.addEventListener('session-context-updated', handleContextSync as any);
    
    return () => {
      window.removeEventListener('session-context-updated', handleContextSync as any);
    };
  }, [activeSessionId, sessionContext.length]);

  // Handle session variables updates (e.g., new files uploaded)
  useEffect(() => {
    if (!isVisible) return;

    const handleSessionVariablesUpdate = (event: CustomEvent) => {
      const { sessionId, sessionVariables } = event.detail;
      console.log('📁 GlobalChatSidebar: Session variables updated:', sessionId, sessionVariables);
      console.log('📁 Sidebar: Uploaded files count:', sessionVariables?.uploaded_files?.length || 0);
      
      if (sessionId === activeSessionId) {
        // Update current session with new session variables
        setCurrentSession(prev => prev ? {
          ...prev,
          session_variables: sessionVariables
        } : null);
        
        console.log('✅ Updated sidebar session variables in real-time');
        console.log('📁 Sidebar: Files section should now show', sessionVariables?.uploaded_files?.length || 0, 'files');
      }
    };

    window.addEventListener('session-variables-updated', handleSessionVariablesUpdate as EventListener);
    
    return () => {
      window.removeEventListener('session-variables-updated', handleSessionVariablesUpdate as EventListener);
    };
  }, [isVisible, activeSessionId]);

  // REMOVED: Old WebSocket event listeners - now handled by unified messaging system

  // COMMENTED OUT: Old file handler function (replaced by messaging service)
  /*
  // Send message with files to File Handler (same as ChatPage)
  const sendMessageWithFilesToFileHandler = async (message: any, files: any[], sessionId: string, userId: string, enrichedContext?: any[]) => {
    try {
      const filesData = files.map(file => ({
        filename: file.name,
        content_type: file.type,
        data: file.compressedData // Already base64 encoded from compression
      }));

      const response = await fetch(`${process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production'}/files`, {
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
          context_items: enrichedContext || sessionContext // Use enriched context if provided
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('📁 Sidebar: Message with files sent to File Handler:', result);
      return result;
    } catch (error) {
      console.error('❌ Sidebar: Error sending message with files to File Handler:', error);
      throw error;
    }
  };
  */

  // COMMENTED OUT: Old WebSocket message handler (replaced by messaging service)
  /*
  // Handle WebSocket messages from sidebar's own WebSocket connection
  const handleSidebarWebSocketMessage = (data: any) => {
    console.log('📨 Sidebar WebSocket message:', data.type);

    switch (data.type) {
      case 'ai_response':
        const messageId = data.message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Get the latest activeSessionId from sessionStorage to avoid stale closures
        const latestActiveSessionId = sessionStorage.getItem('global-chat-active-session');
        
        // Only process if it's for the active session
        if (!data.session_id || data.session_id === latestActiveSessionId || !latestActiveSessionId) {
          // Check for duplicate
          if (processedMessageIdsRef.current.has(messageId)) {
            console.log('🤖 Duplicate AI response ignored (Sidebar WebSocket):', messageId);
            break;
          }
          
          console.log('🤖 Sidebar processing AI response from own WebSocket for session:', data.session_id);
          
          // Mark as processed
          processedMessageIdsRef.current.add(messageId);
          
          // Add AI response to sidebar messages
          const aiMessage: Message = {
            id: messageId,
            sender: 'ai',
            text: data.content || 'I apologize, but I encountered an error processing your request.',
            timestamp: Date.now(),
          };
          
          setMessages(prev => [...prev, aiMessage]);
          setIsLoadingMessage(false);
          setStreamingMessageId(null);
          
          console.log('✅ Sidebar added AI response from own WebSocket');
        } else {
          console.log('🤖 Sidebar ignoring AI response for different session:', data.session_id);
        }
        break;
        
      case 'message_received':
        console.log('📨 Sidebar received message confirmation:', data.message_id);
        break;
        
      case 'session_updated':
        console.log('📁 Sidebar received session update from own WebSocket');
        // Handle session updates if needed
        break;
        
      default:
        console.log('📨 Sidebar received unknown WebSocket message type:', data.type);
    }
  };
  */

  // COMMENTED OUT: Old WebSocket-based message sending
  /*
  const handleSendMessage = useCallback(async () => {
    // ... old implementation commented out for rollback safety
  }, [inputMessage, activeSessionId, user?.id, selectedModel, setActiveSessionId, uploadedFiles, sessionContext]);
  */

  // NOTE: Unused MessageInputBar component removed - using SidebarMessageInputBar instead defined at the top

  // Cleanup effect for message cancellation
  useEffect(() => {
    return () => {
      // Cancel all pending messages when sidebar unmounts
    if (activeSessionId) {
        console.log('🧹 Sidebar: Cleaning up - cancelling all pending messages for session:', activeSessionId);
        unifiedMessageHandler.cancelAllMessagesForSession(activeSessionId);
      }
    };
  }, [activeSessionId]);

  // Resize handlers - optimized for smooth preview movement
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    // Initialize preview width ref to current sidebar width
    previewWidthRef.current = sidebarWidth;
    // Show preview bar immediately
    if (previewRef.current) {
      previewRef.current.style.display = 'block';
      previewRef.current.style.right = `${sidebarWidth}px`;
    }
  }, [sidebarWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Use requestAnimationFrame for smooth updates
    rafIdRef.current = requestAnimationFrame(() => {
      const windowWidth = window.innerWidth;
      const newWidth = windowWidth - e.clientX;
      
      // Calculate percentage limits - different for dual screen mode
      const minWidth = isDualScreenMode ? 300 : windowWidth * 0.1; // 300px min in dual screen, 10% otherwise
      const maxWidth = isDualScreenMode ? windowWidth * 0.7 : windowWidth * 0.75; // 70% max in dual screen, 75% otherwise
      
      // Clamp the width within limits
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      // Store preview width in ref (no state update = no re-render)
      previewWidthRef.current = clampedWidth;
      
      // Update preview bar position directly via DOM for smooth movement
      // This completely avoids React re-renders during dragging
      if (previewRef.current) {
        previewRef.current.style.right = `${clampedWidth}px`;
      }
    });
  }, [isResizing, isDualScreenMode]);

  const handleMouseUp = useCallback(() => {
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Apply preview width to actual sidebar width when mouse is released
    // This triggers the actual resize and any necessary recalculations
    const finalWidth = previewWidthRef.current;
    setSidebarWidth(finalWidth);
    
    // Hide preview bar
    if (previewRef.current) {
      previewRef.current.style.display = 'none';
    }
    
    setIsResizing(false);
  }, [setSidebarWidth]);

  // Add global mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      // Cancel any pending animation frames on cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleModelChange = (event: SelectChangeEvent) => {
    setSelectedModel(event.target.value);
  };

  // Measure header height to anchor in-panel menus just below it
  useEffect(() => {
    const measure = () => {
      if (headerRef.current) {
        setHeaderHeight(headerRef.current.offsetHeight);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // In dual screen mode, ensure chat is visible
  useEffect(() => {
    if (isDualScreenMode && !isVisible) {
      setIsVisible(true);
    }
  }, [isDualScreenMode, isVisible, setIsVisible]);

  // In dual screen mode, always render the sidebar (it's part of the layout)
  // In normal mode, only render when visible
  if (!isDualScreenMode && !isVisible) {
    return null;
  }

  return (
    <>
    {/* Preview indicator - shows where the resize will be */}
    {/* Always rendered but hidden by default, updated via direct DOM manipulation for smooth movement */}
    <Box
      ref={previewRef}
      sx={{
        position: 'fixed',
        right: sidebarWidth,
        top: 64,
        bottom: 0,
        width: '2px',
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        zIndex: 1202,
        pointerEvents: 'none',
        boxShadow: '0 0 8px rgba(59, 130, 246, 0.6)',
        display: 'none', // Hidden by default, shown during resize via direct DOM manipulation
        transition: 'none', // No transitions during drag for instant updates
      }}
    />
    <Box
      ref={sidebarRef}
      sx={{
        position: 'fixed',
        right: isDualScreenMode ? 0 : 0,
        top: 64,
        bottom: 0,
        width: sidebarWidth,
        backgroundColor: 'rgba(15, 23, 42, 0.98)',
        borderLeft: '2px solid #374151',
        backdropFilter: 'blur(10px)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.3)',
        animation: isDualScreenMode ? 'none' : 'slideInFromRight 0.3s ease-out',
        '@keyframes slideInFromRight': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        // In dual screen mode, ensure sidebar is always visible when chat is open
        transform: isDualScreenMode && isVisible ? 'translateX(0)' : undefined,
      }}
    >
      {/* Resize Handle - always visible in dual screen mode */}
      {(isDualScreenMode || isVisible) && (
        <Box
          onMouseDown={handleMouseDown}
          sx={{
            position: 'absolute',
            left: -4,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'col-resize',
            zIndex: 1201,
            '&:hover': {
              backgroundColor: 'rgba(59, 130, 246, 0.3)',
            },
            '&:active': {
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
            },
          }}
        />
      )}
      {/* Header */}
      <Box
        ref={headerRef}
        sx={{
          p: 2,
          borderBottom: '1px solid #374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '1rem' }}>
            AI Chat
          </Typography>
          {currentSession && (
            <Chip
              label={currentSession.title}
              size="small"
              sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#60a5fa',
                fontSize: '0.75rem',
                height: '20px',
              }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {/* Share Menu Button */}
          <Tooltip title="Share Chat Session">
            <IconButton
              size="small"
              onClick={(e) => setShareMenuAnchor(e.currentTarget)}
              disabled={!activeSessionId}
              sx={{
                color: '#9ca3af',
                '&:hover': {
                  color: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
                '&:disabled': {
                  color: '#475569',
                },
              }}
            >
              <ShareIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* Open Files side panel */}
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <IconButton
              size="small"
              onClick={() => {
                setIsFilesPanelOpen((v) => !v);
                // ensure other panel closes if desired
                if (!isFilesPanelOpen) setIsContextPanelOpen(false);
              }}
              title={isFilesPanelOpen ? 'Hide Files' : 'Show Files'}
              sx={{
                color: '#3b82f6',
                '&:hover': {
                  color: '#60a5fa',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
              }}
            >
              <FileIcon fontSize="small" />
            </IconButton>
            {/* Flashing dot indicator for files */}
            {showFilesIndicator && (
              <Box
                sx={{
                  position: 'absolute',
                  bottom: -4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: '#3b82f6',
                  animation: 'flash 1s ease-in-out 3',
                  '@keyframes flash': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.3 },
                  },
                }}
              />
            )}
          </Box>
          {/* Open Context side panel */}
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <IconButton
              size="small"
              onClick={() => {
                setIsContextPanelOpen((v) => !v);
                if (!isContextPanelOpen) setIsFilesPanelOpen(false);
              }}
              title={isContextPanelOpen ? 'Hide Context' : 'Show Context'}
              sx={{
                color: '#10b981',
                '&:hover': {
                  color: '#34d399',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                },
              }}
            >
              <ContextIcon fontSize="small" />
            </IconButton>
            {/* Flashing dot indicator for context */}
            {showContextIndicator && (
              <Box
                sx={{
                  position: 'absolute',
                  bottom: -4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                  animation: 'flash 1s ease-in-out 3',
                  '@keyframes flash': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.3 },
                  },
                }}
              />
            )}
          </Box>
          {activeSessionId && (
            <IconButton
              size="small"
              onClick={() => activeSessionId && loadSessionFromDatabase(activeSessionId)}
              title="Refresh Session"
              sx={{
                color: '#9ca3af',
                '&:hover': {
                  color: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
              }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          )}
          
          <IconButton
            size="small"
            onClick={() => {
              // Clear unified message handler cache for the current session before clearing
              if (activeSessionId) {
                unifiedMessageHandler.clearSessionMessages(activeSessionId);
              }
              setActiveSessionId(null);
              setCurrentSession(null);
              setSessionContext([]);
              // Input state is local to MessageInputBar; nothing to clear here
              setIsLoadingMessage(false);
              console.log('🗑️ Chat cleared');
            }}
            title="Clear Chat"
            sx={{
              color: '#9ca3af',
              '&:hover': {
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
              },
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
          
          <IconButton
            size="small"
            onClick={close}
            title="Close"
            sx={{
              color: '#9ca3af',
              '&:hover': {
                color: '#ffffff',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Context Items (moved below messages to match ChatPage layout) */}

      {/* Files Section moved below messages to match ChatPage layout */}

      {/* Messages - fixed height container that won't resize when menus expand */}
      <Box ref={messagesContainerRef} onScroll={handleMessagesScroll}
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          minHeight: 0, // Important: allows flex child to shrink below content size
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
        {(() => {
          const messagesToRender = messages.slice(Math.max(0, messages.length - visibleCount));
          return messagesToRender;
        })().map((message, messageIndex) => (
          <Box
            key={message.id}
            sx={{
              alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
            }}
          >
            <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                backgroundColor: message.sender === 'user' 
                  ? 'rgba(59, 130, 246, 0.2)' 
                  : 'rgba(255, 255, 255, 0.1)',
                border: message.sender === 'user' 
                  ? '1px solid rgba(59, 130, 246, 0.3)' 
                  : '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              {editingMessage && editingMessage.id === message.id ? (
                <Box ref={editContainerRef}>
                  <MessageEditInput
                    value={editText}
                    onChange={setEditText}
                    onSave={handleSaveEdit}
                    onCancel={handleCancelEdit}
                  />
                </Box>
              ) : (
                <>
                  {message.sender === 'ai' && typingMessages.has(message.id) ? (
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
                    <MarkdownRenderer 
                      content={message.text}
                      variant="body2"
                      sx={{
                        color: '#ffffff',
                        fontSize: '0.875rem',
                        lineHeight: 1.4,
                        wordBreak: 'break-word',
                      }}
                    />
                  )}
                  {/* File attachments */}
                  {(message as any).files && (message as any).files.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {(message as any).files.map((file: any, fileIndex: number) => (
                        <Box
                          key={fileIndex}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            p: 1,
                            backgroundColor: 'rgba(55, 65, 81, 0.5)',
                            borderRadius: '4px',
                            border: '1px solid #374151',
                          }}
                        >
                          <FileIcon sx={{ color: '#22c55e', flexShrink: 0 }} />
                          <Typography 
                            variant="body2" 
                            color="white"
                            sx={{
                              wordBreak: 'break-word',
                              overflowWrap: 'break-word',
                              flex: 1,
                              minWidth: 0, // Allows flex item to shrink below content size
                            }}
                          >
                            {file.name}
                          </Typography>
                          <Typography 
                            variant="caption" 
                            color="#9ca3af"
                            sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                          >
                            ({(file.size / 1024).toFixed(1)} KB)
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </>
              )}
            </Box>
            
            {/* Message metadata and edit button */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, px: 0.5 }}>
              <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.65rem' }}>
                {new Date(message.timestamp).toLocaleTimeString()}
              </Typography>
              {message.sender === 'user' && !editingMessage && (
                <Tooltip title="Edit message">
                  <IconButton
                    size="small"
                    onClick={() => handleEditMessage(message, messageIndex)}
                    sx={{ 
                      color: '#9ca3af',
                      '&:hover': { color: '#3b82f6' },
                      width: 20,
                      height: 20,
                    }}
                  >
                    <EditIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        ))}
        
        {(isLoadingMessage || (activeSessionId && crossInterfaceLoading[activeSessionId])) && (
          <Box
            sx={{
              alignSelf: 'flex-start',
              p: 1.5,
              borderRadius: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <CircularProgress size={16} sx={{ color: '#60a5fa' }} />
            <Typography variant="body2" sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>
              {currentAgentLog || 'AI is thinking...'}
            </Typography>
          </Box>
        )}
        
        <div ref={messagesEndRef} />
      </Box>

      {/* Files/Context inline sections removed in favor of side panels */}

      {/* Input Area */}
      <Box
        sx={{
          flexShrink: 0,
          p: 2,
          borderTop: '1px solid #374151',
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
        }}
      >
        {/* Show file processing indicator */}
        {isProcessingFiles && (
          <Box sx={{ mb: 1, p: 1, backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: 1, border: '1px solid rgba(59, 130, 246, 0.3)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} sx={{ color: '#3b82f6' }} />
              <Typography variant="caption" sx={{ color: '#3b82f6', fontWeight: 600 }}>
                Processing files...
              </Typography>
            </Box>
          </Box>
        )}

        {/* Show uploaded files - positioned above model selector */}
        {uploadedFiles.length > 0 && (
          <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {uploadedFiles.map((file, index) => (
              <Box 
                key={index} 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 0.5,
                  px: 1,
                  py: 0.5,
                  backgroundColor: 'rgba(55, 65, 81, 0.5)',
                  borderRadius: '12px',
                  border: '1px solid #374151',
                }}
              >
                <FileIcon sx={{ color: '#22c55e', fontSize: '0.875rem' }} />
                <Typography variant="caption" color="white" sx={{ fontSize: '0.75rem' }}>
                  {file.name}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== index))}
                  sx={{ 
                    color: '#9ca3af', 
                    '&:hover': { color: '#ef4444' }, 
                    p: 0.25,
                    minWidth: 'auto',
                    width: '16px',
                    height: '16px'
                  }}
                >
                  <CloseIcon sx={{ fontSize: '0.75rem' }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        {/* Model Selection */}
        <FormControl fullWidth size="small" sx={{ mb: 1 }}>
          <Select
            value={selectedModel || 'claude-sonnet-4'}
            onChange={handleModelChange}
            sx={{
              color: '#ffffff',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#374151',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#6b7280',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: '#3b82f6',
              },
              '& .MuiSvgIcon-root': {
                color: '#9ca3af',
              },
            }}
          >
            {availableModels.map((model) => (
              <MenuItem key={model.value} value={model.value} title={model.tooltip}>
                <Typography sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                  {model.label}
                </Typography>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Input Area - Compact with Paperclip */}
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
          <SidebarMessageInputBar
            disabled={isLoadingMessage}
            placeholder="Type your message..."
            onSend={async (text: string) => {
              // Use the same logic as the inline input bar previously
              if ((!text.trim() && uploadedFiles.length === 0) || !user?.id || isUnifiedProcessing) return;
              setIsLoadingMessage(true);
              if (activeSessionId) {
                unifiedMessageHandler.broadcastLoadingState(activeSessionId, true, 'sidebar');
              }
              try {
                let result;
                if (uploadedFiles.length > 0) {
                  result = await sendUnifiedFileMessage(text, uploadedFiles as unknown as File[], selectedModel);
                } else if (sessionContext.length > 0) {
                  // If we have context items, always send as context message
                  // This will create a session if one doesn't exist
                  result = await sendUnifiedContextMessage(text, sessionContext, selectedModel, activeSessionId || undefined);
                  previousContextRef.current = [...sessionContext];
                } else if (activeSessionId) {
                  result = await sendUnifiedFollowupMessage(text, selectedModel);
                } else {
                  result = await sendUnifiedMessage({ text, model: selectedModel, type: 'new_message' });
                }
                
                if (result.success) {
                  // Message sent successfully - it should already be in unifiedMessages via subscription
                  // Force a refresh of messages to ensure immediate display
                  if (activeSessionId || result.sessionId) {
                    const sessionIdToUse = result.sessionId || activeSessionId;
                    if (sessionIdToUse) {
                      // const currentMessages = unifiedMessageHandler.getMessagesForSession(sessionIdToUse);
                    // The subscription should handle this, but we can force a refresh if needed
                    }
                  }
                  
                  // Update session ID if a new session was created (matching ChatPage pattern)
                  if (result.sessionId && result.sessionId !== activeSessionId) {
                    console.log('🔄 Sidebar: New session created, loading session:', result.sessionId);
                    
                    // Clear loading state for the old session ID and set it for the new one
                    if (activeSessionId) {
                      setSessionLoadingStates(prev => ({
                        ...prev,
                        [activeSessionId]: false
                      }));
                    }
                    
                    // Set loading state for the new session
                    setSessionLoadingStates(prev => ({
                      ...prev,
                      [result.sessionId]: true
                    }));
                    
                    // Broadcast loading state for the new session
                    unifiedMessageHandler.broadcastLoadingState(result.sessionId, true, 'sidebar');
                    
                    // If we have context items, persist them to the new session
                    if (sessionContext.length > 0 && user?.id) {
                      try {
                        await sessionManagementAPI.updateSession(result.sessionId, user.id, {
                          session_variables: {
                            context_items: sessionContext,
                            context_added_at: Date.now(),
                          }
                        });
                        console.log('✅ Persisted context items to new session');
                      } catch (error) {
                        console.error('❌ Failed to persist context to new session:', error);
                      }
                    }
                    
                    // CRITICAL: Get cached messages BEFORE updating sessionId to preserve them
                    const cachedMessagesBeforeUpdate = unifiedMessageHandler.getMessagesForSession(result.sessionId);
                    console.log(`📨 Sidebar: Found ${cachedMessagesBeforeUpdate.length} cached messages before session update`);
                    
                    // CRITICAL: Update activeSessionId FIRST to ensure subscription is set up
                    // before we try to display messages
                    setActiveSessionId(result.sessionId);
                    
                    // CRITICAL: Immediately notify subscribers with cached messages to ensure they display
                    // This must happen before waiting for React to process state updates
                    if (cachedMessagesBeforeUpdate.length > 0) {
                      unifiedMessageHandler.notifyMessageUpdate(result.sessionId, cachedMessagesBeforeUpdate);
                      console.log(`🔄 Sidebar: Immediately notified subscribers with ${cachedMessagesBeforeUpdate.length} cached messages`);
                    }
                    
                    // CRITICAL: Wait for React to process the state update and for useUnifiedMessaging
                    // to set up the subscription and load messages from cache
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Notify ChatPage that a new session was created (matching ChatPage pattern)
                    // This ensures ChatPage can update its session list
                    const newSessionEvent = new CustomEvent('new-session-created', {
                      detail: {
                        sessionId: result.sessionId,
                        userId: user?.id,
                        source: 'sidebar'
                      }
                    });
                    window.dispatchEvent(newSessionEvent);
                    
                    // Get cached messages again after subscription is set up
                    const cachedMessagesAfterWait = unifiedMessageHandler.getMessagesForSession(result.sessionId);
                    
                    // Load session - this will merge any cached messages with backend messages
                    // For new sessions, the message is already in unifiedMessageHandler cache
                    // and will be preserved when the session loads via the merge logic in loadExistingMessages
                    await loadSessionFromDatabase(result.sessionId);
                    
                    // After session loads, get messages again and ensure they're displayed
                    // The loadSessionFromDatabase should have preserved cached messages, but
                    // we'll force an update to be absolutely sure
                    const cachedMessagesAfterLoad = unifiedMessageHandler.getMessagesForSession(result.sessionId);
                    const messagesToDisplay = cachedMessagesAfterLoad.length > 0 
                      ? cachedMessagesAfterLoad 
                      : (cachedMessagesAfterWait.length > 0 ? cachedMessagesAfterWait : cachedMessagesBeforeUpdate);
                    
                    if (messagesToDisplay.length > 0) {
                      // Force a notification to ensure all subscribers get the update
                      unifiedMessageHandler.notifyMessageUpdate(result.sessionId, messagesToDisplay);
                      console.log(`🔄 Sidebar: Final forced message update for new session, ${messagesToDisplay.length} messages`);
                    }
                    
                    // Reset sync tracking for the new session
                    lastSyncedMessageIdsRef.current = new Set();
                    lastSyncedSessionIdRef.current = result.sessionId;
                    
                    setUploadedFiles([]);
                  } else {
                    setUploadedFiles([]);
                  }
                } else {
                  console.error('❌ Sidebar: Failed to send message:', result.error);
                  // Clear loading state on error
                  const errorSessionId = result.sessionId || activeSessionId || 'pending';
                  setIsLoadingMessage(false);
                  setSessionLoadingStates(prev => ({
                    ...prev,
                    [errorSessionId]: false
                  }));
                  if (errorSessionId) {
                    unifiedMessageHandler.broadcastLoadingState(errorSessionId, false, 'sidebar');
                  }
                }
              } catch (e) {
                console.error('❌ Sidebar: Error sending message:', e);
                const errorSessionId = activeSessionId || 'pending';
                setIsLoadingMessage(false);
                setSessionLoadingStates(prev => ({
                  ...prev,
                  [errorSessionId]: false
                }));
                if (errorSessionId) {
                  unifiedMessageHandler.broadcastLoadingState(errorSessionId, false, 'sidebar');
                }
              }
            }}
          />
        </Box>

      </Box>
    </Box>
    {/* Files Side Panel */}
    <Drawer
      anchor="right"
      open={isFilesPanelOpen}
      variant="persistent"
      PaperProps={{
        sx: {
          width: 360,
          top: `${64 + headerHeight}px`,
          height: `calc((100vh - ${64 + headerHeight}px) / 2)`,
          backgroundColor: 'rgba(15, 23, 42, 0.98)',
          borderLeft: '1px solid #374151',
        }
      }}
      ModalProps={{ keepMounted: true }}
      sx={{ zIndex: 1300 }}
    >
      <Box sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #374151' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FileIcon sx={{ color: '#3b82f6', fontSize: '1rem' }} />
          <Typography variant="body2" sx={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600 }}>Files</Typography>
        </Box>
        <IconButton size="small" onClick={() => setIsFilesPanelOpen(false)} sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}>
          <CloseIcon fontSize="small" />
          </IconButton>
      </Box>
      <Box sx={{ p: 1, overflow: 'auto', '&::-webkit-scrollbar': { width: '6px' }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: '3px' }, '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' } }}>
        {/* User Files */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#3b82f6', mb: 1, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem' }}>
            <PersonIcon fontSize="small" />
            User Files ({currentSession?.session_variables?.uploaded_files?.length || 0})
          </Typography>
          {(currentSession?.session_variables?.uploaded_files?.length ?? 0) > 0 ? (
            <List dense sx={{ py: 0 }}>
              {(currentSession?.session_variables?.uploaded_files ?? []).map((file: any, index: number) => (
                <ListItem key={index} sx={{ py: 0.5, px: 1, '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)', '& .remove-file-btn': { opacity: 1 } } }}
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <IconButton size="small" className="remove-file-btn" onClick={async () => {
                        if (!activeSessionId || !user?.id) return;
                        try {
                          const apiUrl = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';
                          const response = await fetch(`${apiUrl}/file-download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, session_id: activeSessionId, filename: file.filename, s3_key: file.s3_key }) });
                          if (!response.ok) throw new Error(`Download request failed: ${response.status}`);
                          const { download_url } = await response.json();
                          const link = document.createElement('a'); link.href = download_url; link.download = file.filename; link.target = '_blank'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
                        } catch (error) { console.error('❌ Download failed:', error); }
                      }} sx={{ opacity: 0, transition: 'opacity 0.2s', color: '#3b82f6', '&:hover': { color: '#60a5fa' } }}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                      <IconButton edge="end" size="small" className="remove-file-btn" onClick={async () => {
                        const newFiles = (currentSession?.session_variables?.uploaded_files ?? []).filter((_: any, i: number) => i !== index);
                        const updatedSession = currentSession ? ({ ...currentSession, session_variables: { ...currentSession.session_variables, uploaded_files: newFiles } } as ChatSession) : null;
                        setCurrentSession(updatedSession);
                        if (activeSessionId && user?.id) {
                          try {
                            await sessionManagementAPI.updateSession(activeSessionId, user.id, { session_variables: { ...(currentSession?.session_variables || {}), uploaded_files: newFiles, files_added_at: Date.now() } });
                          } catch (error) { console.error('❌ Failed to update files in backend:', error); }
                        }
                      }} sx={{ opacity: 0, transition: 'opacity 0.2s', color: '#dc2626', '&:hover': { color: '#ef4444' } }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  }>
                  <ListItemText primary={file.filename} secondary={`${(file.file_size / 1024).toFixed(1)} KB • ${file.content_type}`} primaryTypographyProps={{ fontSize: '0.8rem', color: '#ffffff' }} secondaryTypographyProps={{ fontSize: '0.7rem', color: '#9ca3af' }} />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.75rem', fontStyle: 'italic' }}>No user files uploaded</Typography>
          )}
        </Box>

        {/* Agent Files */}
        <Box sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#22c55e', mb: 1, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem' }}>
            <SmartToyIcon fontSize="small" />
            Agent Files ({currentSession?.session_variables?.agent_files?.length || 0})
          </Typography>
          {(currentSession?.session_variables?.agent_files?.length ?? 0) > 0 ? (
            <List dense sx={{ py: 0 }}>
              {(currentSession?.session_variables?.agent_files ?? []).map((file: any, index: number) => (
                <ListItem key={index} sx={{ py: 0.5, px: 1, backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '4px', mb: 0.5, '&:hover': { backgroundColor: 'rgba(34, 197, 94, 0.15)', '& .remove-file-btn': { opacity: 1 } } }}
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <IconButton size="small" className="remove-file-btn" onClick={async () => {
                        if (!activeSessionId || !user?.id) return;
                        try {
                          const apiUrl = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';
                          const response = await fetch(`${apiUrl}/file-download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, session_id: activeSessionId, filename: file.filename, s3_key: file.s3_key }) });
                          if (!response.ok) throw new Error(`Download request failed: ${response.status}`);
                          const { download_url } = await response.json();
                          const link = document.createElement('a'); link.href = download_url; link.download = file.filename; link.target = '_blank'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
                        } catch (error) { console.error('❌ Agent file download failed:', error); }
                      }} sx={{ opacity: 0, transition: 'opacity 0.2s', color: '#22c55e', '&:hover': { color: '#16a34a' } }}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                      <IconButton edge="end" size="small" className="remove-file-btn" onClick={async () => {
                        const newFiles = (currentSession?.session_variables?.agent_files ?? []).filter((_: any, i: number) => i !== index);
                        if (activeSessionId) updateSessionAgentFiles(activeSessionId, newFiles);
                        if (activeSessionId && user?.id) {
                          try {
                            await sessionManagementAPI.updateSession(activeSessionId, user.id, { session_variables: { ...(currentSession?.session_variables || {}), agent_files: newFiles } });
                          } catch (error) { console.error('❌ Failed to update agent files in backend:', error); }
                        }
                      }} sx={{ opacity: 0, transition: 'opacity 0.2s', color: '#dc2626', '&:hover': { color: '#ef4444' } }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
      </Box>
                  }>
                  <ListItemText primary={file.filename} secondary={`${(file.file_size / 1024).toFixed(1)} KB • ${file.content_type} • Generated`} primaryTypographyProps={{ fontSize: '0.8rem', color: '#ffffff' }} secondaryTypographyProps={{ fontSize: '0.7rem', color: '#9ca3af' }} />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.75rem', fontStyle: 'italic' }}>No agent files generated</Typography>
          )}
    </Box>
      </Box>
    </Drawer>

    {/* Context Side Panel */}
    <Drawer
      anchor="right"
      open={isContextPanelOpen}
      variant="persistent"
      PaperProps={{
        sx: {
          width: 320,
          top: `${64 + headerHeight}px`,
          height: `calc((100vh - ${64 + headerHeight}px) / 2)`,
          backgroundColor: 'rgba(15, 23, 42, 0.98)',
          borderLeft: '1px solid #374151',
        }
      }}
      ModalProps={{ keepMounted: true }}
      sx={{ zIndex: 1300 }}
    >
      <Box sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #374151' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ContextIcon sx={{ color: '#10b981', fontSize: '1rem' }} />
          <Typography variant="body2" sx={{ color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>Context</Typography>
        </Box>
        <IconButton size="small" onClick={() => setIsContextPanelOpen(false)} sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ p: 1, overflow: 'auto', '&::-webkit-scrollbar': { width: '6px' }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: '3px' }, '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' } }}>
        <List dense sx={{ py: 0, px: 1 }}>
          {sessionContext.map((item, index) => (
            <ListItem key={item.id || index} disableGutters sx={{ display: 'block', px: 0 }}>
              <ContextItemRow
                item={item}
                sessionId={activeSessionId}
                userId={user?.id}
                onRemove={() => handleSidebarRemoveContextItem(index)}
              />
            </ListItem>
          ))}
        </List>
      </Box>
    </Drawer>

    {/* Share Menu */}
    <Menu
      anchorEl={shareMenuAnchor}
      open={Boolean(shareMenuAnchor)}
      onClose={() => setShareMenuAnchor(null)}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
      PaperProps={{
        sx: {
          backgroundColor: '#1f2937',
          border: '1px solid #374151',
          minWidth: 200,
          mt: 0.5,
        },
      }}
    >
      <MenuItem
        onClick={() => {
          setShareMenuAnchor(null);
          setImportExportMode('import');
          setImportExportDialogOpen(true);
        }}
        sx={{
          color: '#e5e7eb',
          '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
        }}
      >
        <ListItemIcon>
          <UploadIcon fontSize="small" sx={{ color: '#60a5fa' }} />
        </ListItemIcon>
        <ListItemText>Import Chat</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => {
          setShareMenuAnchor(null);
          setImportExportMode('export');
          setImportExportDialogOpen(true);
        }}
        sx={{
          color: '#e5e7eb',
          '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
        }}
      >
        <ListItemIcon>
          <DownloadIcon fontSize="small" sx={{ color: '#60a5fa' }} />
        </ListItemIcon>
        <ListItemText>Export Chat</ListItemText>
      </MenuItem>
    </Menu>

    {/* Import/Export Dialog */}
    <ChatImportExportDialog
      open={importExportDialogOpen}
      onClose={() => setImportExportDialogOpen(false)}
      mode={importExportMode}
      sessionId={activeSessionId || undefined}
      sessionTitle={currentSession?.title}
      userId={user?.id || ''}
      onImportSuccess={async (newSessionId) => {
        // Dispatch event to refresh session list in ChatPage if it's open
        const refreshEvent = new CustomEvent('refresh-session-list', {
          detail: { sessionId: newSessionId }
        });
        window.dispatchEvent(refreshEvent);
        
        // Set the imported session as active and open sidebar
        setIsVisible(true);
        setActiveSessionId(newSessionId);
        // The session will be loaded automatically by the useEffect that watches activeSessionId
        await loadSessionFromDatabase(newSessionId);
      }}
    />
    </>
  );
};

export default GlobalChatSidebar;