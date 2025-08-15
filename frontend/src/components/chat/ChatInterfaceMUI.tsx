"use client";

import { useState, useRef, useEffect } from "react";
import { 
  Box, 
  Typography, 
  TextField, 
  IconButton, 
  Paper, 
  Avatar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Button,
  Stack,
  useTheme,
  alpha,
  styled,
  CircularProgress
} from "@mui/material";
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  CloudUpload as UploadIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  Security as SecurityIcon,
  MoreVert as MoreVertIcon
} from "@mui/icons-material";

import { useAuth } from "@/contexts/AuthContext";
import GlassCard from "@/components/mui/GlassCard";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
  files?: UploadedFile[];
}

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  content: string;
}

const VisuallyHiddenInput = styled('input')({
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: 1,
  overflow: 'hidden',
  position: 'absolute',
  bottom: 0,
  left: 0,
  whiteSpace: 'nowrap',
  width: 1,
});

const MessageBubble = styled(Paper, {
  shouldForwardProp: (prop) => prop !== "isUser"
})<{ isUser?: boolean }>(({ theme, isUser }) => ({
  padding: theme.spacing(2),
  maxWidth: '70%',
  borderRadius: theme.spacing(2),
  position: 'relative',
  ...(isUser ? {
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
    marginLeft: 'auto',
  } : {
    backgroundColor: alpha(theme.palette.background.paper, 0.9),
    backdropFilter: 'blur(10px)',
    marginRight: 'auto',
  }),
}));

const FilePreview = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(1),
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  backgroundColor: alpha(theme.palette.background.paper, 0.7),
  backdropFilter: 'blur(5px)',
}));

