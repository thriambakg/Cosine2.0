import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ENV_CONFIG } from '@/config/environment';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Avatar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Button,
  Stack,
  CircularProgress,
  Card,
  CardContent,
  Alert,
} from '@mui/material';
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  CloudUpload as UploadIcon,
  InsertDriveFile as FileIcon,
  Settings as SettingsIcon,
  MoreVert as MoreVertIcon,
  WifiOff as WifiOffIcon,
  Wifi as WifiIcon,
} from '@mui/icons-material';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  files?: UploadedFile[];
  messageId?: string; // For tracking message delivery
  status?: 'sending' | 'sent' | 'delivered' | 'error';
}

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  content: string;
}

interface WebSocketMessage {
  type: 'connection_established' | 'message_received' | 'ai_response' | 'error' | 'connection_establish';
  message_id?: string;
  session_id?: string;
  content?: string;
  message?: string;
  timestamp?: string;
}

// Custom styled components for Wall Street chic
const GlassCard = ({ children, sx = {}, ...props }: any) => (
  <Card
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
    <CardContent sx={{ p: 0 }}>
      {children}
    </CardContent>
  </Card>
);

const MessageBubble = ({ isUser, children, status, ...props }: any) => (
  <Box
    sx={{
      p: 2,
      maxWidth: '70%',
      borderRadius: '0px',
      position: 'relative',
      ...(isUser ? {
        backgroundColor: '#dc2626',
        color: 'white',
        marginLeft: 'auto',
        border: '1px solid #b91c1c',
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
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      border: '1px solid #3b82f6',
      borderRadius: '0px',
    }}
    {...props}
  >
    {children}
  </Box>
);

const DropZone = ({ isDragging, children, ...props }: any) => (
  <Box
    sx={{
      border: `2px dashed ${isDragging ? '#22c55e' : '#374151'}`,
      borderRadius: '0px',
      p: 3,
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      backgroundColor: isDragging ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
      '&:hover': {
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
      },
    }}
    {...props}
  >
    {children}
  </Box>
);

export default function ChatPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState('claude-3-sonnet');
  const [isDragging, setIsDragging] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [typingMessages, setTypingMessages] = useState<Set<string>>(new Set());
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/');
    }
  }, [user, isLoading, navigate]);

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
          setConnectionError('Failed to reconnect after multiple attempts');
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setConnectionStatus('error');
        setConnectionError('WebSocket connection error');
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setConnectionStatus('error');
      setConnectionError('Failed to create WebSocket connection');
    }
  }, [user?.id]);

  const handleWebSocketMessage = useCallback((data: WebSocketMessage) => {
    switch (data.type) {
      case 'connection_established':
        console.log('🔗 Session established:', data.session_id);
        break;

      case 'message_received':
        // Update message status to delivered
        setMessages(prev => prev.map(msg => 
          msg.messageId === data.message_id 
            ? { ...msg, status: 'delivered' as const }
            : msg
        ));
        break;

      case 'ai_response':
        // Add AI response to messages
        const aiMessage: Message = {
          id: data.message_id || `ai_${Date.now()}`,
          text: data.content || 'No response content',
          sender: 'bot',
          timestamp: new Date(data.timestamp || Date.now()),
        };
        setMessages(prev => [...prev, aiMessage]);
        // Add to typing messages to trigger typing animation
        setTypingMessages(prev => new Set([...prev, aiMessage.id]));
        setIsLoadingChat(false);
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

    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [user?.id, ENV_CONFIG.websocketUrl]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileUpload = (files: FileList) => {
    Array.from(files).forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        const errorMessage: Message = {
          id: Date.now().toString(),
          text: `File "${file.name}" is too large (max 10MB)`,
          sender: 'bot',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const fileData: UploadedFile = {
          name: file.name,
          type: file.type,
          size: file.size,
          content: result.split(',')[1] || result,
        };
        setUploadedFiles((prev) => [...prev, fileData]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (fileName: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.name !== fileName));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() && uploadedFiles.length === 0) return;
    if (isLoadingChat || connectionStatus !== 'connected') return;

    const messageId = `msg_${Date.now()}`;
    const userMessage: Message = {
      id: messageId,
      text: inputMessage || (uploadedFiles.length > 0 ? `📁 Uploaded ${uploadedFiles.length} file(s): ${uploadedFiles.map(f => f.name).join(', ')}` : ''),
      sender: 'user',
      timestamp: new Date(),
      files: uploadedFiles,
      messageId,
      status: 'sending',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setUploadedFiles([]);
    setIsLoadingChat(true);

    // Send message via WebSocket
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      const messageData = {
        type: 'chat',
        message: userMessage.text,
        model: selectedModel,
        files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
      };

      try {
        websocketRef.current.send(JSON.stringify(messageData));
        
        // Update message status to sent
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, status: 'sent' as const }
            : msg
        ));
      } catch (error) {
        console.error('Error sending message:', error);
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, status: 'error' as const }
            : msg
        ));
        setIsLoadingChat(false);
      }
    } else {
      console.error('WebSocket not connected');
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, status: 'error' as const }
          : msg
      ));
      setIsLoadingChat(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getConnectionStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <WifiIcon sx={{ color: '#22c55e' }} />;
      case 'connecting':
        return <CircularProgress size={20} sx={{ color: '#3b82f6' }} />;
      case 'disconnected':
      case 'error':
        return <WifiOffIcon sx={{ color: '#ef4444' }} />;
      default:
        return <WifiOffIcon sx={{ color: '#9ca3af' }} />;
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return 'Connection Error';
      default:
        return 'Unknown';
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
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)' }}>
      {/* Header */}
      <GlassCard sx={{ p: 2, borderBottom: '2px solid #374151' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={2}>
            <Avatar sx={{ bgcolor: '#3b82f6', width: 40, height: 40 }}>
              <BotIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight={700} color="white" sx={{ textTransform: 'uppercase' }}>
                Cosine AI Assistant
              </Typography>
              <Typography variant="body2" color="#3b82f6" sx={{ textTransform: 'uppercase' }}>
                Financial Analysis Expert
              </Typography>
            </Box>
          </Box>
          <Box display="flex" alignItems="center" gap={2}>
            {/* Connection Status */}
            <Box display="flex" alignItems="center" gap={1}>
              {getConnectionStatusIcon()}
              <Typography variant="body2" color="white" sx={{ textTransform: 'uppercase' }}>
                {getConnectionStatusText()}
              </Typography>
            </Box>
            
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel sx={{ color: '#9ca3af' }}>AI Model</InputLabel>
              <Select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                sx={{
                  color: 'white',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#374151',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#22c55e',
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#22c55e',
                  },
                }}
              >
                <MenuItem value="claude-3-sonnet">Claude 3 Sonnet</MenuItem>
                <MenuItem value="claude-3-haiku">Claude 3 Haiku</MenuItem>
                <MenuItem value="gpt-4">GPT-4</MenuItem>
              </Select>
            </FormControl>
            <IconButton sx={{ color: '#9ca3af' }}>
              <SettingsIcon />
            </IconButton>
            <IconButton sx={{ color: '#9ca3af' }}>
              <MoreVertIcon />
            </IconButton>
          </Box>
        </Box>
      </GlassCard>

      {/* Connection Error Alert */}
      {connectionError && (
        <Alert 
          severity="error" 
          sx={{ 
            m: 2, 
            backgroundColor: 'rgba(239, 68, 68, 0.1)', 
            border: '1px solid #ef4444',
            color: '#ef4444'
          }}
          onClose={() => setConnectionError(null)}
        >
          {connectionError}
        </Alert>
      )}

      {/* Messages */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Stack spacing={2}>
          {messages.map((message) => (
            <Box key={message.id} display="flex" gap={2}>
              <Avatar sx={{ bgcolor: message.sender === 'user' ? '#22c55e' : '#374151', width: 32, height: 32 }}>
                {message.sender === 'user' ? <PersonIcon /> : <BotIcon />}
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <MessageBubble isUser={message.sender === 'user'} status={message.status}>
                  {message.sender === 'bot' && typingMessages.has(message.id) ? (
                    <TypingText 
                      text={message.text} 
                      speed={20}
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
                  {message.files && message.files.length > 0 && (
                    <Stack spacing={1} mt={1}>
                      {message.files.map((file) => (
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
                </MessageBubble>
                <Typography variant="caption" color="#9ca3af" sx={{ ml: 1, textTransform: 'uppercase' }}>
                  {message.timestamp.toLocaleTimeString()}
                </Typography>
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

      {/* File Upload Area */}
      {uploadedFiles.length > 0 && (
        <Box sx={{ p: 2, borderTop: '1px solid #374151' }}>
          <Typography variant="body2" color="#9ca3af" mb={1} sx={{ textTransform: 'uppercase' }}>
            Uploaded Files:
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {uploadedFiles.map((file) => (
              <Chip
                key={file.name}
                label={file.name}
                onDelete={() => removeFile(file.name)}
                sx={{
                  bgcolor: 'rgba(34, 197, 94, 0.1)',
                  color: '#22c55e',
                  border: '1px solid #22c55e',
                  borderRadius: '0px',
                  '& .MuiChip-deleteIcon': {
                    color: '#22c55e',
                  },
                }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Input Area */}
      <GlassCard sx={{ p: 2, borderTop: '2px solid #374151' }}>
        <DropZone
          isDragging={isDragging}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.txt,.pdf,.png,.jpg,.jpeg"
            onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
            style={{ display: 'none' }}
          />
          <UploadIcon sx={{ fontSize: 48, color: '#22c55e', mb: 1 }} />
          <Typography variant="body1" color="white" sx={{ textTransform: 'uppercase' }}>
            Drop files here or click to upload
          </Typography>
          <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
            Supports CSV, TXT, PDF, PNG, JPG (max 10MB each)
          </Typography>
        </DropZone>
        
        <Box display="flex" gap={1} mt={2}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about finance, stocks, or portfolio analysis..."
            disabled={connectionStatus !== 'connected'}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: 'white',
                borderRadius: '0px',
                '& fieldset': {
                  borderColor: '#374151',
                },
                '&:hover fieldset': {
                  borderColor: '#22c55e',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#22c55e',
                },
                '&.Mui-disabled': {
                  backgroundColor: 'rgba(55, 65, 81, 0.3)',
                },
              },
              '& .MuiInputBase-input::placeholder': {
                color: '#9ca3af',
                opacity: 1,
              },
            }}
          />
          <Button
            variant="contained"
            onClick={handleSendMessage}
            disabled={isLoadingChat || (!inputMessage.trim() && uploadedFiles.length === 0) || connectionStatus !== 'connected'}
            sx={{
              bgcolor: '#22c55e',
              color: 'white',
              borderRadius: '0px',
              minWidth: 48,
              height: 48,
              '&:hover': {
                bgcolor: '#16a34a',
              },
              '&:disabled': {
                bgcolor: '#374151',
                color: '#9ca3af',
              },
            }}
          >
            <SendIcon />
          </Button>
        </Box>
      </GlassCard>
    </Box>
  );
}
