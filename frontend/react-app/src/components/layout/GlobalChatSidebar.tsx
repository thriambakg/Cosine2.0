import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  CircularProgress,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  Chip,
  List,
  ListItem,
  Collapse,
} from '@mui/material';
import {
  ChevronRight as ChevronRightIcon,
  ChevronLeft as ChevronLeftIcon,
  Send as SendIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useGlobalChat } from '../../contexts/GlobalChatContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { ChatSession } from '../../hooks/useChatPersistence';
import { sessionManagementAPI } from '../../services/api';
import { ContextItem } from '../tiles/common/contextManager';

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
}

const GlobalChatSidebar: React.FC = () => {
  const { isVisible, activeSessionId, close } = useGlobalChat();
  const { isConnected, connect, disconnect, sendMessage, websocket } = useWebSocket();
  const { user } = useAuth();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(false);
  const [isLoadingMessage, setIsLoadingMessage] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('claude-3-sonnet');
  const [sessionContext, setSessionContext] = useState<ContextItem[]>([]);
  const [showContextBookmark, setShowContextBookmark] = useState<boolean>(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sidebarWidth = 500;

  // Load session when activeSessionId changes
  useEffect(() => {
    if (activeSessionId && user?.id && isVisible) {
      loadSession(activeSessionId);
      connect(activeSessionId);
    }
  }, [activeSessionId, user?.id, isVisible]);

  // Restore session when sidebar becomes visible
  useEffect(() => {
    if (isVisible && !currentSession && activeSessionId && user?.id) {
      console.log('🔄 Restoring session when sidebar becomes visible:', activeSessionId);
      loadSession(activeSessionId);
      connect(activeSessionId);
    }
  }, [isVisible, activeSessionId, user?.id, currentSession]);

  // Handle pending context sessions from ContextWindow
  useEffect(() => {
    if (!isVisible) return;

    const handleContextSession = (event: CustomEvent) => {
      const contextData = event.detail;
      console.log('🎯 GlobalChatSidebar received context session:', contextData);
      
      if (contextData.sessionId && contextData.userId === user?.id) {
        // Set the session as current and load it
      setCurrentSession({
        session_id: contextData.sessionId,
        title: 'Context Analysis',
        model: 'claude-3-sonnet',
        created_at: Date.now() / 1000,
        last_updated: Date.now() / 1000,
        message_count: 0,
        messages: [],
        session_variables: {
          context_items: contextData.contextItems || [],
          context_added_at: Date.now().toString(),
        }
      });

        // Add the user's message to the UI immediately
        const userMessage: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sender: 'user',
          text: contextData.userMessage,
          timestamp: Date.now(),
        };
        setMessages([userMessage]);
        
        // Connect WebSocket and send message
        connect(contextData.sessionId);
        
        // Wait for WebSocket connection and send message
        const waitForConnection = () => {
          if (websocket && websocket.readyState === WebSocket.OPEN) {
            const sent = sendMessage({
              action: 'chat',
              type: 'chat_message',
              message: contextData.userMessage,
              userId: user.id,
              sessionId: contextData.sessionId,
              model: 'claude-3-sonnet',
              files: [],
              contextItems: contextData.contextItems,
              messageId: userMessage.id,
            });
            
            if (sent) {
              setIsLoadingMessage(true);
            } else {
              console.error('Failed to send context message');
            }
          } else {
            // Retry after a short delay
            setTimeout(waitForConnection, 100);
          }
        };
        
        // Start waiting for connection
        waitForConnection();
      }
    };

    window.addEventListener('create-context-session', handleContextSession as EventListener);
    
    return () => {
      window.removeEventListener('create-context-session', handleContextSession as EventListener);
    };
  }, [isVisible, user?.id, connect, sendMessage, websocket]);

  // Listen for WebSocket messages
  useEffect(() => {
    if (!websocket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'ai_response') {
          setMessages(prev => [
            ...prev,
            {
              id: data.message_id || `msg_${Date.now()}`,
              sender: 'ai',
              text: data.content,
              timestamp: Date.now(),
            }
          ]);
          setIsLoadingMessage(false);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.addEventListener('message', handleMessage);

    return () => {
      websocket.removeEventListener('message', handleMessage);
    };
  }, [websocket]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadSession = async (sessionId: string) => {
    if (!user?.id) return;

    setIsLoadingSession(true);
    try {
      const session = await sessionManagementAPI.getSession(sessionId, user.id);
      setCurrentSession(session);
      setSelectedModel(session.model || 'claude-3-sonnet');

      // Load messages
      const loadedMessages: Message[] = (session.messages || []).map((msg: any) => ({
        id: msg.message_id || `msg_${Date.now()}_${Math.random()}`,
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
    } catch (error) {
      console.error('Failed to load session:', error);
    } finally {
      setIsLoadingSession(false);
    }
  };

  const handleSendMessage = useCallback(() => {
    if (!inputMessage.trim() || !activeSessionId || !user?.id || !isConnected) return;

    const userMessage = inputMessage.trim();
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add user message to UI immediately
    setMessages(prev => [
      ...prev,
      {
        id: messageId,
        sender: 'user',
        text: userMessage,
        timestamp: Date.now(),
      }
    ]);

    // Send via WebSocket
    const sent = sendMessage({
      action: 'chat',
      type: 'chat_message',
      message: userMessage,
      userId: user.id,
      sessionId: activeSessionId,
      model: selectedModel,
      files: [],
      messageId: messageId,
    });

    if (sent) {
      setInputMessage('');
      setIsLoadingMessage(true);
    } else {
      console.error('Failed to send message - WebSocket not connected');
    }
  }, [inputMessage, activeSessionId, user?.id, isConnected, selectedModel, sendMessage]);

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        right: 0,
        top: 64, // Below header
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
          from: {
            transform: 'translateX(100%)',
          },
          to: {
            transform: 'translateX(0)',
          },
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
          {isLoadingSession && <CircularProgress size={16} sx={{ color: '#3b82f6' }} />}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Refresh">
            <IconButton
              size="small"
              onClick={() => activeSessionId && loadSession(activeSessionId)}
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
          </Tooltip>

          <Tooltip title="Close">
            <IconButton
              size="small"
              onClick={close}
              sx={{
                color: '#9ca3af',
                '&:hover': {
                  color: '#ef4444',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Model Selector */}
      <Box sx={{ p: 2, borderBottom: '1px solid #374151' }}>
        <FormControl fullWidth size="small">
          <Select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            sx={{
              color: '#ffffff',
              backgroundColor: 'rgba(31, 41, 55, 0.5)',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#374151',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#4b5563',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: '#3b82f6',
              },
              '& .MuiSvgIcon-root': {
                color: '#9ca3af',
              },
            }}
          >
            <MenuItem value="claude-3-sonnet">Claude 3 Sonnet</MenuItem>
            <MenuItem value="claude-3-haiku">Claude 3 Haiku</MenuItem>
            <MenuItem value="nova-lite">Amazon Nova Lite</MenuItem>
            <MenuItem value="gpt-oss-120b">GPT-OSS 120B</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Messages */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
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
        {messages.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#6b7280',
              textAlign: 'center',
              px: 4,
            }}
          >
            <Typography variant="body2">
              Start a conversation with the AI assistant
            </Typography>
          </Box>
        ) : (
          messages.map((message) => (
            <Box
              key={message.id}
              sx={{
                mb: 2,
                display: 'flex',
                flexDirection: message.sender === 'user' ? 'row-reverse' : 'row',
                gap: 1,
              }}
            >
              <Box
                sx={{
                  maxWidth: '80%',
                  p: 1.5,
                  borderRadius: '8px',
                  backgroundColor: message.sender === 'user'
                    ? 'rgba(59, 130, 246, 0.2)'
                    : 'rgba(55, 65, 81, 0.5)',
                  border: message.sender === 'user'
                    ? '1px solid rgba(59, 130, 246, 0.3)'
                    : '1px solid rgba(107, 114, 128, 0.3)',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: '#ffffff',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {message.text}
                </Typography>
              </Box>
            </Box>
          ))
        )}
        {isLoadingMessage && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CircularProgress size={16} sx={{ color: '#3b82f6' }} />
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>
              AI is thinking...
            </Typography>
          </Box>
        )}
        <div ref={messagesEndRef} />
      </Box>

      {/* Context Bookmark */}
      {sessionContext.length > 0 && (
        <Box
          sx={{
            borderTop: '2px solid #374151',
          }}
        >
          <Box
            sx={{
              p: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              borderBottom: showContextBookmark ? '1px solid #374151' : 'none',
              cursor: 'pointer',
              '&:hover': {
                backgroundColor: 'rgba(31, 41, 55, 0.95)',
              },
            }}
            onClick={() => setShowContextBookmark(!showContextBookmark)}
          >
            <Tooltip title={showContextBookmark ? 'Hide context' : 'Show context'}>
              <IconButton
                size="small"
                sx={{
                  color: '#3b82f6',
                  p: 0.5,
                }}
              >
                {showContextBookmark ? <ExpandMoreIcon /> : <ExpandLessIcon />}
              </IconButton>
            </Tooltip>
            <Typography
              variant="caption"
              sx={{
                color: '#9ca3af',
                ml: 1,
              }}
            >
              📌 Context ({sessionContext.length} {sessionContext.length === 1 ? 'item' : 'items'})
            </Typography>
          </Box>

          {showContextBookmark && (
            <Box
              sx={{
                maxHeight: '150px',
                overflowY: 'auto',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                p: 1,
                '&::-webkit-scrollbar': {
                  width: '4px',
                },
                '&::-webkit-scrollbar-track': {
                  backgroundColor: 'rgba(55, 65, 81, 0.3)',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(59, 130, 246, 0.5)',
                  borderRadius: '2px',
                },
              }}
            >
              <List sx={{ p: 0 }}>
                {sessionContext.map((item, index) => (
                  <ListItem
                    key={item.id}
                    sx={{
                      backgroundColor: 'rgba(59, 130, 246, 0.05)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      borderRadius: '6px',
                      mb: index < sessionContext.length - 1 ? 1 : 0,
                      p: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          color: '#ffffff',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {item.title}
                      </Typography>
                      {item.subtitle && (
                        <Typography
                          variant="caption"
                          sx={{
                            color: '#9ca3af',
                            fontSize: '0.65rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'block',
                          }}
                        >
                          {item.subtitle}
                        </Typography>
                      )}
                    </Box>
                    <Chip
                      label={item.type}
                      size="small"
                      sx={{
                        height: '16px',
                        fontSize: '0.65rem',
                        backgroundColor: 'rgba(139, 92, 246, 0.2)',
                        color: '#a78bfa',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Box>
      )}

      {/* Input */}
      <Box sx={{ p: 2, borderTop: '1px solid #374151' }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={isConnected ? "Ask a question..." : "Connecting..."}
          disabled={!isConnected || isLoadingMessage}
          sx={{
            '& .MuiOutlinedInput-root': {
              color: '#ffffff',
              backgroundColor: 'rgba(31, 41, 55, 0.5)',
              '& fieldset': {
                borderColor: '#374151',
              },
              '&:hover fieldset': {
                borderColor: '#4b5563',
              },
              '&.Mui-focused fieldset': {
                borderColor: '#3b82f6',
              },
              '&.Mui-disabled': {
                color: '#6b7280',
              },
            },
            '& .MuiInputBase-input': {
              '&::placeholder': {
                color: '#6b7280',
                opacity: 1,
              },
            },
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || !isConnected || isLoadingMessage}
                  sx={{
                    color: inputMessage.trim() && isConnected ? '#3b82f6' : '#6b7280',
                    '&:hover': {
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                    '&.Mui-disabled': {
                      color: '#374151',
                    },
                  }}
                >
                  <SendIcon />
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

