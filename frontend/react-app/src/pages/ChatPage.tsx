import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
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
} from '@mui/material';
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  CloudUpload as UploadIcon,
  InsertDriveFile as FileIcon,

  Settings as SettingsIcon,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  files?: UploadedFile[];
}

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  content: string;
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

const MessageBubble = ({ isUser, children, ...props }: any) => (
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
  </Box>
);

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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: '🚀 Welcome to Enhanced Cosine AI!\n\nI\'m your advanced financial assistant with enhanced capabilities:\n\n💬 Chat Features:\n• Natural language financial analysis\n• Stock analysis and market insights\n• Portfolio optimization guidance\n\n📁 File Upload Support:\n• CSV files for portfolio analysis\n• Text files for document analysis\n• Images for chart interpretation\n\n🎯 Try asking:\n• "Analyze Apple stock"\n• "Help me understand portfolio risk"\n• Upload a CSV with your holdings!\n\nYou can also select different AI models for specialized analysis.',
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState('claude-3-sonnet');
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/login');
    }
  }, [user, isLoading, navigate]);

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
    if (isLoadingChat) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputMessage || (uploadedFiles.length > 0 ? `📁 Uploaded ${uploadedFiles.length} file(s): ${uploadedFiles.map(f => f.name).join(', ')}` : ''),
      sender: 'user',
      timestamp: new Date(),
      files: uploadedFiles,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setUploadedFiles([]);
    setIsLoadingChat(true);

    // Simulate AI response
    setTimeout(() => {
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Thank you for your message! I\'m here to help with your financial analysis and portfolio optimization. How can I assist you today?',
        sender: 'bot',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      setIsLoadingChat(false);
    }, 2000);
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
          <Box display="flex" alignItems="center" gap={1}>
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

      {/* Messages */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Stack spacing={2}>
          {messages.map((message) => (
            <Box key={message.id} display="flex" gap={2}>
              <Avatar sx={{ bgcolor: message.sender === 'user' ? '#22c55e' : '#374151', width: 32, height: 32 }}>
                {message.sender === 'user' ? <PersonIcon /> : <BotIcon />}
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <MessageBubble isUser={message.sender === 'user'}>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
                    {message.text}
                  </Typography>
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
            disabled={isLoadingChat || (!inputMessage.trim() && uploadedFiles.length === 0)}
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