const DropZone = styled(Box, {
  shouldForwardProp: (prop) => prop !== "isDragging"
})<{ isDragging?: boolean }>(({ theme, isDragging }) => ({
  border: `2px dashed ${isDragging ? theme.palette.primary.main : theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(3),
  textAlign: 'center',
  cursor: 'pointer',
  transition: theme.transitions.create(['border-color', 'background-color']),
  backgroundColor: isDragging ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
  '&:hover': {
    borderColor: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
  },
}));

export default function ChatInterfaceMUI() {
  console.log('🎯 ChatInterfaceMUI render function executing');
  
  const theme = useTheme();
  const { user, logout, isLoading: authLoading } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "🚀 Welcome to Enhanced Cosine AI!\n\nI'm your advanced financial assistant with enhanced capabilities:\n\n💬 Chat Features:\n• Natural language financial analysis\n• Stock analysis and market insights\n• Portfolio optimization guidance\n\n📁 File Upload Support:\n• CSV files for portfolio analysis\n• Text files for document analysis\n• Images for chart interpretation\n\n🎯 Try asking:\n• \"Analyze Apple stock\"\n• \"Help me understand portfolio risk\"\n• Upload a CSV with your holdings!\n\nYou can also select different AI models for specialized analysis.",
      sender: "bot",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState("claude-3-sonnet");
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    console.log('🔄 ChatInterfaceMUI component mounted');
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
          sender: "bot",
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
    if (isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputMessage || (uploadedFiles.length > 0 ? `📁 Uploaded ${uploadedFiles.length} file(s): ${uploadedFiles.map(f => f.name).join(', ')}` : ""),
      sender: "user",
      timestamp: new Date(),
      files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    const currentFiles = [...uploadedFiles];
    setUploadedFiles([]);
    setIsLoading(true);

    try {
      // For static export, provide a placeholder response
      // In production, this should point to your actual backend API
      const apiUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL || "https://your-api-gateway-url.com";
      
      const payload = {
        message: inputMessage,
        files: currentFiles,
        model: selectedModel,
        timestamp: new Date().toISOString(),
        type: currentFiles.length > 0 ? 'multimodal' : 'text'
      };

      // Check if we're in development or have a backend URL configured
      if (process.env.NODE_ENV === 'development' || apiUrl !== "https://your-api-gateway-url.com") {
        const response = await fetch(`${apiUrl}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error("Failed to get response");
        }

        const data = await response.json();
        
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: data.response || "I'm sorry, I couldn't process that request. Please try again.",
          sender: "bot",
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, botMessage]);

        if (currentFiles.length > 0 && data.processed_files !== undefined) {
          const infoMessage: Message = {
            id: (Date.now() + 2).toString(),
            text: `✅ Processed: ${data.processed_files || 0} files | Model: ${selectedModel} | Status: ${data.agent_status || 'active'}`,
            sender: "bot",
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, infoMessage]);
        }
      } else {
        // Static export placeholder response
        const placeholderResponses = [
          "I'm a placeholder AI assistant for the static version of Cosine. To enable full chat functionality, please configure the backend API endpoint.",
          "This is a demo version of the chat interface. The full AI assistant requires backend integration with your API Gateway.",
          "Chat functionality is currently in demo mode. Please set up the backend API to enable real AI responses.",
          "Welcome to Cosine! This is a static preview. For full functionality, deploy the backend services and configure the API endpoint."
        ];
        
        const randomResponse = placeholderResponses[Math.floor(Math.random() * placeholderResponses.length)];
        
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: randomResponse,
          sender: "bot",
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, botMessage]);

        // Add info message about backend setup
        const infoMessage: Message = {
          id: (Date.now() + 2).toString(),
          text: `💡 To enable full chat: Set NEXT_PUBLIC_API_GATEWAY_URL environment variable to your backend API endpoint.`,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, infoMessage]);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "I'm experiencing some technical difficulties. Please check your backend API configuration or try again later.",
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <GlassCard>
      <Box sx={{ height: 'calc(100vh - 12rem)', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box sx={{
          p: 3,
          borderBottom: 1,
          borderColor: 'divider',
          background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
          color: 'white',
          borderRadius: '12px 12px 0 0',
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)' }}>
                <BotIcon />
              </Avatar>
              <Box>
                <Typography variant="h6">🤖 Cosine AI Assistant</Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  Enhanced Financial Analysis Companion
                </Typography>
              </Box>
            </Stack>

            <Stack direction="row" spacing={2} alignItems="center">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)', width: 32, height: 32 }}>
                  <PersonIcon />
                </Avatar>
                <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                  <Typography variant="body2">{user?.firstName} {user?.lastName}</Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      {user?.subscription?.plan || 'Free'} Plan
                    </Typography>
                    {user?.mfaEnabled && (
                      <SecurityIcon sx={{ fontSize: 12, color: 'success.light' }} />
                    )}
                  </Stack>
                </Box>
              </Box>

              <IconButton
                onClick={logout}
                sx={{ color: 'white', '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.1)' } }}
              >
                <LogoutIcon />
              </IconButton>

              <FormControl size="small" sx={{ minWidth: 200 }}>
                <Select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  sx={{
                    bgcolor: 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    '& .MuiSelect-icon': { color: 'white' },
                    '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.2)' },
                  }}
                  startAdornment={<SettingsIcon sx={{ mr: 1, opacity: 0.8 }} />}
                >
                  <MenuItem value="claude-3-sonnet">Claude 3 Sonnet (Balanced)</MenuItem>
                  <MenuItem value="claude-3-haiku">Claude 3 Haiku (Fast)</MenuItem>
                  <MenuItem value="gpt-4">GPT-4 (Advanced)</MenuItem>
                  <MenuItem value="gpt-3.5-turbo">GPT-3.5 Turbo (Quick)</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </Box>

          <Stack direction="row" spacing={1}>
            <Chip
              label="💬 Chat Ready"
              size="small"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}
            />
            <Chip
              label="📁 File Upload"
              size="small"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}
            />
            <Chip
              label="🖼️ Image Support"
              size="small"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}
            />
            <Chip
              label="🤖 Multi-AI"
              size="small"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}
            />
          </Stack>
        </Box>

        {/* Messages */}
        <Box sx={{ 
          flex: 1, 
          overflowY: 'auto', 
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}>
          {messages.map((message) => (
            <Box
              key={message.id}
              sx={{
                display: 'flex',
                justifyContent: message.sender === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <Stack
                direction={message.sender === 'user' ? 'row-reverse' : 'row'}
                spacing={1}
                alignItems="flex-start"
              >
                <Avatar
                  sx={{
                    bgcolor: message.sender === 'user' ? 'primary.main' : 'grey.200',
                    width: 32,
                    height: 32,
                  }}
                >
                  {message.sender === 'user' ? <PersonIcon /> : <BotIcon />}
                </Avatar>

                <MessageBubble isUser={message.sender === 'user'}>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                    {message.text}
                  </Typography>

                  {message.files && message.files.length > 0 && (
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {message.files.map((file, index) => (
                        <FilePreview key={index}>
                          {file.type.startsWith('image/') ? (
                            <ImageIcon fontSize="small" color="primary" />
                          ) : (
                            <FileIcon fontSize="small" color="primary" />
                          )}
                          <Typography variant="caption" noWrap>
                            {file.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            ({(file.size / 1024).toFixed(1)}KB)
                          </Typography>
                        </FilePreview>
                      ))}
                    </Stack>
                  )}

                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      mt: 1,
                      color: message.sender === 'user' ? 'primary.light' : 'text.secondary',
                    }}
                  >
                    {message.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Typography>
                </MessageBubble>
              </Stack>
            </Box>
          ))}

          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Avatar sx={{ bgcolor: 'grey.200', width: 32, height: 32 }}>
                  <BotIcon />
                </Avatar>
                <Paper sx={{ p: 2, bgcolor: 'background.paper' }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      component="span"
                      sx={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: 2,
                        borderColor: 'primary.main',
                        borderTopColor: 'transparent',
                        animation: 'spin 1s linear infinite',
                        '@keyframes spin': {
                          '0%': {
                            transform: 'rotate(0deg)',
                          },
                          '100%': {
                            transform: 'rotate(360deg)',
                          },
                        },
                      }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      Processing with {selectedModel}...
                      {uploadedFiles.length > 0 && ` (${uploadedFiles.length} files)`}
                    </Typography>
                  </Stack>
                </Paper>
              </Stack>
            </Box>
          )}
          <div ref={messagesEndRef} />
        </Box>

        {/* Input Area */}
        <Box sx={{ p: 3, borderTop: 1, borderColor: 'divider' }}>
          <DropZone
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            sx={{ mb: 2 }}
          >
            <UploadIcon sx={{ mb: 1, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              📁 Drop files here or <strong>click to upload</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Supports: CSV, TXT, JSON, Images (JPG, PNG) • Max 10MB
            </Typography>
          </DropZone>

          {uploadedFiles.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              {uploadedFiles.map((file, index) => (
                <Chip
                  key={index}
                  icon={file.type.startsWith('image/') ? <ImageIcon /> : <FileIcon />}
                  label={file.name}
                  onDelete={() => removeFile(file.name)}
                  sx={{ bgcolor: 'background.paper' }}
                />
              ))}
            </Stack>
          )}

          <Stack direction="row" spacing={2}>
            <TextField
              fullWidth
              multiline
              minRows={1}
              maxRows={4}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me about stocks, upload files for analysis, or request market insights..."
              disabled={isLoading}
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: 'background.paper',
                },
              }}
            />
            <Button
              variant="contained"
              onClick={handleSendMessage}
              disabled={(!inputMessage.trim() && uploadedFiles.length === 0) || isLoading}
              sx={{
                minWidth: 'auto',
                px: 3,
                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              }}
            >
              {isLoading ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Press Enter to send • Shift+Enter for new line • Drop files to upload • Model: {selectedModel}
          </Typography>

          <VisuallyHiddenInput
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.txt,.json,.jpg,.jpeg,.png,.gif"
            onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
          />
        </Box>
      </Box>
    </GlassCard>
  );
}
