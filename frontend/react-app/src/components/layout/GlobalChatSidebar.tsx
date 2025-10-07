import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Tooltip,
  CircularProgress,
  Alert,
  Chip,
  InputAdornment,
  FormControl,
  Select,
  MenuItem,
  SelectChangeEvent,
  Collapse,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
  Close as CloseIcon,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useGlobalChat } from '../../contexts/GlobalChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { ContextItem } from '../tiles/common/contextManager';
import { sessionManagementAPI } from '../../services/api';

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
}

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
  const { websocket, connect: connectWebSocket, sendMessage, isConnected } = useWebSocket();
  
  // Local state for the mirror
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessionContext, setSessionContext] = useState<ContextItem[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState('claude-3-sonnet');
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const sidebarWidth = 400;

  // Available models (matching ChatPage exactly)
  const availableModels = [
    { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
    { value: 'claude-3-haiku', label: 'Claude 3 Haiku' },
    { value: 'nova-lite', label: 'Amazon Nova Lite' },
    { value: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
    { value: 'gpt-oss-20b', label: 'GPT-OSS 20B' },
  ];

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Typewriter effect for AI responses (same speed as ChatPage)
  const typewriterEffect = (messageId: string, fullText: string, speed: number = 2) => {
    let currentIndex = 0;
    setStreamingMessageId(messageId);
    
    const typeInterval = setInterval(() => {
      currentIndex++;
      const currentText = fullText.substring(0, currentIndex);
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, text: currentText }
          : msg
      ));
      
      if (currentIndex >= fullText.length) {
        clearInterval(typeInterval);
        setStreamingMessageId(null);
        console.log('✅ Streaming completed for message:', messageId);
      }
    }, speed);
    
    return typeInterval;
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
        setSelectedModel(session.model || 'claude-3-sonnet');

        // Load messages
        const loadedMessages: Message[] = (session.messages || []).map((msg: any) => ({
          id: msg.message_id || msg.id || `msg_${Date.now()}_${Math.random()}`,
          sender: msg.sender,
          text: msg.text,
          timestamp: msg.timestamp || Date.now(),
        }));
        setMessages(loadedMessages);

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

    const handleChatPageMessage = (event: CustomEvent) => {
      const messageData = event.detail;
      console.log('📨 GlobalChatSidebar mirroring ChatPage message:', messageData);
      
      if (messageData.sessionId === activeSessionId && messageData.userId === user?.id) {
        // Add message to sidebar
        setMessages(prev => [
          ...prev,
          {
            id: messageData.messageId,
            sender: messageData.sender,
            text: messageData.text,
            timestamp: messageData.timestamp
          }
        ]);
        
        // If it's a user message, show loading state
        if (messageData.sender === 'user') {
          setIsLoadingMessage(true);
        }
      }
    };

    const handleChatPageAIResponse = (event: CustomEvent) => {
      const responseData = event.detail;
      console.log('🤖 GlobalChatSidebar mirroring AI response:', responseData);
      
      // Check for duplicate
      if (processedMessageIdsRef.current.has(responseData.messageId)) {
        console.log('🤖 Duplicate AI response ignored (already processed):', responseData.messageId);
        return;
      }
      
      console.log('🤖 Current activeSessionId:', activeSessionId);
      console.log('🤖 Response sessionId:', responseData.sessionId);
      console.log('🤖 Current user ID:', user?.id);
      console.log('🤖 Response user ID:', responseData.userId);
      
      if (responseData.sessionId === activeSessionId && responseData.userId === user?.id) {
        console.log('✅ Session and user match, adding AI response');
        
        // Mark as processed
        processedMessageIdsRef.current.add(responseData.messageId);
        
        // Clear loading state immediately
        setIsLoadingMessage(false);
        
        // Add AI response with empty text initially for typewriter effect
        const messageId = responseData.messageId;
        setMessages(prev => [
          ...prev,
          {
            id: messageId,
            sender: 'ai',
            text: '', // Start empty for typewriter effect
            timestamp: responseData.timestamp
          }
        ]);
        
        // Start typewriter effect with same speed as ChatPage (2ms)
        typewriterEffect(messageId, responseData.content, 2);
        console.log('✅ AI response typewriter started in sidebar');
      } else {
        console.log('❌ Session or user mismatch, ignoring AI response');
      }
    };

    window.addEventListener('chatpage-message', handleChatPageMessage as EventListener);
    window.addEventListener('chatpage-ai-response', handleChatPageAIResponse as EventListener);
    
    return () => {
      window.removeEventListener('chatpage-message', handleChatPageMessage as EventListener);
      window.removeEventListener('chatpage-ai-response', handleChatPageAIResponse as EventListener);
    };
  }, [isVisible, activeSessionId, user?.id]);

  // Handle manual session opening from ChatPage
  useEffect(() => {
    if (!isVisible) return;

    const handleManualSessionOpen = (event: CustomEvent) => {
      const sessionData = event.detail;
      console.log('📂 GlobalChatSidebar opening session:', sessionData);
      
      if (sessionData.sessionId && sessionData.userId === user?.id) {
        setActiveSessionId(sessionData.sessionId);
        // Load the session data from database
        loadSessionFromDatabase(sessionData.sessionId);
      }
    };

    window.addEventListener('manual-session-open', handleManualSessionOpen as EventListener);
    
    return () => {
      window.removeEventListener('manual-session-open', handleManualSessionOpen as EventListener);
    };
  }, [isVisible, user?.id, setActiveSessionId]);

  // Handle context sessions from global handler
  useEffect(() => {
    const handleContextSessionReady = async (event: CustomEvent) => {
      const contextData = event.detail;
      console.log('🎯 GlobalChatSidebar: Context session ready:', contextData);
      
      if (contextData.userId === user?.id) {
        console.log('🎯 GlobalChatSidebar: Processing context session:', contextData.sessionId);
        
        // Clear any existing session - this is a new context session
        if (activeSessionId && activeSessionId !== contextData.sessionId) {
          console.log('🎯 GlobalChatSidebar: Clearing old session:', activeSessionId);
          setCurrentSession(null);
          setMessages([]);
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
          model: 'claude-3-sonnet',
          created_at: Date.now(),
          last_updated: Date.now(),
          message_count: 0,
          messages: []
        });
        
        // Set context items
        setSessionContext(contextData.contextItems || []);
        
        // Add the user message immediately
        const userMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const userMessage: Message = {
          id: userMessageId,
          sender: 'user',
          text: contextData.userMessage,
          timestamp: Date.now(),
        };
        setMessages([userMessage]);
        
        // Show loading state
        setIsLoadingMessage(true);
        
        // Small delay to ensure sessionStorage is written before WebSocket reads it
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Connect WebSocket for this session
        console.log(`🔌 Requesting WebSocket connection for session: ${contextData.sessionId}`);
        connectWebSocket(contextData.sessionId);
        
        // Wait for WebSocket to fully establish
        // This needs to account for:
        // 1. Closing old connection (~100ms)
        // 2. Opening new connection (~500ms)
        // 3. Receiving connection_established (~500ms)
        // 4. WebSocket ref stabilization (~100ms)
        console.log('⏳ Waiting for WebSocket connection to establish...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        console.log('🚀 WebSocket should be ready, sending message');
        
        // Send the contextualized message
        const messagePayload = {
          action: 'chat',
          type: 'chat_message',
          message: contextData.userMessage,
          userId: user.id,
          sessionId: contextData.sessionId,
          model: 'claude-3-sonnet',
          files: [],
          messageId: userMessageId,
          contextItems: contextData.contextItems,
          context: {
            currentPage: window.location.pathname,
            sessionId: contextData.sessionId,
            hasContext: true,
            contextItemCount: contextData.contextItems.length,
          }
        };
        
        const sent = sendMessage(messagePayload);
        if (sent) {
          console.log('✅ GlobalChatSidebar: Sent contextualized message via WebSocket');
        } else {
          console.error('❌ GlobalChatSidebar: Failed to send message');
          setIsLoadingMessage(false);
        }
      }
    };

    window.addEventListener('context-session-ready', handleContextSessionReady as EventListener);
    
    return () => {
      window.removeEventListener('context-session-ready', handleContextSessionReady as EventListener);
    };
  }, [user?.id, activeSessionId, setIsVisible, setActiveSessionId, connectWebSocket, sendMessage]);

  // Listen for WebSocket messages
  useEffect(() => {
    if (!isVisible) return;

    const handleWebSocketMessage = (event: CustomEvent) => {
      const data = event.detail;
      console.log('📨 Sidebar received WebSocket message:', data.type);

      switch (data.type) {
        case 'ai_response':
          const messageId = data.message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Get the latest activeSessionId from sessionStorage to avoid stale closures
          const latestActiveSessionId = sessionStorage.getItem('global-chat-active-session');
          
          // Log session comparison for debugging
          console.log('🤖 Sidebar received AI response:', {
            responseSessionId: data.session_id,
            activeSessionIdFromState: activeSessionId,
            activeSessionIdFromStorage: latestActiveSessionId,
            match: data.session_id === latestActiveSessionId,
            messageId: messageId
          });
          
          // Only process if it's for the active session (check sessionStorage for latest value)
          if (data.session_id === latestActiveSessionId || !latestActiveSessionId) {
            // Check for duplicate
            if (processedMessageIdsRef.current.has(messageId)) {
              console.log('🤖 Duplicate AI response ignored (WebSocket):', messageId);
              break;
            }
            
            console.log('🤖 Sidebar processing AI response for session:', data.session_id);
            
            // Mark as processed
            processedMessageIdsRef.current.add(messageId);
            
            // Clear loading state
            setIsLoadingMessage(false);
            
            // Add AI response with empty text for typewriter effect
            setMessages(prev => [
              ...prev,
              {
                id: messageId,
                sender: 'ai',
                text: '',
                timestamp: Date.now(),
              }
            ]);
            
            // Start typewriter effect
            typewriterEffect(messageId, data.content || 'No response', 2);
            
            // Dispatch AI response to ChatPage so it can mirror it
            const aiResponseEvent = new CustomEvent('chatpage-ai-response', {
              detail: {
                messageId: messageId,
                content: data.content || 'No response',
                sessionId: data.session_id,
                userId: user?.id,
                timestamp: Date.now()
              }
            });
            window.dispatchEvent(aiResponseEvent);
            console.log('📡 Sidebar dispatched AI response to ChatPage:', messageId);
          } else {
            console.log('⚠️ AI response session mismatch - not processing:', {
              responseSessionId: data.session_id,
              activeSessionIdFromState: activeSessionId,
              activeSessionIdFromStorage: latestActiveSessionId
            });
          }
          break;
          
        case 'message_received':
          console.log('✅ Message received confirmation:', data.message_id);
          break;
          
        case 'error':
          console.error('❌ WebSocket error:', data.message);
          setIsLoadingMessage(false);
          break;
      }
    };

    window.addEventListener('websocket-message', handleWebSocketMessage as EventListener);

    return () => {
      window.removeEventListener('websocket-message', handleWebSocketMessage as EventListener);
    };
  }, [isVisible, activeSessionId, typewriterEffect, user?.id]);

  // Send message - uses WebSocket directly
  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !user?.id) return;

    const userMessage = inputMessage.trim();
    let sessionId = activeSessionId;

    // If no active session, create a new one
    if (!sessionId) {
      try {
        console.log('🆕 Creating new session for sidebar message');
        const response = await fetch(`https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production/sessions?user_id=${user.id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: new Date().toLocaleString(),
            model: selectedModel,
            create_welcome_message: false
          })
        });
        
        if (response.ok) {
          const newSession = await response.json();
          sessionId = newSession.session_id;
          setActiveSessionId(sessionId);
          console.log('✅ New session created:', sessionId);
        } else {
          throw new Error('Failed to create session');
        }
      } catch (error) {
        console.error('❌ Failed to create new session:', error);
        // Create local session as fallback
        sessionId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setActiveSessionId(sessionId);
        console.log('✅ Local session created:', sessionId);
      }
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add user message to sidebar immediately
    setMessages(prev => [
      ...prev,
      {
        id: messageId,
        sender: 'user',
        text: userMessage,
        timestamp: Date.now(),
      }
    ]);

    setInputMessage('');
    setIsLoadingMessage(true);

    // Ensure WebSocket is connected for this session
    if (!isConnected) {
      console.log('🔌 WebSocket not connected, connecting to session:', sessionId);
      connectWebSocket(sessionId);
      // Wait a moment for connection
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Send message directly via WebSocket
    const messagePayload = {
      action: 'chat',
      type: 'chat_message',
      message: userMessage,
      userId: user.id,
      sessionId: sessionId,
      model: selectedModel,
      files: [],
      messageId: messageId,
    };
    
    const sent = sendMessage(messagePayload);
    if (sent) {
      console.log('✅ Sent message via WebSocket with model:', selectedModel, 'Message:', userMessage.substring(0, 50));
      
      // Also dispatch event for ChatPage to mirror if it's open
      const sidebarMessageEvent = new CustomEvent('sidebar-send-message', {
        detail: {
          message: userMessage,
          sessionId: sessionId,
          model: selectedModel,
          userId: user.id,
          messageId: messageId,
          timestamp: Date.now()
        }
      });
      window.dispatchEvent(sidebarMessageEvent);
    } else {
      console.error('❌ Failed to send message via WebSocket');
      setIsLoadingMessage(false);
    }
  }, [inputMessage, activeSessionId, user?.id, selectedModel, setActiveSessionId, connectWebSocket, sendMessage, isConnected]);

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const handleModelChange = (event: SelectChangeEvent) => {
    setSelectedModel(event.target.value);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Box
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
              onClick={() => loadSessionFromDatabase(activeSessionId)}
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
              setMessages([]);
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
                <ListItem key={index} sx={{ py: 0.5, px: 1 }}>
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
        {messages.map((message) => (
          <Box
            key={message.id}
            sx={{
              alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
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
            <Typography
              variant="body2"
              sx={{
                color: '#ffffff',
                fontSize: '0.875rem',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {message.text}
              {streamingMessageId === message.id && (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-block',
                    width: '8px',
                    height: '16px',
                    backgroundColor: '#60a5fa',
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
          </Box>
        ))}
        
        {isLoadingMessage && (
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
        {/* Model Selection */}
        <FormControl fullWidth size="small" sx={{ mb: 1 }}>
          <Select
            value={selectedModel}
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
              <MenuItem key={model.value} value={model.value}>
                <Typography sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                  {model.label}
                </Typography>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Message Input */}
        <TextField
          fullWidth
          multiline
          maxRows={4}
          placeholder="Type your message..."
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
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
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isLoadingMessage}
                  sx={{
                    color: inputMessage.trim() ? '#3b82f6' : '#6b7280',
                    '&:hover': {
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  <SendIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>
    </Box>
  );
};

export default GlobalChatSidebar;