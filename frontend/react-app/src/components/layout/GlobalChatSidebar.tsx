import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  Collapse,
  List,
  ListItem,
  ListItemText,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
  Close as CloseIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  Edit as EditIcon,
  AttachFile as AttachFileIcon,
  InsertDriveFile as FileIcon,
  Download as DownloadIcon,
  Person as PersonIcon,
  SmartToy as SmartToyIcon,
} from '@mui/icons-material';
import { useGlobalChat } from '../../contexts/GlobalChatContext';
import { useAuth } from '../../contexts/AuthContext';
// COMMENTED OUT: Old WebSocket context (replaced by messaging service)
// import { useWebSocket } from '../../contexts/WebSocketContext';
import { ContextItem } from '../tiles/common/contextManager';
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

const GlobalChatSidebar: React.FC = () => {
  const { isVisible, setIsVisible, activeSessionId, setActiveSessionId, close } = useGlobalChat();
  const { user } = useAuth();
  
  // Get updateSessionVariables from useChatPersistence
  const { updateSessionAgentFiles, updateSessionVariables } = useChatPersistence(user?.id || '');
  // COMMENTED OUT: Old WebSocket context (replaced by messaging service)
  // const { connect: connectWebSocket, sendMessage, isConnected } = useWebSocket();
  
  // Local state for the mirror (using unified system for messages)
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessionContext, setSessionContext] = useState<ContextItem[]>([]);
  const previousContextRef = useRef<ContextItem[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  
  // Function to detect if context has changed
  const hasContextChanged = useCallback(() => {
    const currentContext = sessionContext;
    const previousContext = previousContextRef.current;
    
    console.log('🔍 DEBUG: Sidebar hasContextChanged - currentContext:', currentContext);
    console.log('🔍 DEBUG: Sidebar hasContextChanged - previousContext:', previousContext);
    
    // Compare lengths first (quick check)
    if (currentContext.length !== previousContext.length) {
      console.log(`📋 Sidebar: Context length changed: ${previousContext.length} → ${currentContext.length}`);
      return true;
    }
    
    // Compare each item by ID and timestamp
    for (let i = 0; i < currentContext.length; i++) {
      const current = currentContext[i];
      const previous = previousContext[i];
      
      if (!previous || 
          current.id !== previous.id || 
          current.timestamp !== previous.timestamp) {
        console.log(`📋 Sidebar: Context item changed at index ${i}:`, { current, previous });
        return true;
      }
    }
    
    console.log('🔍 DEBUG: Sidebar hasContextChanged - no changes detected, returning false');
    return false;
  }, [sessionContext]);
  
  // Update previous context when session changes (but not on every sessionContext change)
  useEffect(() => {
    if (activeSessionId) {
      // Only update if this is a new session, not a context change
      if (previousContextRef.current.length === 0) {
        previousContextRef.current = [...sessionContext];
        console.log('🔍 DEBUG: Sidebar: Initial previousContextRef.current set for new session:', previousContextRef.current);
      }
    }
  }, [activeSessionId]);
  
  const { selectedModel, setSelectedModel } = usePersistentModel();
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [isFilesExpanded, setIsFilesExpanded] = useState(false);
  const [typingMessages, setTypingMessages] = useState<Set<string>>(new Set());
  
  // File upload state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // COMMENTED OUT: Old WebSocket ref (replaced by messaging service)
  // const sidebarWebSocketRef = useRef<WebSocket | null>(null);
  
  // Message editing state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editContainerRef = useRef<HTMLDivElement>(null);
  // Note: Message deduplication is now handled by unified messaging system
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

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
    sendFollowupMessage: sendUnifiedFollowupMessage
  } = useUnifiedMessaging({
    sessionId: activeSessionId,
    userId: user?.id,
    source: 'sidebar',
    onMessageUpdate: (update) => {
      console.log('📨 Sidebar: Received unified message update:', update.type);
    }
  });

  // Use unified messages directly - no need for local state syncing
  const messages = unifiedMessages.filter(msg => msg.sessionId === activeSessionId);


  // Listen for AI response typing events from unified messaging system
  useEffect(() => {
    const handleAITyping = (event: CustomEvent) => {
      const { sessionId, messageId } = event.detail;
      
      // Only handle typing for active session
      if (sessionId === activeSessionId) {
        console.log('🤖 Sidebar: Received AI typing event for message:', messageId);
        setTypingMessages(prev => new Set([...prev, messageId]));
        
        // Clear loading state when AI starts responding
        setIsLoadingMessage(false);
        // Broadcast loading state clearing to other interfaces
        unifiedMessageHandler.broadcastLoadingState(sessionId, false, 'sidebar');
      }
    };

    window.addEventListener('ai-response-typing', handleAITyping as EventListener);
    
    return () => {
      window.removeEventListener('ai-response-typing', handleAITyping as EventListener);
    };
  }, [activeSessionId]);

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

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const handleSaveEdit = async () => {
    if (!editingMessage || editingMessageIndex === null || !editText.trim() || !activeSessionId) return;
    
    try {
      // COMMENTED OUT: No longer using direct messaging service (replaced with ChatPage mirroring)
      // const messageData = {
      //   action: 'chat' as const,
      //   type: 'chat_message' as const,
      //   messageId: editingMessage.id,
      //   message: editText,
      //   files: [],
      //   sessionId: activeSessionId,
      //   userId: user?.id!,
      //   model: selectedModel,
      //   context: {
      //     currentPage: window.location.pathname,
      //     sessionId: activeSessionId
      //   }
      // };

      // Note: Message editing is now handled by the unified messaging system
      
      // Send via ChatPage's WebSocket connection (unified architecture)
      const editMessageEvent = new CustomEvent('sidebar-send-message', {
        detail: {
          messageId: editingMessage.id,
          message: editText, // Changed from 'text' to 'message'
          sender: 'user',
          timestamp: Date.now(),
          sessionId: activeSessionId!,
          userId: user?.id,
          model: selectedModel,
          files: [],
          isEdit: true,
          originalMessageId: editingMessage.id
        }
      });
      window.dispatchEvent(editMessageEvent);
      console.log('✅ Sidebar sent edit message via ChatPage WebSocket');
      
      // Clear editing state
      setEditingMessage(null);
      setEditingMessageIndex(null);
      setEditText('');
      
      // Set loading state
      setIsLoadingMessage(true);
      
      // Dispatch event to ChatPage to mirror the edit
      const editEvent = new CustomEvent('sidebar-edit-message', {
        detail: {
          messageId: editingMessage.id,
          newText: editText,
          sessionId: activeSessionId,
          userId: user?.id,
          timestamp: Date.now()
        }
      });
      window.dispatchEvent(editEvent);
      console.log('📡 Sidebar dispatched edit event to ChatPage');
    } catch (error) {
      console.error('Error sending edit message:', error);
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
        if (session.messages && session.messages.length > 0) {
          console.log('📨 Sidebar: Loading existing messages into unified system:', session.messages.length);
          // Check if messages are already in the unified system to prevent duplication
          const existingMessages = unifiedMessageHandler.getMessagesForSession(sessionId);
          if (existingMessages.length === 0) {
            unifiedMessageHandler.loadExistingMessages(sessionId, session.messages);
          } else {
            console.log('📨 Sidebar: Messages already in unified system, skipping load');
          }
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
          // Send regular message - agent will fetch context from database
          const result = await sendUnifiedMessage({
            text: contextData.userMessage,
            model: selectedModel, // Use persistent model selection
            type: 'new_message',
            sessionId: contextData.sessionId
          });
          
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
      
      if (!activeSessionId) {
        console.warn('⚠️ No active sidebar session, cannot add context');
        return;
      }
      
      // Add to current session context
      console.log('🔍 DEBUG: Sidebar: Current sessionContext before update:', sessionContext);
      console.log('🔍 DEBUG: Sidebar: Adding new item:', contextItem);
      
      // Update previous context ref to mark that context has changed
      // This ensures the next message will send context data
      previousContextRef.current = sessionContext; // Keep the old context for change detection
      
      const newContext = [...sessionContext, contextItem];
      setSessionContext(newContext);
      console.log('🔍 DEBUG: Sidebar: New sessionContext after update:', newContext);
      console.log('🔍 DEBUG: Sidebar: Updated previousContextRef.current:', previousContextRef.current);
      console.log('🎯 Sidebar: Context change detection scenario completed - context data is ready for next message');
      console.log('🔍 DEBUG: Sidebar: Final contextItems after direct add:', newContext);
      console.log('🔍 DEBUG: Sidebar: Context length after direct add:', newContext.length);
      
      console.log('✅ Added to sidebar context');
      console.log('📌 Context item data:', JSON.stringify(contextItem, null, 2));
      
      // Notify ChatPage of context change AFTER change detection is set up
      const syncEvent = new CustomEvent('session-context-updated', {
        detail: { sessionId: activeSessionId, contextItems: newContext }
      });
      window.dispatchEvent(syncEvent);
      
      // Persist the updated context to backend immediately
      if (user?.id) {
        try {
          await sessionManagementAPI.updateSession(activeSessionId, user.id, {
            session_variables: {
              context_items: newContext,
              context_added_at: Date.now(),
            }
          });
          console.log('✅ Persisted context to backend');
        } catch (error) {
          console.error('❌ Failed to persist context to backend:', error);
        }
      }
    };

    const handleAddMultipleToSidebarContext = async (event: CustomEvent) => {
      const contextItems = event.detail;
      console.log(`📌 Adding ${contextItems.length} items to sidebar context:`, contextItems);
      
      if (!activeSessionId) {
        console.warn('⚠️ No active sidebar session, cannot add context');
        return;
      }
      
      // Add all items to current session context
      const newContext = [...sessionContext, ...contextItems];
      setSessionContext(newContext);
      console.log(`✅ Added ${contextItems.length} items to sidebar context`);
      
      // Notify ChatPage of context change
      const syncEvent = new CustomEvent('session-context-updated', {
        detail: { sessionId: activeSessionId, contextItems: newContext }
      });
      window.dispatchEvent(syncEvent);
      
      // Persist the updated context to backend immediately
      if (user?.id) {
        try {
          await sessionManagementAPI.updateSession(activeSessionId, user.id, {
            session_variables: {
              context_items: newContext,
              context_added_at: Date.now(),
            }
          });
          console.log('✅ Persisted context to backend');
        } catch (error) {
          console.error('❌ Failed to persist context to backend:', error);
        }
      }
    };

    window.addEventListener('add-to-sidebar-context', handleAddToSidebarContext as any);
    window.addEventListener('add-multiple-to-sidebar-context', handleAddMultipleToSidebarContext as any);
    
    return () => {
      window.removeEventListener('add-to-sidebar-context', handleAddToSidebarContext as any);
      window.removeEventListener('add-multiple-to-sidebar-context', handleAddMultipleToSidebarContext as any);
    };
  }, [activeSessionId, sessionContext, user?.id]);

  // Listen for context updates from ChatPage
  useEffect(() => {
    const handleContextSync = (event: CustomEvent) => {
      const { sessionId, contextItems } = event.detail;
      console.log('🔄 Sidebar: Received context sync from ChatPage:', { sessionId, itemCount: contextItems.length });
      
      if (sessionId === activeSessionId) {
        // Don't update previousContextRef here - it should already be set correctly
        // The context sync is just synchronizing the state, not adding new items
        console.log('🔍 DEBUG: Sidebar: Context sync - not updating previousContextRef.current');
        console.log('🔍 DEBUG: Sidebar: Current previousContextRef.current:', previousContextRef.current);
        
        setSessionContext(contextItems);
        console.log('✅ Sidebar: Synced context from ChatPage');
      }
    };

    window.addEventListener('session-context-updated', handleContextSync as any);
    
    return () => {
      window.removeEventListener('session-context-updated', handleContextSync as any);
    };
  }, [activeSessionId]);

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

  // NEW: Unified messaging system-based message sending
  const handleSendMessage = useCallback(async () => {
    if ((!inputMessage.trim() && uploadedFiles.length === 0) || !user?.id || isUnifiedProcessing) return;

    console.log('📤 Sidebar: Sending message via unified messaging system');
    
    // Show loading state
    setIsLoadingMessage(true);
    
    // Broadcast loading state to other interfaces
    if (activeSessionId) {
      unifiedMessageHandler.broadcastLoadingState(activeSessionId, true, 'sidebar');
    }
    
    try {
      let result;
      
      // Determine message type and send accordingly
      if (uploadedFiles.length > 0) {
        // File message
        console.log(`📁 Sidebar: Sending file message with ${uploadedFiles.length} files`);
        result = await sendUnifiedFileMessage(inputMessage, uploadedFiles as unknown as File[], selectedModel);
      } else if (sessionContext.length > 0 && hasContextChanged()) {
        // Context has changed - send context data for initial message, agent will fetch from database for follow-ups
        console.log(`📋 Sidebar: Context changed (${sessionContext.length} items) - sending context message with tile data`);
        console.log('🔍 DEBUG: sessionContext state:', sessionContext);
        console.log('🔍 DEBUG: sessionContext.length:', sessionContext.length);
        console.log('🔍 DEBUG: hasContextChanged():', hasContextChanged());
        console.log('🔍 DEBUG: previousContextRef.current:', previousContextRef.current);
        console.log('🎯 Sidebar: USER SENDING MESSAGE - Context change detection triggered, context data ready to be sent!');
        console.log('🔍 DEBUG: Sidebar: About to send contextItems to WebSocket:', sessionContext);
        console.log('🔍 DEBUG: Sidebar: sessionContext state when sending message:', sessionContext);
        console.log('🔍 DEBUG: Sidebar: sessionContext length when sending message:', sessionContext.length);
        console.log('🔍 DEBUG: Sidebar: sessionContext content when sending message:', JSON.stringify(sessionContext, null, 2));
        result = await sendUnifiedContextMessage(inputMessage, sessionContext, selectedModel);
        // Update previous context after sending
        previousContextRef.current = [...sessionContext];
      } else if (activeSessionId) {
        // Followup message (existing session)
        console.log('🔄 Sidebar: Sending followup message to existing session');
        result = await sendUnifiedFollowupMessage(inputMessage, selectedModel);
      } else {
        // New message (no session)
        console.log('🆕 Sidebar: Sending new message (will create session)');
        result = await sendUnifiedMessage({
          text: inputMessage,
          model: selectedModel,
          type: 'new_message'
        });
      }
      
      if (result.success) {
        console.log('✅ Sidebar: Message sent successfully via unified system');
        
        // Clear input and files
        setInputMessage('');
        setUploadedFiles([]);
        
        // Update session ID if a new session was created
        if (result.sessionId && result.sessionId !== activeSessionId) {
          console.log('🔄 Sidebar: New session created, updating active session:', result.sessionId);
          setActiveSessionId(result.sessionId);
        }
      } else {
        console.error('❌ Sidebar: Failed to send message:', result.error);
        setIsLoadingMessage(false);
        // Broadcast loading state clearing to other interfaces
        if (activeSessionId) {
          unifiedMessageHandler.broadcastLoadingState(activeSessionId, false, 'sidebar');
        }
      }
    } catch (error) {
      console.error('❌ Sidebar: Error sending message via unified system:', error);
      setIsLoadingMessage(false);
      // Broadcast loading state clearing to other interfaces
      if (activeSessionId) {
        unifiedMessageHandler.broadcastLoadingState(activeSessionId, false, 'sidebar');
      }
    }
  }, [inputMessage, activeSessionId, user?.id, selectedModel, uploadedFiles, sessionContext, isUnifiedProcessing, sendUnifiedMessage, sendUnifiedContextMessage, sendUnifiedFileMessage, sendUnifiedFollowupMessage, setActiveSessionId]);

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

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

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const windowWidth = window.innerWidth;
    const newWidth = windowWidth - e.clientX;
    
    // Calculate percentage limits
    const minWidth = windowWidth * 0.1; // 10% of screen width
    const maxWidth = windowWidth * 0.75; // 75% of screen width
    
    // Clamp the width within limits
    const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    
    setSidebarWidth(clampedWidth);
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

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
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleModelChange = (event: SelectChangeEvent) => {
    setSelectedModel(event.target.value);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Box
      ref={sidebarRef}
      sx={{
        position: 'fixed',
        right: 0,
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
        animation: 'slideInFromRight 0.3s ease-out',
        '@keyframes slideInFromRight': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      }}
    >
      {/* Resize Handle */}
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
      {/* Header */}
      <Box
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

        <Box sx={{ display: 'flex', gap: 0.5 }}>
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
              setActiveSessionId(null);
              setCurrentSession(null);
              setSessionContext([]);
              setInputMessage('');
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

      {/* Context Items */}
      {sessionContext.length > 0 && (
        <Box sx={{ borderBottom: '1px solid #374151' }}>
          <Box
            sx={{
              p: 1,
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
            }}
            onClick={() => setIsContextExpanded(!isContextExpanded)}
          >
            <Typography variant="body2" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
              Context ({sessionContext.length} items)
            </Typography>
            {isContextExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </Box>
          <Collapse in={isContextExpanded}>
            <List dense sx={{ py: 0 }}>
              {sessionContext.map((item, index) => (
                <ListItem 
                  key={index} 
                  sx={{ 
                    py: 0.5, 
                    px: 1,
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      '& .remove-context-btn': {
                        opacity: 1,
                      }
                    }
                  }}
                  secondaryAction={
                    <IconButton
                      edge="end"
                      size="small"
                      className="remove-context-btn"
                      onClick={async () => {
                        const newContext = sessionContext.filter((_, i) => i !== index);
                        setSessionContext(newContext);
                        console.log(`🗑️ Removed context item: ${item.title}`);
                        
                        // Notify ChatPage of context change
                        if (activeSessionId) {
                          const syncEvent = new CustomEvent('session-context-updated', {
                            detail: { sessionId: activeSessionId, contextItems: newContext }
                          });
                          window.dispatchEvent(syncEvent);
                        }
                        
                        // Persist the updated context to backend immediately
                        if (activeSessionId && user?.id) {
                          try {
                            await sessionManagementAPI.updateSession(activeSessionId, user.id, {
                              session_variables: {
                                context_items: newContext,
                                context_added_at: Date.now(),
                              }
                            });
                            console.log('✅ Updated context in backend');
                          } catch (error) {
                            console.error('❌ Failed to update context in backend:', error);
                          }
                        }
                      }}
                      sx={{ 
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        color: '#dc2626',
                        '&:hover': { color: '#ef4444' }
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  }
                >
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

      {/* Files Section - User Files and Agent Files */}
      {((currentSession?.session_variables?.uploaded_files && currentSession.session_variables.uploaded_files.length > 0) || 
        (currentSession?.session_variables?.agent_files && currentSession.session_variables.agent_files.length > 0)) ? (
        <Box sx={{ borderBottom: '1px solid #374151' }}>
          <Box
            sx={{
              p: 1,
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
            }}
            onClick={() => setIsFilesExpanded(!isFilesExpanded)}
          >
            <Typography variant="body2" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
              Files
            </Typography>
            {isFilesExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </Box>
          <Collapse in={isFilesExpanded}>
            <Box sx={{ 
              py: 1, 
              px: 1, 
              maxHeight: 200, 
              overflow: 'auto',
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
              {/* User Files Section */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ 
                  fontWeight: 600, 
                  color: '#3b82f6', 
                  mb: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: '0.75rem'
                }}>
                  <PersonIcon fontSize="small" />
                  User Files ({currentSession?.session_variables?.uploaded_files?.length || 0})
                </Typography>
                
                {currentSession?.session_variables?.uploaded_files && currentSession.session_variables.uploaded_files.length > 0 ? (
                  <List dense sx={{ py: 0 }}>
                    {currentSession.session_variables.uploaded_files.map((file: any, index: number) => (
                      <ListItem 
                        key={index} 
                        sx={{ 
                          py: 0.5, 
                          px: 1,
                          '&:hover': {
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            '& .remove-file-btn': {
                              opacity: 1,
                            }
                          }
                        }}
                        secondaryAction={
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <IconButton
                              size="small"
                              className="remove-file-btn"
                              onClick={async () => {
                                if (!activeSessionId || !user?.id) {
                                  console.error('Missing session ID or user ID for file download');
                                  return;
                                }

                                try {
                                  console.log('📥 Downloading file:', file.filename);
                                  
                                  // Request fresh presigned URL from file return Lambda
                                  const apiUrl = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';
                                  const response = await fetch(`${apiUrl}/file-download`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      user_id: user.id,
                                      session_id: activeSessionId,
                                      filename: file.filename,
                                      s3_key: file.s3_key
                                    })
                                  });
                                  
                                  if (!response.ok) {
                                    throw new Error(`Download request failed: ${response.status}`);
                                  }
                                  
                                  const { download_url } = await response.json();
                                  
                                  // Create download link and trigger download in new tab
                                  const link = document.createElement('a');
                                  link.href = download_url;
                                  link.download = file.filename;
                                  link.target = '_blank';  // Open in new tab to avoid redirect issues
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  
                                  console.log('✅ File download started');
                                } catch (error) {
                                  console.error('❌ Download failed:', error);
                                }
                              }}
                              sx={{ 
                                opacity: 0,
                                transition: 'opacity 0.2s',
                                color: '#3b82f6',
                                '&:hover': { color: '#60a5fa' }
                              }}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              edge="end"
                              size="small"
                              className="remove-file-btn"
                              onClick={async () => {
                                const newFiles = currentSession.session_variables?.uploaded_files?.filter((_: any, i: number) => i !== index) || [];
                                
                                // Update the local session state
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
                                if (activeSessionId && user?.id) {
                                  try {
                                    await sessionManagementAPI.updateSession(activeSessionId, user.id, {
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
                                '&:hover': { color: '#ef4444' }
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        }
                      >
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
                ) : (
                  <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.7rem', fontStyle: 'italic' }}>
                    No user files uploaded
                  </Typography>
                )}
              </Box>

              {/* Agent Files Section */}
              <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ 
                  fontWeight: 600, 
                  color: '#22c55e', 
                  mb: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: '0.75rem'
                }}>
                  <SmartToyIcon fontSize="small" />
                  Agent Files ({currentSession?.session_variables?.agent_files?.length || 0})
                </Typography>
                
                {currentSession?.session_variables?.agent_files && currentSession.session_variables.agent_files.length > 0 ? (
                  <List dense sx={{ py: 0 }}>
                    {currentSession.session_variables.agent_files.map((file: any, index: number) => (
                      <ListItem 
                        key={index} 
                        sx={{ 
                          py: 0.5, 
                          px: 1,
                          backgroundColor: 'rgba(34, 197, 94, 0.1)',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          borderRadius: '4px',
                          mb: 0.5,
                          '&:hover': {
                            backgroundColor: 'rgba(34, 197, 94, 0.15)',
                            '& .remove-file-btn': {
                              opacity: 1,
                            }
                          }
                        }}
                        secondaryAction={
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <IconButton
                              size="small"
                              className="remove-file-btn"
                              onClick={async () => {
                                if (!activeSessionId || !user?.id) {
                                  console.error('Missing session ID or user ID for file download');
                                  return;
                                }

                                try {
                                  console.log('📥 Downloading agent file:', file.filename);
                                  
                                  // Request fresh presigned URL from file return Lambda
                                  const apiUrl = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';
                                  const response = await fetch(`${apiUrl}/file-download`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      user_id: user.id,
                                      session_id: activeSessionId,
                                      filename: file.filename,
                                      s3_key: file.s3_key
                                    })
                                  });
                                  
                                  if (!response.ok) {
                                    throw new Error(`Download request failed: ${response.status}`);
                                  }
                                  
                                  const { download_url } = await response.json();
                                  
                                  // Create download link and trigger download in new tab
                                  const link = document.createElement('a');
                                  link.href = download_url;
                                  link.download = file.filename;
                                  link.target = '_blank';  // Open in new tab to avoid redirect issues
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  
                                  console.log('✅ Agent file download started');
                                } catch (error) {
                                  console.error('❌ Agent file download failed:', error);
                                }
                              }}
                              sx={{ 
                                opacity: 0,
                                transition: 'opacity 0.2s',
                                color: '#22c55e',
                                '&:hover': { color: '#16a34a' }
                              }}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              edge="end"
                              size="small"
                              className="remove-file-btn"
                              onClick={async () => {
                                const newFiles = currentSession.session_variables?.agent_files?.filter((_: any, i: number) => i !== index) || [];
                                
                                // Update the session using the hook function
                                if (activeSessionId) {
                                  updateSessionAgentFiles(activeSessionId, newFiles);
                                }
                                console.log(`🗑️ Removed agent file: ${file.filename}`);
                                
                                // Persist the updated files to backend immediately
                                if (activeSessionId && user?.id) {
                                  try {
                                    await sessionManagementAPI.updateSession(activeSessionId, user.id, {
                                      session_variables: {
                                        ...currentSession.session_variables,
                                        agent_files: newFiles,
                                      }
                                    });
                                    console.log('✅ Updated agent files in backend');
                                  } catch (error) {
                                    console.error('❌ Failed to update agent files in backend:', error);
                                  }
                                }
                              }}
                              sx={{ 
                                opacity: 0,
                                transition: 'opacity 0.2s',
                                color: '#dc2626',
                                '&:hover': { color: '#ef4444' }
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        }
                      >
                        <ListItemText
                          primary={file.filename}
                          secondary={`${(file.file_size / 1024).toFixed(1)} KB • ${file.content_type} • Generated`}
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
                ) : (
                  <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.7rem', fontStyle: 'italic' }}>
                    No agent files generated
                  </Typography>
                )}
              </Box>
            </Box>
          </Collapse>
        </Box>
      ) : null}

      {/* Messages */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
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
        {messages.map((message, messageIndex) => (
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
                        fontSize: '0.875rem',
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
                          <FileIcon sx={{ color: '#22c55e' }} />
                          <Typography variant="body2" color="white">
                            {file.name}
                          </Typography>
                          <Typography variant="caption" color="#9ca3af">
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
              AI is thinking...
            </Typography>
          </Box>
        )}
        
        <div ref={messagesEndRef} />
      </Box>

      {/* Input Area */}
      <Box
        sx={{
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
          <TextField
            fullWidth
            multiline
            maxRows={3}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={isLoadingMessage}
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
            }}
          />
          <IconButton
            onClick={handleSendMessage}
            disabled={isLoadingMessage || (!inputMessage.trim() && uploadedFiles.length === 0)}
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

      </Box>
    </Box>
  );
};

export default GlobalChatSidebar;