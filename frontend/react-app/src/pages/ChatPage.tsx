import { useEffect, useState, useRef, useCallback, memo, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useChatPersistence } from '@/hooks/useChatPersistence';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import { sessionManagementAPI } from '@/services/api';
import { API_CONFIG } from '@/config/api';
import { ContextItem } from '@/components/tiles/common/contextManager';
import TutorialHelpIcon from '@/components/common/TutorialHelpIcon';
import ContextItemRow from '@/components/context/ContextItemRow';
// NEW: Import shared file upload service
import { FileUploadService, UploadedFile } from '@/services/fileUploadService';
// NEW: Import unified messaging system
import { useUnifiedMessaging } from '@/hooks/useUnifiedMessaging';
import { unifiedMessageHandler } from '@/services/unifiedMessageHandler';
import { usePersistentModel } from '@/hooks/usePersistentModel';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Avatar,
  SelectChangeEvent,
  Menu,
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
  Stop as StopIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  InsertDriveFile as FileIcon,
  AttachFile as AttachFileIcon,
  Chat as ChatIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Dashboard as ContextIcon,
  Chat as SidebarChatIcon,
  OpenInNew as OpenInNewIcon,
  Download as DownloadIcon,
  SmartToy as SmartToyIcon,
  Share as ShareIcon,
  Upload as UploadIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  ViewList as QueueIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import ChatImportExportDialog from '@/components/dialogs/ChatImportExportDialog';

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
      p: 1, // 8px padding to match input area
      borderRadius: 0.5, // 4px to match input area
      backgroundColor: isUser 
        ? 'rgba(59, 130, 246, 0.2)' 
        : 'rgba(255, 255, 255, 0.1)',
      border: isUser 
        ? '1px solid rgba(59, 130, 246, 0.3)' 
        : '1px solid rgba(255, 255, 255, 0.2)',
      position: 'relative',
    }}
    {...props}
  >
    {children}
    {isUser && status && (
      <Box sx={{ 
        position: 'absolute',
        bottom: 4,
        right: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5
      }}>
        {status === 'sending' && (
          <CircularProgress 
            size={12} 
            sx={{ 
              color: 'rgba(59, 130, 246, 0.6)',
              '& .MuiCircularProgress-circle': {
                strokeWidth: 2
              }
            }} 
          />
        )}
        {status === 'sent' && (
          <Typography 
            variant="caption" 
            sx={{ 
              color: 'rgba(59, 130, 246, 0.6)', 
              fontSize: '10px', 
              fontWeight: 400,
              lineHeight: 1
            }}
          >
            ✓
          </Typography>
        )}
        {status === 'delivered' && (
          <Typography 
            variant="caption" 
            sx={{ 
              color: 'rgba(59, 130, 246, 0.6)', 
              fontSize: '10px', 
              fontWeight: 400,
              lineHeight: 1
            }}
          >
            ✓✓
          </Typography>
        )}
        {status === 'error' && (
          <Typography 
            variant="caption" 
            sx={{ 
              color: '#EF4444', 
              fontSize: '10px', 
              fontWeight: 400,
              lineHeight: 1
            }}
          >
            ✗
          </Typography>
        )}
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


// Hoisted input bar to preserve local state across parent re-renders
const ChatMessageInputBar = memo(({ disabled, placeholder, onSend, onFileClick, onModelClick, modelLabel, isLoading, onStop }: { disabled: boolean; placeholder: string; onSend: (text: string) => void; onFileClick: () => void; onModelClick: (e: React.MouseEvent<HTMLElement>) => void; modelLabel: string; isLoading?: boolean; onStop?: () => void }) => {
  const [value, setValue] = useState('');
  const [isSending, setIsSending] = useState(false); // Track local sending state to prevent double-clicks
  
  const onSendClick = () => {
    if (value.trim() && !isSending) {
      setIsSending(true); // Set local sending state immediately
      onSend(value);
      setValue('');
      // Clear sending state after a short delay to prevent accidental double-clicks
      setTimeout(() => setIsSending(false), 500);
    }
  };
  
  const onKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Always allow sending - the onSend handler will queue if loading
      onSendClick();
    }
  };
  return (
    <Box sx={{ width: '100%', '& *:focus': { outline: 'none !important' } }}>
      {/* Message Area */}
      <TextField
        fullWidth
        multiline
        variant="standard"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyPress={onKeyPress}
        placeholder={placeholder}
        disabled={false}
        InputProps={{
          readOnly: false,
          disableUnderline: true,
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        sx={{
          '& .MuiInput-root': {
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none !important',
            boxShadow: 'none !important',
            maxHeight: '50vh',
            overflowY: 'auto',
            '&:before': {
              display: 'none',
            },
            '&:after': {
              display: 'none',
            },
            '&:hover:before': {
              display: 'none',
            },
            '&:focus': {
              outline: 'none !important',
              boxShadow: 'none !important',
            },
            '&:focus-within': {
              outline: 'none !important',
              boxShadow: 'none !important',
            },
            '&.Mui-focused': {
              outline: 'none !important',
              boxShadow: 'none !important',
              '&:before': {
                display: 'none',
              },
              '&:after': {
                display: 'none',
              },
            },
            // Scrollbar styling to match message area
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
          '& .MuiInput-input': {
            color: '#ffffff',
            fontSize: '0.875rem',
            paddingTop: '3px',
            paddingBottom: '3px',
            paddingLeft: '3px',
            paddingRight: '3px',
            lineHeight: '1.5',
            outline: 'none !important',
            border: 'none !important',
            '&:focus': {
              outline: 'none !important',
              border: 'none !important',
              boxShadow: 'none !important',
            },
            '&::placeholder': {
              color: '#6b7280',
              opacity: 1,
            },
          },
          // Scrollbar styling to match main scroll area (for multiline textarea)
          '& textarea': {
            outline: 'none !important',
            border: 'none !important',
            resize: 'none',
            boxShadow: 'none !important',
            maxHeight: '50vh',
            overflowY: 'auto',
            '&:focus': {
              outline: 'none !important',
              border: 'none !important',
              boxShadow: 'none !important',
            },
            '&:focus-visible': {
              outline: 'none !important',
              border: 'none !important',
              boxShadow: 'none !important',
            },
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
      {/* Icons Row - Below Message Area */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
        {/* Left Side - Model Selection and Paperclip */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {/* Model Selection Bubble Dropdown */}
          <Box 
            sx={{ 
              px: 1.25,
              py: 0.5,
              borderRadius: '9999px', // Pill shape
              backgroundColor: 'rgba(55, 65, 81, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'inline-flex',
              alignItems: 'center',
              minWidth: 'fit-content',
              '&:hover': {
                backgroundColor: 'rgba(55, 65, 81, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              },
            }}
            onClick={(e) => {
              e.stopPropagation();
              onModelClick(e);
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: '#e5e7eb',
                fontSize: '0.7rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}
            >
              {modelLabel}
            </Typography>
          </Box>
          {/* File Upload Icon */}
          <Tooltip title="Upload files">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onFileClick();
              }}
              sx={{
                color: '#9ca3af',
                padding: '4px',
                '&:hover': {
                  color: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
              }}
            >
              <AttachFileIcon sx={{ fontSize: '0.9rem' }} />
            </IconButton>
          </Tooltip>
        </Box>
        {/* Right Side - Send/Stop Button */}
        <Tooltip title={isLoading ? "Stop processing" : "Send (Enter)"}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault(); // Prevent any default behavior
              
              // Use isLoading (from parent) to determine if we should stop or send
              // isLoading reflects the actual backend processing state
              if (isLoading && onStop) {
                console.log('🛑 ChatPage input: Stop button clicked');
                onStop();
              } else if (!isSending) {
                // Only send if we're not already in the process of sending
                console.log('📤 ChatPage input: Send button clicked');
                onSendClick();
              }
            }}
            disabled={!isLoading && (disabled || !value.trim() || isSending)}
            sx={{
              color: isLoading 
                ? '#ef4444' 
                : (value.trim() && !isSending ? '#22c55e' : '#6b7280'),
              padding: '4px',
              transition: 'all 0.2s ease',
              '&:hover': { 
                color: isLoading 
                  ? '#dc2626' 
                  : (value.trim() ? '#16a34a' : '#6b7280'),
                backgroundColor: isLoading 
                  ? 'rgba(239, 68, 68, 0.1)' 
                  : (value.trim() ? 'rgba(34, 197, 94, 0.1)' : 'transparent'),
              },
            }}
          >
            {isLoading ? (
              <StopIcon sx={{ fontSize: '0.9rem' }} />
            ) : (
              <SendIcon sx={{ fontSize: '0.9rem' }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
});

// Memoized edit input component to prevent re-renders on every keystroke
const MessageEditInput = memo(({ 
  value, 
  onChange, 
  onSave, 
  onCancel,
  isLoading,
  onStop,
}: { 
  value: string; 
  onChange: (value: string) => void; 
  onSave: () => void; 
  onCancel: () => void;
  isLoading?: boolean;
  onStop?: () => void;
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
        variant="standard"
        InputProps={{
          disableUnderline: true,
        }}
        sx={{
          '& .MuiInput-root': {
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none !important',
            boxShadow: 'none !important',
            padding: 0,
            margin: 0,
            paddingRight: '60px',
            '&:before': {
              display: 'none',
            },
            '&:after': {
              display: 'none',
            },
            '&:hover:before': {
              display: 'none',
            },
            '&:focus': {
              outline: 'none !important',
              boxShadow: 'none !important',
            },
            '&:focus-within': {
              outline: 'none !important',
              boxShadow: 'none !important',
            },
            '&.Mui-focused': {
              outline: 'none !important',
              boxShadow: 'none !important',
              '&:before': {
                display: 'none',
              },
              '&:after': {
                display: 'none',
              },
            },
          },
          '& .MuiInput-input': {
            color: '#ffffff',
            fontSize: '0.875rem',
            padding: '3px',
            lineHeight: '1.5',
            outline: 'none !important',
            border: 'none !important',
            '&:focus': {
              outline: 'none !important',
              border: 'none !important',
              boxShadow: 'none !important',
            },
          },
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '3px', // Align with text input top padding (3px) for single line
          right: 8,
          display: 'flex',
          gap: 0.5,
          alignItems: 'center',
          justifyContent: 'center',
          height: 'fit-content',
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
        <Tooltip title={isLoading ? "Stop processing" : "Send (Enter)"}>
          <span>
            <IconButton
              size="small"
              onClick={() => {
                if (isLoading && onStop) {
                  onStop();
                } else {
                  onSave();
                }
              }}
              disabled={!isLoading && !value.trim()}
              sx={{
                color: isLoading 
                  ? '#ef4444' 
                  : (value.trim() ? '#22c55e' : '#6b7280'),
                transition: 'all 0.2s ease',
                '&:hover': { 
                  color: isLoading 
                    ? '#dc2626' 
                    : (value.trim() ? '#16a34a' : '#6b7280'),
                  backgroundColor: isLoading 
                    ? 'rgba(239, 68, 68, 0.1)' 
                    : (value.trim() ? 'rgba(34, 197, 94, 0.1)' : 'transparent'),
                },
                width: 28,
                height: 28,
              }}
            >
              {isLoading ? (
                <StopIcon sx={{ fontSize: 16 }} />
              ) : (
                <SendIcon sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
});

export default function ChatPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  // const { startTutorial } = useTutorial?.() ?? { startTutorial: () => {} };
  // Clock context available if needed in the future
  // const { clockTimezone, clockMilitaryTime } = useClock();
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
    updateSessionAgentFiles,
    updateSessionVariables,
    loadSessionsFromBackend,
  } = useChatPersistence(user?.id || '');
  
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const { selectedModel, setSelectedModel } = usePersistentModel();
  
  // Available models with nicknames, tooltips, and cost indicators (1-4 scale)
  const availableModels = [
    { value: 'claude-haiku-4-5', label: 'Fast', tooltip: 'Fastest, most compact model for near-instant responsiveness', cost: 1 },
    { value: 'gpt-oss-20b', label: 'Smart', tooltip: 'Intelligent reasoning, complex problem-solving, efficient', cost: 2 },
    { value: 'claude-sonnet-4', label: 'Balanced', tooltip: 'Strikes ideal balance between intelligence and speed', cost: 3 },
    { value: 'nova-lite', label: 'Multimodal', tooltip: 'Multimodal understanding model for text, images, and videos', cost: 3 },
    { value: 'gpt-oss-120b', label: 'Deep', tooltip: 'Complex reasoning, extended thinking, sophisticated analysis', cost: 4 },
  ];

  const handleModelChange = (event: SelectChangeEvent) => {
    setSelectedModel(event.target.value);
  };
  
  const [missedResponseNotification] = useState<string | null>(null);
  // Typing messages for AI response animation
  const [typingMessages, setTypingMessages] = useState<Set<string>>(new Set());
  // Track streaming completion via custom event
  const [isStreamingActive, setIsStreamingActive] = useState(false);
  // Track if input should be centered (for empty session animation)
  const [isInputCentered, setIsInputCentered] = useState(true);
  // Message queue for sequential processing
  const [messageQueue, setMessageQueue] = useState<Array<{
    text: string;
    files?: UploadedFile[];
    context?: ContextItem[];
    model: string;
    type: 'file' | 'context' | 'followup' | 'new';
  }>>([]);
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const isProcessingQueueRef = useRef(false);
  
  // Session-specific state tracking
  const [sessionLoadingStates, setSessionLoadingStates] = useState<Record<string, boolean>>({});
  const [pendingMessages, setPendingMessages] = useState<Record<string, Message[]>>({});
  const [agentLogs, setAgentLogs] = useState<Record<string, string>>({}); // sessionId -> current agent log message
  // Removed unused state variables
  
  // Helper function to get current session loading state
  const getCurrentSessionLoading = useCallback(() => {
    return currentSession?.session_id ? sessionLoadingStates[currentSession.session_id] || false : false;
  }, [currentSession?.session_id, sessionLoadingStates]);
  
  // Sidebar state with persistence - closed by default on first load (no session)
  // but remember user's preference after they interact with it
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // On first load, only open sidebar if there's a loaded session
    // After first interaction, use persisted preference
    try {
      const saved = localStorage.getItem('chatpage_sidebarOpen');
      if (saved !== null) {
        return JSON.parse(saved);
      }
      // Default: closed (false) - user will see chat interface first
      return false;
    } catch {
      return false;
    }
  });
  const [sidebarUserOverride, setSidebarUserOverride] = useState(() => {
    try {
      const saved = localStorage.getItem('chatpage_sidebarUserOverride');
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('chatpage_sidebarCollapsed');
      if (saved !== null) {
        return JSON.parse(saved);
      }
      return false;
    } catch {
      return false;
    }
  });
  
  // Persist sidebar state when it changes
  useEffect(() => {
    try {
      localStorage.setItem('chatpage_sidebarOpen', JSON.stringify(sidebarOpen));
    } catch {
      console.warn('Failed to persist sidebarOpen state');
    }
  }, [sidebarOpen]);
  
  // Auto-start tutorial for first-time users - DISABLED FOR NOW
  // React.useEffect(() => {
  //   const hasCompletedChatTutorial = localStorage.getItem('cosine_tutorial_page_chat');
  //   if (!hasCompletedChatTutorial) {
  //     const timer = setTimeout(() => {
  //       startTutorial('chat');
  //     }, 1500);
  //     return () => clearTimeout(timer);
  //   }
  // }, [startTutorial]);
  
  // Listen for tutorial start event to open sidebar
  useEffect(() => {
    const handleTutorialStart = (event: CustomEvent) => {
      if (event.detail.page === 'chat') {
        setSidebarOpen(true);
        setSidebarCollapsed(false);
      }
    };
    
    window.addEventListener('tutorial-started', handleTutorialStart as EventListener);
    return () => {
      window.removeEventListener('tutorial-started', handleTutorialStart as EventListener);
    };
  }, []);
  
  useEffect(() => {
    try {
      localStorage.setItem('chatpage_sidebarCollapsed', JSON.stringify(sidebarCollapsed));
    } catch {
      console.warn('Failed to persist sidebarCollapsed state');
    }
  }, [sidebarCollapsed]);

  const markSidebarUserOverride = useCallback(() => {
    setSidebarUserOverride(true);
    try {
      localStorage.setItem('chatpage_sidebarUserOverride', 'true');
    } catch {
      console.warn('Failed to persist sidebar override');
    }
  }, []);

  const handleSidebarOpen = useCallback(() => {
    markSidebarUserOverride();
    setSidebarOpen(true);
  }, [markSidebarUserOverride]);

  const handleSidebarClose = useCallback(() => {
    markSidebarUserOverride();
    setSidebarOpen(false);
  }, [markSidebarUserOverride]);
  
  // Auto-open sidebar when a session is loaded (except on first load)
  useEffect(() => {
    if (currentSession?.session_id && sessions.length > 0 && !sidebarOpen && !sidebarUserOverride) {
      // Open sidebar when user loads a chat session
      setSidebarOpen(true);
    }
  }, [currentSession?.session_id, sessions.length, sidebarOpen, sidebarUserOverride]);
  
  // Persist current session ID so it reloads when user comes back
  useEffect(() => {
    if (currentSession?.session_id) {
      try {
        localStorage.setItem('chatpage_lastSessionId', currentSession.session_id);
        console.log('💾 ChatPage: Saved last session ID:', currentSession.session_id);
      } catch {
        console.warn('Failed to persist current session ID');
      }
    }
  }, [currentSession?.session_id]);
  
  // Restore last session when sessions are loaded for the first time
  useEffect(() => {
    if (sessions.length > 0 && !currentSession?.session_id && persistenceLoading === false) {
      try {
        const savedSessionId = localStorage.getItem('chatpage_lastSessionId');
        if (savedSessionId && sessions.some(s => s.session_id === savedSessionId)) {
          console.log('📂 ChatPage: Restoring last session:', savedSessionId);
          // Use useCallback-wrapped functions without adding to dependencies to prevent infinite loops
          (async () => {
            await loadSession(savedSessionId);
            await loadSessionFromDatabase(savedSessionId);
          })();
        }
      } catch {
        console.warn('Failed to restore last session');
      }
    }
    // Only depend on sessions length and currentSession to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, currentSession?.session_id, persistenceLoading]);
  
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Session selection for context
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  
  // Context menu for sessions
  const [sessionContextMenu, setSessionContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);
  
  // Message editing state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  
  // Context state
  const [sessionContext, setSessionContext] = useState<ContextItem[]>([]);
  const previousContextRef = useRef<ContextItem[]>([]);
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false);
  const [isFilesDrawerOpen, setIsFilesDrawerOpen] = useState(false);
  const [shareMenuAnchor, setShareMenuAnchor] = useState<null | HTMLElement>(null);
  const [importExportDialogOpen, setImportExportDialogOpen] = useState(false);
  const [importExportMode, setImportExportMode] = useState<'import' | 'export'>('export');
  const headerHeight = 64; // Top navigation bar height
  const handleRemoveContextItem = useCallback(async (index: number) => {
    const newContext = sessionContext.filter((_, i) => i !== index);
    setSessionContext(newContext);
    console.log(`🗑️ Removed context item: ${sessionContext[index]?.title}`);
    if (currentSession?.session_id) {
      const syncEvent = new CustomEvent('session-context-updated', {
        detail: { sessionId: currentSession.session_id, contextItems: newContext }
      });
      window.dispatchEvent(syncEvent);
    }
    if (currentSession?.session_id && user?.id) {
      try {
        // Log context items before sending to verify data field is present
        console.log('📤 ChatPage: Sending context items to backend:', {
          count: newContext.length,
          items: newContext.map(item => ({
            id: item.id,
            type: item.type,
            title: item.title,
            has_data: !!item.data,
            data_keys: item.data ? Object.keys(item.data) : [],
            data_s3_key: item.data?.s3_key,
            full_data: item.data
          }))
        });
        
        await sessionManagementAPI.updateSession(currentSession.session_id, user.id, {
          session_variables: {
            context_items: newContext,
            context_added_at: Date.now(),
          }
        });
        console.log('✅ Updated context in backend');
        updateSessionContext(currentSession.session_id, newContext);
      } catch (error) {
        console.error('❌ Failed to update context in backend:', error);
      }
    }
  }, [sessionContext, currentSession?.session_id, user?.id, updateSessionContext]);
  
  // Function to detect if context has changed
  const hasContextChanged = useCallback(() => {
    const currentContext = sessionContext;
    const previousContext = previousContextRef.current;
    
    // Context change detection
    
    // Compare lengths first (quick check)
    if (currentContext.length !== previousContext.length) {
      console.log(`📋 ChatPage: Context length changed: ${previousContext.length} → ${currentContext.length}`);
      return true;
    }
    
    // Compare each item by ID and timestamp
    for (let i = 0; i < currentContext.length; i++) {
      const current = currentContext[i];
      const previous = previousContext[i];
      
      if (!previous || 
          current.id !== previous.id || 
          current.timestamp !== previous.timestamp) {
        console.log(`📋 ChatPage: Context item changed at index ${i}:`, { current, previous });
        return true;
      }
    }
    
      // No context changes detected
    return false;
  }, [sessionContext]);
  
  // Update previous context when session changes (but not on every sessionContext change)
  useEffect(() => {
    if (currentSession?.session_id) {
      // Only update if this is a new session, not a context change
      if (previousContextRef.current.length === 0) {
        previousContextRef.current = [...sessionContext];
        // Initial context set for new session
      }
    }
  }, [currentSession?.session_id]);
  
  // Measure input area height to set messages container padding
  useEffect(() => {
    const measureInputArea = () => {
      if (inputAreaRef.current && !isInputCentered) {
        const height = inputAreaRef.current.offsetHeight;
        setInputAreaHeight(height);
      } else {
        // When centered, no padding needed
        setInputAreaHeight(0);
      }
    };
    measureInputArea();
    window.addEventListener('resize', measureInputArea);
    // Also measure when queue expands/collapses or files change
    return () => {
      window.removeEventListener('resize', measureInputArea);
    };
  }, [isInputCentered, uploadedFiles, messageQueue]);
  
  // NEW: Unified messaging system for centralized message handling
  const {
    messages: unifiedMessages,
    isProcessing: isUnifiedProcessing,
    crossInterfaceLoading,
    sendMessage: sendUnifiedMessage,
    sendContextMessage: sendUnifiedContextMessage,
    sendFileMessage: sendUnifiedFileMessage,
    sendEditMessage: sendUnifiedEditMessage
  } = useUnifiedMessaging({
    sessionId: currentSession?.session_id || null,
    userId: user?.id,
    source: 'chatpage',
    onMessageUpdate: (update) => {
      console.log('📨 ChatPage: Received unified message update:', update.type);
    }
  });

  // Use messages from unified messaging system (real-time) as primary source
  // Fall back to persistence system for initial load or when unified messages aren't available
  // Merge both sources to ensure we show all messages
  // Memoize persistenceMessages to prevent unnecessary recalculations
  const persistenceMessages = useMemo(() => {
    return currentSession?.messages || [];
  }, [currentSession?.messages, currentSession?.session_id]);
  
  const unifiedMessageList = unifiedMessages || [];
  
  // Create a merged list, prioritizing unified messages (real-time) but including persistence messages
  // Use a Map to deduplicate by message ID, with unified messages taking precedence
  // Memoize to prevent unnecessary recalculations
  const messages = useMemo(() => {
    const messageMap = new Map<string, any>();
    const currentSessionId = currentSession?.session_id;
    
    // First add persistence messages (for initial load)
    persistenceMessages.forEach(msg => {
      messageMap.set(msg.id, {
        id: msg.id,
        sender: msg.sender === 'bot' ? 'ai' : msg.sender,
        text: msg.text,
        timestamp: msg.timestamp instanceof Date ? msg.timestamp.getTime() : (typeof msg.timestamp === 'number' ? msg.timestamp : Date.now()),
        sessionId: currentSessionId || '',
        source: 'database' as const,
        files: msg.files
      });
    });
    
    // Then add/override with unified messages (real-time updates) for the current session
    // Filter by sessionId to ensure we only show messages for the current session
    // If no currentSessionId, show all unified messages (for new sessions being created)
    const filteredUnified = currentSessionId 
      ? unifiedMessageList.filter(msg => msg.sessionId === currentSessionId)
      : unifiedMessageList;
    
    filteredUnified.forEach(msg => {
      messageMap.set(msg.id, msg);
    });
    
    // Convert to sorted array
    const merged = Array.from(messageMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    
    return merged;
  }, [persistenceMessages, unifiedMessageList, currentSession?.session_id]);

  // Update input centered state based on messages
  useEffect(() => {
    const shouldBeCentered = messages.length === 0 && (!currentSession || currentSession.messages.length === 0);
    if (shouldBeCentered !== isInputCentered) {
      setIsInputCentered(shouldBeCentered);
    }
  }, [messages.length, currentSession?.messages?.length, isInputCentered, currentSession]);

  // Sync unified messages with local persistence system (DEBOUNCED for performance)
  // This runs asynchronously to avoid blocking message display
  useEffect(() => {
    if (!currentSession?.session_id || unifiedMessages.length === 0) return;

    // Debounce persistence sync to avoid blocking UI updates
    // Messages are displayed immediately from unified cache, persistence happens in background
    const syncTimeout = setTimeout(() => {
      // Sync unified messages with persistence (debounced)

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
            addPersistedMessage({
              id: unifiedMsg.id,
              text: unifiedMsg.text,
              sender: unifiedMsg.sender === 'ai' ? 'bot' : unifiedMsg.sender,
              timestamp: new Date(unifiedMsg.timestamp),
              files: unifiedMsg.files
            });
          });
        });
      } else {
        // All messages already synced
      }
    }, 100); // 100ms debounce - messages display immediately, persistence happens shortly after

    return () => clearTimeout(syncTimeout);
  }, [unifiedMessages, currentSession?.session_id, currentSession?.messages, addPersistedMessage]);

  // Load session from database (for refreshing after agent file returns)
  const loadSessionFromDatabase = useCallback(async (sessionId: string) => {
    if (!user?.id) return;

    try {
      console.log('📋 ChatPage: Loading session from database:', sessionId);
      const session = await sessionManagementAPI.getSession(sessionId, user.id);
      
      if (session) {
        console.log('✅ ChatPage: Session loaded from database successfully:', {
          sessionId: session.session_id,
          messageCount: session.messages?.length || 0,
          hasContext: !!session.session_variables?.context_items
        });
        
        // Update current session via persistence system
        // Note: currentSession is managed by useChatPersistence, we just need to reload
        // Don't reset model - keep user's persistent selection

        // Load existing messages into unified messaging system
        if (session.messages && session.messages.length > 0) {
          console.log('📨 ChatPage: Loading existing messages into unified system:', session.messages.length);
          unifiedMessageHandler.loadExistingMessages(sessionId, session.messages);
        }

        // Load context if available
        if (session.session_variables?.context_items) {
          setSessionContext(session.session_variables.context_items);
        } else {
          setSessionContext([]);
        }
        
        console.log('✅ ChatPage: Session data loaded');
      } else {
        console.log('⚠️ ChatPage: Session not found in database');
      }
    } catch (error: any) {
      console.error('❌ ChatPage: Failed to load session:', error);
    }
  }, [user?.id, setSessionContext]);

  // Process next message in queue
  const processNextMessageInQueue = useCallback(async () => {
    // Wait for streaming to complete (typingMessages should be empty AND streaming complete event received)
    const isStreamingComplete = typingMessages.size === 0 && !isStreamingActive;
    if (isProcessingQueueRef.current || messageQueue.length === 0 || getCurrentSessionLoading() || isUnifiedProcessing || !isStreamingComplete) {
      return;
    }

    isProcessingQueueRef.current = true;
    // Get the first message but DON'T remove it yet - wait until it's successfully sent
    const nextMessage = messageQueue[0];
    
    console.log('📬 ChatPage: Processing queued message:', nextMessage.type, 'Queue length:', messageQueue.length);
    
    try {
      const sessionId = currentSession?.session_id || 'pending';
      setSessionLoadingStates(prev => ({
        ...prev,
        [sessionId]: true
      }));
      unifiedMessageHandler.broadcastLoadingState(sessionId, true, 'chatpage');

      let result;
      if (nextMessage.type === 'file' && nextMessage.files) {
        result = await sendUnifiedFileMessage(nextMessage.text, nextMessage.files as unknown as File[], nextMessage.model);
      } else if (nextMessage.type === 'context' && nextMessage.context) {
        result = await sendUnifiedContextMessage(nextMessage.text, nextMessage.context, nextMessage.model);
      } else if (nextMessage.type === 'followup' && currentSession?.session_id) {
        // Send followup as context_message with empty context for consistency
        result = await sendUnifiedContextMessage(nextMessage.text, [], nextMessage.model);
      } else {
        result = await sendUnifiedMessage({ text: nextMessage.text, model: nextMessage.model, type: 'new_message' });
      }

      if (result.success) {
        console.log('✅ ChatPage: Queued message sent successfully');
        
        // Remove from queue only after successful send
        setMessageQueue(prev => {
          if (prev.length > 0 && prev[0] === nextMessage) {
            return prev.slice(1);
          }
          return prev;
        });
        
        // Handle session creation if needed (same logic as regular send)
        if (result.sessionId && result.sessionId !== currentSession?.session_id) {
          await loadSession(result.sessionId);
          await loadSessionFromDatabase(result.sessionId);
        }
      } else {
        console.error('❌ ChatPage: Failed to send queued message:', result.error);
        const errorSessionId = result.sessionId || currentSession?.session_id || 'pending';
        setSessionLoadingStates(prev => ({
          ...prev,
          [errorSessionId]: false
        }));
        unifiedMessageHandler.broadcastLoadingState(errorSessionId, false, 'chatpage');
        
        // Remove failed message from queue to prevent blocking
        setMessageQueue(prev => prev.filter((_, i) => i !== 0));
      }
    } catch (error) {
      console.error('❌ ChatPage: Error processing queued message:', error);
      const errorSessionId = currentSession?.session_id || 'pending';
      setSessionLoadingStates(prev => ({
        ...prev,
        [errorSessionId]: false
      }));
      unifiedMessageHandler.broadcastLoadingState(errorSessionId, false, 'chatpage');
    } finally {
      isProcessingQueueRef.current = false;
    }
  }, [messageQueue, currentSession?.session_id, getCurrentSessionLoading, isUnifiedProcessing, isStreamingActive, typingMessages, sendUnifiedFileMessage, sendUnifiedContextMessage, sendUnifiedMessage, loadSession, loadSessionFromDatabase]);

  // Subscribe to loading state updates from unified messaging system
  useEffect(() => {
    // Subscribe to agent log updates
    const unsubscribeAgentLog = unifiedMessageHandler.onAgentLogUpdate((sessionId, logMessage) => {
      setAgentLogs(prev => {
        if (logMessage) {
          return { ...prev, [sessionId]: logMessage };
        } else {
          const updated = { ...prev };
          delete updated[sessionId];
          return updated;
        }
      });
    });

    const unsubscribe = unifiedMessageHandler.subscribeToLoadingState((sessionId, isLoading, source) => {
      // Update for chatpage source OR cross-interface loading (for universal edit updates)
      // Also update for current session to ensure universal visibility of edits
      const isCurrentSession = sessionId === currentSession?.session_id;
      if (source === 'chatpage' || (source === 'sidebar' && isLoading) || (isCurrentSession && isLoading)) {
        console.log(`🔄 ChatPage: Received loading state update - Session: ${sessionId}, Loading: ${isLoading}, Source: ${source}`);
        setSessionLoadingStates(prev => ({
          ...prev,
          [sessionId]: isLoading
        }));
      } else if (isCurrentSession && !isLoading) {
        // Always clear loading state for current session when it's cleared (for universal edit updates)
        console.log(`🔄 ChatPage: Clearing loading state for current session - Session: ${sessionId}, Source: ${source}`);
        setSessionLoadingStates(prev => ({
          ...prev,
          [sessionId]: false
        }));
        
        // Process next message in queue when current message finishes
        if (messageQueue.length > 0 && !isProcessingQueueRef.current) {
          processNextMessageInQueue();
        }
      }
    });

    return () => {
      unsubscribe();
      unsubscribeAgentLog();
    };
  }, [currentSession?.session_id, messageQueue.length, processNextMessageInQueue, isStreamingActive, typingMessages]);

  // Listen for AI response typing events from unified messaging system
  useEffect(() => {
    const handleAITyping = (event: CustomEvent) => {
      const { sessionId, messageId } = event.detail;
      
      // Only handle typing for current session
      if (sessionId === currentSession?.session_id) {
        console.log('🤖 ChatPage: Received AI typing event for message:', messageId);
        setTypingMessages(prev => new Set([...prev, messageId]));
        
        // Clear the timeout since AI is responding
        // NOTE: Loading state is cleared by unifiedMessageHandler when first chunk arrives
        // Don't clear it here to avoid race conditions and ensure it stays until chunk actually arrives
        if (currentSession?.session_id && loadingTimeoutRefs.current[currentSession.session_id]) {
          clearTimeout(loadingTimeoutRefs.current[currentSession.session_id]);
          delete loadingTimeoutRefs.current[currentSession.session_id];
          console.log('🔄 ChatPage: Cleared timeout for session:', currentSession.session_id);
        }
      }
    };

    window.addEventListener('ai-response-typing', handleAITyping as EventListener);
    
    return () => {
      window.removeEventListener('ai-response-typing', handleAITyping as EventListener);
    };
  }, [currentSession?.session_id]);

  // Listen for streaming completion events
  useEffect(() => {
    const handleStreamingComplete = (event: CustomEvent) => {
      const { sessionId } = event.detail;
      if (sessionId === currentSession?.session_id) {
        console.log('✅ ChatPage: Streaming complete for session:', sessionId);
        setIsStreamingActive(false);
        
        // Process next message in queue after streaming completes
        if (messageQueue.length > 0 && !isProcessingQueueRef.current) {
          setTimeout(() => processNextMessageInQueue(), 100);
        }
      }
    };

    window.addEventListener('streaming-complete', handleStreamingComplete as EventListener);
    
    return () => {
      window.removeEventListener('streaming-complete', handleStreamingComplete as EventListener);
    };
  }, [currentSession?.session_id, messageQueue.length, processNextMessageInQueue]);

  // Set streaming active when loading starts
  useEffect(() => {
    const isLoading = getCurrentSessionLoading() || isUnifiedProcessing;
    if (isLoading) {
      setIsStreamingActive(true);
    }
  }, [getCurrentSessionLoading, isUnifiedProcessing]);

  // Poll for new messages when agent might be returning files (REST endpoint)
  useEffect(() => {
    if (!currentSession?.session_id || !user?.id) return;

    let pollInterval: NodeJS.Timeout;
    
    // Only poll when we're in a loading state (agent might be processing)
    if (isUnifiedProcessing) {
      console.log('🔄 ChatPage: Starting message polling for agent file returns');
      
      pollInterval = setInterval(async () => {
        try {
          // Check if there are new messages in the database
          const session = await sessionManagementAPI.getSession(currentSession.session_id, user.id);
          
          if (session && session.messages) {
            const currentMessageCount = unifiedMessageHandler.getMessagesForSession(currentSession.session_id).length;
            const dbMessageCount = session.messages.length;
            
            // If database has more messages than our cache, refresh
            if (dbMessageCount > currentMessageCount) {
              console.log('📨 ChatPage: Found new messages in database, refreshing session');
              await loadSessionFromDatabase(currentSession.session_id);
              
              // Clear loading state since we got the response
              // Note: Loading state is managed by unified messaging system
              unifiedMessageHandler.broadcastLoadingState(currentSession.session_id, false, 'chatpage');
              
              // Stop polling
              clearInterval(pollInterval);
            }
          }
        } catch (error) {
          console.error('❌ ChatPage: Error polling for messages:', error);
        }
      }, 2000); // Poll every 2 seconds
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [currentSession?.session_id, user?.id, isUnifiedProcessing]);


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

    // Listen for file message sent event to reset timeout
    // This ensures the 5-minute timeout only counts from when AI processing starts,
    // not from when file upload begins
    const handleFileMessageSent = (event: CustomEvent) => {
      const { sessionId } = event.detail;
      if (sessionId === currentSession?.session_id) {
        console.log('🔄 ChatPage: File message sent, resetting timeout for session:', sessionId);
        
        // Clear any existing timeout for this session
        if (loadingTimeoutRefs.current[sessionId]) {
          clearTimeout(loadingTimeoutRefs.current[sessionId]);
          delete loadingTimeoutRefs.current[sessionId];
        }
        
        // Reset timeout - now counting from when AI processing actually starts
        // Note: The main timeout effect will handle setting the timeout when loading becomes true
        // This handler just ensures we don't have stale timeouts from file upload
      }
    };

    window.addEventListener('session-variables-updated', handleSessionVariablesUpdate as any);
    window.addEventListener('file-message-sent', handleFileMessageSent as any);
    
    return () => {
      window.removeEventListener('session-variables-updated', handleSessionVariablesUpdate as any);
      window.removeEventListener('file-message-sent', handleFileMessageSent as any);
    };
  }, [currentSession?.session_id, addPersistedMessage]);
  
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(50);
  const userNearBottomRef = useRef<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const [inputAreaHeight, setInputAreaHeight] = useState(160); // Default height in px
  
  // Clear loading state when session is deleted or changed
  useEffect(() => {
    if (!currentSession) {
      console.log('🔴 DELETE: Clearing loading state due to session deletion');
      
      // Clear any session-specific state
      setSessionLoadingStates({});
      setPendingMessages({});
      setVisibleCount(50); // Reset visible count when session is cleared
    } else {
      // Reset visible count when switching to a new session
      setVisibleCount(50);
    }
  }, [currentSession?.session_id]); // Use session_id to detect actual session changes

  // Clear stuck loading states and timeout messages on page load (in case of errors or page refresh)
  useEffect(() => {
    console.log('🧹 ChatPage: Clearing any stuck loading states on page load');
    setSessionLoadingStates({});
    
    // Clear any timeout messages that might be stuck
    if (currentSession?.messages) {
      const timeoutMessages = currentSession.messages.filter(msg => 
        msg.id.startsWith('timeout_') && msg.sender === 'bot'
      );
      
      if (timeoutMessages.length > 0) {
        console.log('🧹 ChatPage: Removing stuck timeout messages:', timeoutMessages.length);
        const filteredMessages = currentSession.messages.filter(msg => 
          !msg.id.startsWith('timeout_') || msg.sender !== 'bot'
        );
        
        // Update the session with filtered messages
        updateSessionContext(currentSession.session_id, filteredMessages);
      }
    }
  }, []); // Run only once on mount

  // Handle session switching and message caching
  const previousSessionIdRef = useRef<string | null>(null);
  // Use a map to track timeouts per session instead of a single global timeout
  const loadingTimeoutRefs = useRef<Record<string, NodeJS.Timeout>>({});
  
  useEffect(() => {
    const currentSessionId = currentSession?.session_id;
    
    // Set model from session if available
    // Don't reset model - keep user's persistent selection
    
    // If we're switching to a session that has no messages but we expect it to have messages,
    // trigger a reload from the persistence system
    if (currentSessionId && currentSession && currentSession.messages.length === 0) {
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
      
      // Clear any pending timeouts for the previous session
      if (previousSessionIdRef.current && loadingTimeoutRefs.current[previousSessionIdRef.current]) {
        clearTimeout(loadingTimeoutRefs.current[previousSessionIdRef.current]);
        delete loadingTimeoutRefs.current[previousSessionIdRef.current];
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

  // Improved timeout mechanism with 5-minute timeout and user guidance
  // Only trigger timeout when loading state becomes true (not on every render)
  const prevLoadingStatesRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    // Process all sessions, not just current session
    Object.keys(sessionLoadingStates).forEach(sessionId => {
      const isLoading = sessionLoadingStates[sessionId];
      const prevLoadingState = prevLoadingStatesRef.current[sessionId] || false;
      
      // Only set timeout if loading state just became true (transition from false to true)
      if (isLoading && !prevLoadingState) {
        console.log('🔄 ChatPage: Loading state became true, setting 5-minute timeout for session:', sessionId);
        
        // Clear any existing timeout for this session
        if (loadingTimeoutRefs.current[sessionId]) {
          clearTimeout(loadingTimeoutRefs.current[sessionId]);
          delete loadingTimeoutRefs.current[sessionId];
        }
        
        // Set new timeout for this session (5 minutes)
        loadingTimeoutRefs.current[sessionId] = setTimeout(() => {
          // Check current loading state using the state setter callback to get latest state
          setSessionLoadingStates(prev => {
            const stillLoading = prev[sessionId];
            
            if (stillLoading) {
              console.log('⏰ TIMEOUT: Agent response timeout after 5 minutes for session:', sessionId);
              
              // Add helpful timeout message to guide user
              addPersistedMessage({
                id: `timeout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                text: "⏰ **Processing Extended**: Your request is taking longer than usual to process. The AI is still working on your request and may take up to 15 minutes to complete. Please refresh the page periodically to check for updates, or start a new conversation if you would like to talk about something else.",
                sender: 'bot',
                timestamp: new Date()
              });
              
              // Return updated state with loading cleared
              return {
                ...prev,
                [sessionId]: false
              };
            } else {
              console.log('🔄 ChatPage: Timeout fired but loading already cleared for session:', sessionId);
              return prev; // No change needed
            }
          });
          
          // Clean up timeout ref
          delete loadingTimeoutRefs.current[sessionId];
        }, 300000); // 5 minutes (300,000 ms)
      }
      
      // Clear timeout if loading state just became false (transition from true to false)
      if (!isLoading && prevLoadingState) {
        if (loadingTimeoutRefs.current[sessionId]) {
          console.log('🔄 ChatPage: Loading state became false, clearing timeout for session:', sessionId);
          clearTimeout(loadingTimeoutRefs.current[sessionId]);
          delete loadingTimeoutRefs.current[sessionId];
        }
        
        // Also clear "pending" timeout if it exists (shouldn't happen, but safety check)
        if (sessionId !== 'pending' && loadingTimeoutRefs.current['pending']) {
          console.log('🔄 ChatPage: Clearing leftover "pending" timeout');
          clearTimeout(loadingTimeoutRefs.current['pending']);
          delete loadingTimeoutRefs.current['pending'];
        }
      }
    });
    
    // Update the ref to track previous loading states
    prevLoadingStatesRef.current = { ...sessionLoadingStates };
  }, [sessionLoadingStates, addPersistedMessage]);

  // Track current session for cleanup
  const currentSessionRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionRef.current = currentSession?.session_id || null;
  }, [currentSession?.session_id]);

  // Cleanup on unmount
  const cleanupCalledRef = useRef(false);
  useEffect(() => {
    return () => {
      if (cleanupCalledRef.current) {
        console.log('🧹 ChatPage: Cleanup already called, skipping');
        return;
      }
      cleanupCalledRef.current = true;
      
      // Clear all pending timeouts for all sessions
      Object.values(loadingTimeoutRefs.current).forEach(timeout => {
        clearTimeout(timeout);
      });
      loadingTimeoutRefs.current = {};
      
      // NOTE: Do NOT send kill signals on unmount
      // Kill signals should only be sent when user explicitly clicks stop button
      // Unmount happens during navigation, sidebar clear, etc. and shouldn't cancel backend processing
      console.log('🧹 ChatPage: Cleanup complete (local state only, no kill signal)');
    };
  }, []); // Empty dependency array - only run on mount/unmount

  // Listen for new session creation from sidebar and session list refresh requests
  useEffect(() => {
    const handleNewSessionCreated = (event: CustomEvent) => {
      const { sessionId, source } = event.detail;
      // Only handle if created from sidebar (not from chatpage itself)
      if (source === 'sidebar' && sessionId) {
        console.log('🔄 ChatPage: New session created in sidebar, refreshing session list:', sessionId);
        // Reload sessions from backend to include the new session
        loadSessionsFromBackend();
      }
    };

    const handleRefreshSessionList = async (event: CustomEvent) => {
      const { sessionId } = event.detail;
      console.log('🔄 ChatPage: Refreshing session list after import:', sessionId);
      // Reload sessions from backend to include the imported session
      await loadSessionsFromBackend();
      // If a sessionId is provided, load it
      if (sessionId) {
        await loadSession(sessionId);
        await loadSessionFromDatabase(sessionId);
      }
    };

    window.addEventListener('new-session-created', handleNewSessionCreated as unknown as EventListener);
    window.addEventListener('refresh-session-list', handleRefreshSessionList as unknown as EventListener);
    
    return () => {
      window.removeEventListener('new-session-created', handleNewSessionCreated as unknown as EventListener);
      window.removeEventListener('refresh-session-list', handleRefreshSessionList as unknown as EventListener);
    };
  }, [loadSessionsFromBackend, loadSession]);

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
      // CRITICAL: Sanitize context items when loading from session to ensure data field is an object
      const sanitizedContext = currentSession.session_variables.context_items.map((item: any) => {
        let dataField = item.data;
        
        // If data is a string, parse it back to an object
        if (typeof dataField === 'string') {
          try {
            dataField = JSON.parse(dataField);
            console.warn(`⚠️ ChatPage: Loaded context item ${item.id} had data as string, parsed it`);
          } catch (e) {
            console.error(`❌ ChatPage: Failed to parse data field for loaded item ${item.id}:`, e);
            dataField = {};
          }
        }
        
        // Ensure data is an object
        if (!dataField || typeof dataField !== 'object' || Array.isArray(dataField)) {
          console.warn(`⚠️ ChatPage: Loaded context item ${item.id} has invalid data field, using empty object`);
          dataField = {};
        }
        
        return {
          ...item,
          data: dataField
        };
      });
      
      setSessionContext(sanitizedContext);
      console.log('✅ ChatPage: Set session context:', sanitizedContext.length, 'items');
      console.log('🔍 ChatPage: Loaded context items:', sanitizedContext.map(item => ({
        id: item.id,
        type: item.type,
        has_data: !!item.data,
        data_type: typeof item.data,
        data_keys: item.data ? Object.keys(item.data) : [],
        data_s3_key: item.data?.s3_key
      })));
    } else {
      setSessionContext([]);
      console.log('📭 ChatPage: No context items in session');
    }
  }, [currentSession?.session_id, currentSession?.session_variables]);

  // Listen for tiles being added to context in existing sessions
  useEffect(() => {
    const handleAddToContext = (event: CustomEvent) => {
      console.log('🎯 ChatPage: Received add-to-context event:', event.detail);
      const newItem: ContextItem = event.detail;
      
      // Log the item to verify data field is present
      console.log('🔍 ChatPage: New context item details:', {
        id: newItem.id,
        type: newItem.type,
        title: newItem.title,
        has_data: !!newItem.data,
        data_keys: newItem.data ? Object.keys(newItem.data) : [],
        data_s3_key: newItem.data?.s3_key,
        full_data: newItem.data
      });
      
      setSessionContext((prev) => {
        // Adding context item
        
        // Check if item already exists (by id prefix to avoid duplicates)
        const baseId = newItem.id.split('_').slice(0, -1).join('_');
        const exists = prev.some(item => item.id.startsWith(baseId));
        if (exists) {
          console.log('⚠️ ChatPage: Item already in context, skipping:', newItem.id);
          return prev;
        }
        
        console.log('✅ ChatPage: Adding item to context:', newItem);
        
        // CRITICAL: Ensure data field is preserved as an object, not a string
        let dataField = newItem.data;
        
        // If data is a string, parse it back to an object
        if (typeof dataField === 'string') {
          try {
            dataField = JSON.parse(dataField);
            console.warn('⚠️ ChatPage: data field was a string, parsed it back to object');
          } catch (e) {
            console.error('❌ ChatPage: Failed to parse data field from string:', e);
            dataField = {};
          }
        }
        
        // Ensure data is an object, not null/undefined
        if (!dataField || typeof dataField !== 'object' || Array.isArray(dataField)) {
          console.warn('⚠️ ChatPage: data field is not a valid object, using empty object');
          dataField = {};
        }
        
        const itemWithData = {
          ...newItem,
          data: dataField // Ensure data field is always an object
        };
        
        // Update previous context ref to mark that context has changed
        // This ensures the next message will send context data
        previousContextRef.current = prev; // Keep the old context for change detection
        
        const newContext = [...prev, itemWithData];
        // Context updated
        console.log('🎯 ChatPage: Context change detection scenario completed - context data is ready for next message');
        console.log('🔍 ChatPage: New context item in state:', {
          id: itemWithData.id,
          has_data: !!itemWithData.data,
          data_type: typeof itemWithData.data,
          data_keys: itemWithData.data ? Object.keys(itemWithData.data) : [],
          data_s3_key: itemWithData.data?.s3_key,
          full_data: itemWithData.data
        });
        // Context items added
        
        return newContext;
      });
    };

    const handleContextSync = (event: CustomEvent) => {
      const { sessionId, contextItems } = event.detail;
      console.log('🔄 ChatPage: Received context sync from Sidebar:', { sessionId, itemCount: contextItems.length });
      
      if (sessionId === currentSession?.session_id) {
        // Update previous context ref to mark that context has changed
        // This ensures the next message will send context data
        previousContextRef.current = sessionContext; // Keep the old context for change detection
        // Context synced
        
        setSessionContext(contextItems);
        console.log('✅ ChatPage: Synced context from Sidebar');
        console.log('🎯 ChatPage: Context change detection scenario completed - context data is ready for next message');
        // Context sync complete
      }
    };

    console.log('🎧 ChatPage: Setting up event listeners for add-to-context and session-context-updated');
    window.addEventListener('add-to-context', handleAddToContext as EventListener);
    window.addEventListener('session-context-updated', handleContextSync as EventListener);
    
    return () => {
      console.log('🎧 ChatPage: Removing event listeners for add-to-context and session-context-updated');
      window.removeEventListener('add-to-context', handleAddToContext as EventListener);
      window.removeEventListener('session-context-updated', handleContextSync as EventListener);
    };
  }, [currentSession?.session_id]);

  // Note: All message handling is now done by the unified messaging system

  

  // Only auto-scroll when user is near the bottom and a new message is appended
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    if (userNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages]);

  // Track user scroll position and lazy-load older messages on scroll-up
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

  // Ref to prevent duplicate edit sends
  const isSavingEditRef = useRef(false);
  
  const handleSaveEdit = async () => {
    if (!editingMessage || editingMessageIndex === null || !editText.trim() || isSavingEditRef.current) return;
    
    // Prevent double-clicks by setting ref immediately
    isSavingEditRef.current = true;
    
    // Store the editing message ID before clearing state
    const editingMessageId = editingMessage.id;
    const editingMessageText = editText;
    
    try {
      console.log('✏️ ChatPage: Sending edit message via unified system');
      
      // Send edit message via unified system
      const result = await sendUnifiedEditMessage(editText, editingMessage.id, selectedModel);
      
      if (result.success) {
        console.log('✅ ChatPage: Edit message sent successfully');

        // Immediately update the local UI to show the edited message and remove subsequent messages
        truncateMessagesAfter(editingMessageId, editingMessageText);
        
        // Note: unifiedMessageHandler.applyLocalEditAndTruncate is already called in processMessage
        // but we need to ensure the UI updates immediately. The truncateMessagesAfter call above
        // updates the persistence system, and the unified handler should have already updated its cache.
        // Force a refresh by getting the latest messages from the unified handler
        if (currentSession?.session_id) {
          // Small delay to ensure unified handler has processed the edit
          setTimeout(() => {
            const latestMessages = unifiedMessageHandler.getMessagesForSession(currentSession.session_id);
            // Force notification to ensure UI updates
            unifiedMessageHandler.notifyMessageUpdate(currentSession.session_id, latestMessages);
            console.log('✏️ ChatPage: Forced message refresh after truncation:', latestMessages.length, 'messages');
          }, 0);
        }
        
        // Clear editing state AFTER truncation to allow immediate re-editing
        setEditingMessage(null);
        setEditingMessageIndex(null);
        setEditText('');
      } else {
        console.error('❌ ChatPage: Failed to send edit message:', result.error);
        // Don't clear editing state on error so user can retry
      }
    } catch (error) {
      console.error('❌ ChatPage: Error sending edit message:', error);
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


  const handleDeleteSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the session load
    try {
      // Send kill before deleting to stop any in-flight processing for this session
      unifiedMessageHandler.killSession(sessionId, 'user_deleted_session');
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

  // Context menu handlers for sessions
  const handleSessionContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    setSessionContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6
    });
  };

  const handleCloseSessionContextMenu = () => {
    setSessionContextMenu(null);
  };

  // Add selected sessions to context
  const handleAddSessionsToContext = () => {
    if (selectedSessions.size === 0) {
      console.log('No sessions selected to add to context');
      return;
    }

    const selectedSessionsArray = Array.from(selectedSessions);
    // Processing context from selected sessions
    
    const sessionsToAdd = selectedSessionsArray
      .map(sessionId => {
        const session = sessions.find(s => s.session_id === sessionId);
        if (!session) {
          // Session not found
          return null;
        }
        
        // Found session for context
        return {
          sessionId: session.session_id,
          title: session.title,
          model: session.model,
          messageCount: session.messages?.length || 0,
          sessionData: session
        };
      })
      .filter((session): session is NonNullable<typeof session> => session !== null);

    if (sessionsToAdd.length === 0) {
      console.log('No valid sessions to add to context');
      return;
    }

    // Import context manager
    import('../components/tiles/common/contextManager').then(({ addMultipleChatSessionsToContext }) => {
      addMultipleChatSessionsToContext(sessionsToAdd);
    });

    // Clear selection
    setSelectedSessions(new Set());
    handleCloseSessionContextMenu();
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


  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    console.log('📤 ChatPage: Preparing to send message');
    
    // Determine message type
    const messageType = uploadedFiles.length > 0 ? 'file' 
      : (sessionContext.length > 0 && hasContextChanged() ? 'context' 
      : (currentSession?.session_id ? 'followup' : 'new'));
    
    // If already processing, add to queue
    if (getCurrentSessionLoading() || isUnifiedProcessing) {
      console.log('📬 ChatPage: Message queued (processing in progress)');
      setMessageQueue(prev => [...prev, {
        text,
        files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        context: sessionContext.length > 0 && hasContextChanged() ? sessionContext : undefined,
        model: selectedModel,
        type: messageType as 'file' | 'context' | 'followup' | 'new'
      }]);
      // Clear files immediately when queuing
      if (uploadedFiles.length > 0) {
        setUploadedFiles([]);
      }
      return;
    }
    
    // Send immediately if not processing
    console.log('📤 ChatPage: Sending message via unified messaging system');
    
    // Clear files immediately when sending (text input is local to child)
    if (uploadedFiles.length > 0) {
      console.log('📁 ChatPage: Clearing uploaded files immediately on send');
      setUploadedFiles([]);
    }
    
    // Set loading state for current session (or prepare for new session)
    const sessionId = currentSession?.session_id || 'pending';
    console.log('🔄 ChatPage: Setting loading state to true for session:', sessionId);
    setSessionLoadingStates(prev => ({
      ...prev,
      [sessionId]: true
    }));
    
    // Also broadcast loading state to other interfaces
    unifiedMessageHandler.broadcastLoadingState(sessionId, true, 'chatpage');
    
    try {
      let result;
      
      // Determine message type and send accordingly
      if (uploadedFiles.length > 0) {
        // File message
        console.log(`📁 ChatPage: Sending file message with ${uploadedFiles.length} files`);
        console.log(`📁 ChatPage: Files being sent:`, uploadedFiles.map(f => ({ name: f.name, size: f.size, type: f.type })));
        // Convert UploadedFile[] to File[] format for the unified handler
        // The handler expects files with name, size, type properties which UploadedFile has
        result = await sendUnifiedFileMessage(text, uploadedFiles as unknown as File[], selectedModel);
      } else if (sessionContext.length > 0 && hasContextChanged()) {
        // Context has changed - persist to backend first, then send message without context in payload
        console.log(`📋 ChatPage: Context changed (${sessionContext.length} items) - persisting to backend before sending message`);
        
        // CRITICAL: Persist context to backend FIRST before sending message
        // This ensures context is saved before message reaches agent
        if (currentSession?.session_id && user?.id) {
          try {
            // Sanitize context items before persisting
            const sanitizedContext = sessionContext.map(item => {
              let dataField = item.data;
              
              // If data is a string, parse it back to an object
              if (typeof dataField === 'string') {
                try {
                  dataField = JSON.parse(dataField);
                } catch (e) {
                  dataField = {};
                }
              }
              
              // Ensure data is an object
              if (!dataField || typeof dataField !== 'object' || Array.isArray(dataField)) {
                dataField = {};
              }
              
              return {
                ...item,
                data: dataField
              };
            });
            
            await sessionManagementAPI.updateSession(currentSession.session_id, user.id, {
              session_variables: {
                context_items: sanitizedContext,
                context_added_at: Date.now(),
              }
            });
            console.log('✅ ChatPage: Context persisted to backend before message send');
          } catch (error) {
            console.error('❌ ChatPage: Failed to persist context before message send:', error);
            // Continue with message send even if persistence failed
          }
        }
        
        // Send message WITHOUT context items - agent will fetch from session variables
        result = await sendUnifiedContextMessage(text, [], selectedModel);
        // Update previous context after sending
        previousContextRef.current = [...sessionContext];
      } else if (currentSession?.session_id) {
        // Followup message (existing session) - use context_message path for consistency
        console.log('🔄 ChatPage: Sending message to existing session');
        result = await sendUnifiedContextMessage(text, [], selectedModel);
      } else {
        // New message (no session)
        console.log('🆕 ChatPage: Sending new message (will create session)');
        result = await sendUnifiedMessage({
          text,
            model: selectedModel,
          type: 'new_message'
        });
      }
      
      if (result.success) {
        console.log('✅ ChatPage: Message sent successfully via unified system');
    
        // Update session ID if a new session was created
        if (result.sessionId && result.sessionId !== currentSession?.session_id) {
          console.log('🔄 ChatPage: New session created, loading session:', result.sessionId);
          
          // CRITICAL: Clear timeout for "pending" session if it exists (created before session was known)
          if (loadingTimeoutRefs.current['pending']) {
            console.log('🔄 ChatPage: Clearing timeout for "pending" session');
            clearTimeout(loadingTimeoutRefs.current['pending']);
            delete loadingTimeoutRefs.current['pending'];
          }
          
          // Clear loading state for the old session ID and set it for the new one
          if (currentSession?.session_id) {
            setSessionLoadingStates(prev => ({
              ...prev,
              [currentSession.session_id]: false
            }));
          }
          
          // Clear loading state for "pending" if it exists
          setSessionLoadingStates(prev => {
            const newState = { ...prev };
            if (newState['pending']) {
              delete newState['pending'];
            }
            return newState;
          });
          
          // Set loading state for the new session
          setSessionLoadingStates(prev => ({
            ...prev,
            [result.sessionId]: true
          }));
          
          // Broadcast loading state for the new session
          unifiedMessageHandler.broadcastLoadingState(result.sessionId, true, 'chatpage');
          
          // CRITICAL: Get cached messages BEFORE loading session to preserve them
          const cachedMessagesBeforeLoad = unifiedMessageHandler.getMessagesForSession(result.sessionId);
          console.log(`🔄 ChatPage: Cached messages before loadSession: ${cachedMessagesBeforeLoad.length}`);
          
          // CRITICAL: Load session IMMEDIATELY to update currentSession before message display
          // This ensures the useUnifiedMessaging hook's sessionId prop updates, allowing
          // the subscription to pick up messages that were already added to cache
          await loadSession(result.sessionId);
          
          // CRITICAL: Wait for React to process the state update and for useUnifiedMessaging
          // to set up the subscription and load messages from cache
          // Use a longer delay to ensure React has fully processed the session change
          await new Promise(resolve => setTimeout(resolve, 150));
          
          // After session loads, get messages again and ensure they're displayed
          const cachedMessagesAfterLoad = unifiedMessageHandler.getMessagesForSession(result.sessionId);
          console.log(`🔄 ChatPage: Cached messages after loadSession: ${cachedMessagesAfterLoad.length}`);
          
          const messagesToDisplay = cachedMessagesAfterLoad.length > 0 
            ? cachedMessagesAfterLoad 
            : cachedMessagesBeforeLoad;
          
          if (messagesToDisplay.length > 0) {
            // Force a notification to ensure all subscribers get the update
            // Use setTimeout to ensure this happens after React has processed the session change
            setTimeout(() => {
              unifiedMessageHandler.notifyMessageUpdate(result.sessionId, messagesToDisplay);
              console.log(`🔄 ChatPage: Forced message update for new session, ${messagesToDisplay.length} messages`);
            }, 50);
          } else {
            console.warn(`⚠️ ChatPage: No messages to display for new session ${result.sessionId}`);
          }
          
          console.log('🔄 ChatPage: Session loaded, unified messages should be visible');
        }
      } else {
        console.error('❌ ChatPage: Failed to send message:', result.error);
        // Clear loading state on error
        const errorSessionId = result.sessionId || currentSession?.session_id || 'pending';
        setSessionLoadingStates(prev => ({
          ...prev,
          [errorSessionId]: false
        }));
        unifiedMessageHandler.broadcastLoadingState(errorSessionId, false, 'chatpage');
        
        // Process next message in queue even on error
        if (messageQueue.length > 0 && !isProcessingQueueRef.current) {
          setTimeout(() => processNextMessageInQueue(), 100);
        }
      }
      } catch (error) {
      console.error('❌ ChatPage: Error sending message via unified system:', error);
      // Clear loading state on error
      const errorSessionId = currentSession?.session_id || 'pending';
      setSessionLoadingStates(prev => ({
        ...prev,
        [errorSessionId]: false
      }));
      unifiedMessageHandler.broadcastLoadingState(errorSessionId, false, 'chatpage');
      
      // Process next message in queue even on error
      if (messageQueue.length > 0 && !isProcessingQueueRef.current) {
        setTimeout(() => processNextMessageInQueue(), 100);
      }
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
                      onClick={handleSidebarClose}
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
                data-tutorial="new-chat-button"
                onClick={() => createNewSession()}
                disabled={persistenceLoading}
                sx={{
                  borderColor: '#374151',
                  color: 'white',
                  textTransform: 'uppercase',
                  mb: 1,
                  '&:hover': {
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                {persistenceLoading ? 'Creating...' : 'New Chat'}
              </Button>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<UploadIcon />}
                data-tutorial="import-chat-button"
                onClick={() => {
                  setImportExportMode('import');
                  setImportExportDialogOpen(true);
                }}
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
                Import Chat
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
            onContextMenu={handleSessionContextMenu}
            data-tutorial="chat-sessions-list"
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


        </GlassCard>
      </Drawer>

      {/* Main Chat Area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', height: 'calc(100vh - 64px)', maxHeight: 'calc(100vh - 64px)', overflow: 'hidden' }}>
        {/* Chat History Toggle - Top Left (only shows when sidebar is closed) */}
        {!sidebarOpen && (
          <Box sx={{ 
            position: 'absolute', 
            top: 16, 
            left: 16, 
            zIndex: 1000,
          }}>
            <Tooltip title="Open Chat History">
              <IconButton 
                onClick={handleSidebarOpen}
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
                <HistoryIcon />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        {/* Floating Menu - Top Right */}
        <Box sx={{ 
          position: 'absolute', 
          top: 16, 
          right: 16, 
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          alignItems: 'flex-end'
        }}>
          {/* Share Button */}
          <Tooltip title="Share Chat Session">
            <IconButton
              data-tutorial="share-button"
              onClick={(e) => setShareMenuAnchor(e.currentTarget)}
              disabled={!currentSession?.session_id}
              sx={{
                color: '#9ca3af',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid #374151',
                '&:hover': {
                  color: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
                '&:disabled': {
                  color: '#475569',
                },
              }}
            >
              <ShareIcon />
            </IconButton>
          </Tooltip>

          {/* Context Button */}
          <Tooltip title={isContextDrawerOpen ? 'Hide Context' : `Show Context (${sessionContext.length})`}>
            <IconButton
              data-tutorial="context-menu-button"
              onClick={() => {
                setIsContextDrawerOpen((v) => !v);
                if (!isContextDrawerOpen) setIsFilesDrawerOpen(false);
              }}
              sx={{
                color: isContextDrawerOpen ? '#10b981' : '#9ca3af',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid #374151',
                '&:hover': {
                  color: '#10b981',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                },
              }}
            >
              <ContextIcon />
            </IconButton>
          </Tooltip>

          {/* Files Button */}
          <Tooltip title={isFilesDrawerOpen ? 'Hide Files' : 'Show Files'}>
            <IconButton
              data-tutorial="file-menu-button"
              onClick={() => {
                setIsFilesDrawerOpen((v) => !v);
                if (!isFilesDrawerOpen) setIsContextDrawerOpen(false);
              }}
              sx={{
                color: isFilesDrawerOpen ? '#3b82f6' : '#9ca3af',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid #374151',
                '&:hover': {
                  color: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
              }}
            >
              <FileIcon />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Messages */}
        <Box ref={messagesContainerRef} onScroll={handleMessagesScroll} sx={{ 
          flex: 1, 
          overflow: 'auto', 
          px: 2,
          py: 1,
          pb: isInputCentered ? 1 : `${inputAreaHeight + 10}px`, // Add bottom padding to prevent overlap with input area
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
          <Stack spacing={1}>
            {messages.length === 0 && !currentSession && !isInputCentered && (
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
            {(() => {
              // Ensure we always show at least the last message if there are any messages
              // If visibleCount is 0 or invalid, show all messages
              // Otherwise, show the last visibleCount messages, but at least 1 if messages exist
              const effectiveVisibleCount = visibleCount > 0 ? visibleCount : messages.length || 50;
              const startIndex = Math.max(0, messages.length - effectiveVisibleCount);
              const visibleMessages = messages.slice(startIndex);
              
              // Safety check: if we still have no visible messages but messages exist, show all messages
              const finalVisibleMessages = (messages.length > 0 && visibleMessages.length === 0) 
                ? messages 
                : visibleMessages;
              
              return finalVisibleMessages.map((message, messageIndex) => (
              <Box
                key={message.id}
                sx={{
                  alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                }}
              >
                <MessageBubble isUser={message.sender === 'user'} status={(message as any).status || 'sent'}>
                    {editingMessage && editingMessage.id === message.id ? (
                      <Box ref={editContainerRef}>
                        <MessageEditInput
                          value={editText}
                          onChange={setEditText}
                          onSave={handleSaveEdit}
                          onCancel={handleCancelEdit}
                          isLoading={editingMessage && currentSession?.session_id ? sessionLoadingStates[currentSession.session_id] : false}
                          onStop={() => {
                            if (currentSession?.session_id) {
                              console.log('🛑 ChatPage: Sending kill signal for session (edit):', currentSession.session_id);
                              unifiedMessageHandler.cancelAllMessagesForSession(currentSession.session_id);
                            }
                          }}
                        />
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
                            <MarkdownRenderer content={message.text} />
                            
                          </>
                        )}
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
                  </MessageBubble>
                  <Box 
                    display="flex" 
                    alignItems="center" 
                    gap={0.5}
                    sx={{
                      mt: 0.5,
                      px: 0.5,
                    }}
                  >
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: '#6b7280', 
                        fontSize: '0.65rem',
                        fontWeight: 400,
                      }}
                    >
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </Typography>
                    {message.sender === 'user' && !editingMessage && (
                      <Tooltip title="Edit message">
                        <IconButton
                          size="small"
                          onClick={() => handleEditMessage(message, messageIndex)}
                          sx={{ 
                            color: '#9ca3af',
                            padding: '2px',
                            '&:hover': { 
                              color: '#3b82f6',
                              backgroundColor: 'transparent'
                            }
                          }}
                        >
                          <EditIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
              </Box>
            ));
            })()}
            {(getCurrentSessionLoading() || (currentSession?.session_id && crossInterfaceLoading[currentSession.session_id])) && (
              <Box display="flex" gap={2}>
                <Avatar sx={{ bgcolor: '#374151', width: 32, height: 32 }}>
                  <BotIcon />
                </Avatar>
                <Box display="flex" alignItems="center" gap={1}>
                  <CircularProgress size={20} sx={{ color: '#22c55e' }} />
                  <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'none' }}>
                    {currentSession?.session_id && agentLogs[currentSession.session_id] 
                      ? agentLogs[currentSession.session_id]
                      : 'AI is thinking...'}
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

        {/* Message Queue - Only show when there are messages */}
        {messageQueue.length > 0 && (
          <Box sx={{ mb: 1, px: 2 }}>
            {/* Queue Header - Collapsible */}
            <Box
              onClick={() => setIsQueueExpanded(!isQueueExpanded)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0,
                py: 0.5,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <QueueIcon sx={{ color: '#9ca3af', fontSize: '0.7rem', filter: 'grayscale(100%)' }} />
              <Typography
                variant="caption"
                sx={{
                  color: '#9ca3af',
                  fontSize: '0.65rem',
                  fontWeight: 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {messageQueue.length} queued
              </Typography>
              {isQueueExpanded ? (
                <ExpandLessIcon sx={{ color: '#9ca3af', fontSize: '0.7rem' }} />
              ) : (
                <ExpandMoreIcon sx={{ color: '#9ca3af', fontSize: '0.7rem' }} />
              )}
            </Box>

            {/* Queue Content - Collapsible */}
            <Collapse in={isQueueExpanded}>
              <Box
                sx={{
                  maxHeight: isQueueExpanded ? '400px' : '50px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Box
                  sx={{
                    px: 0,
                    py: 0.5,
                    maxHeight: isQueueExpanded ? '400px' : '50px',
                    overflowY: 'auto',
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
                  <List dense sx={{ p: 0 }}>
                    {messageQueue.map((queuedMessage, index) => (
                      <ListItem
                        key={index}
                        sx={{
                          mb: 0.5,
                          px: 0,
                          py: 0.25,
                          display: 'flex',
                          alignItems: 'flex-start',
                          '&:last-child': { mb: 0 },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: '20px', flexShrink: 0 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              color: '#9ca3af',
                              fontSize: '0.65rem',
                              fontWeight: 400,
                            }}
                          >
                            {index + 1}.
                          </Typography>
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Typography
                              variant="body2"
                              sx={{
                                color: '#9ca3af',
                                fontSize: '0.75rem',
                                wordBreak: 'break-word',
                                whiteSpace: 'normal',
                              }}
                            >
                              {queuedMessage.text || '(No text)'}
                            </Typography>
                          }
                          secondary={
                            <Box display="flex" gap={0.5} mt={0.25} flexWrap="wrap" alignItems="center">
                              {queuedMessage.files && queuedMessage.files.length > 0 && (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: '#6b7280',
                                    fontSize: '0.65rem',
                                  }}
                                >
                                  {queuedMessage.files.length} file{queuedMessage.files.length !== 1 ? 's' : ''}
                                </Typography>
                              )}
                              {queuedMessage.context && queuedMessage.context.length > 0 && (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: '#6b7280',
                                    fontSize: '0.65rem',
                                  }}
                                >
                                  {queuedMessage.context.length} context
                                </Typography>
                              )}
                              <Typography
                                variant="caption"
                                sx={{
                                  color: '#6b7280',
                                  fontSize: '0.65rem',
                                  textTransform: 'capitalize',
                                }}
                              >
                                {queuedMessage.type}
                              </Typography>
                            </Box>
                          }
                          sx={{
                            minWidth: 0,
                            flex: 1,
                          }}
                        />
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMessageQueue(prev => prev.filter((_, i) => i !== index));
                          }}
                          sx={{
                            color: '#6b7280',
                            padding: '2px',
                            '&:hover': {
                              color: '#ef4444',
                              backgroundColor: 'transparent',
                            },
                          }}
                        >
                          <DeleteIcon sx={{ fontSize: '0.75rem' }} />
                        </IconButton>
                      </ListItem>
                    ))}
                  </List>
                </Box>
              </Box>
            </Collapse>
          </Box>
        )}

        {/* Input Area - Bubble Style */}
        <Box
          ref={inputAreaRef}
          sx={{
            flexShrink: 0,
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            p: 0.625, // 5px padding from edge of chat space
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: isInputCentered ? 10 : 1,
            pointerEvents: 'auto',
            transition: 'z-index 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              width: isInputCentered ? '600px' : '100%',
              maxWidth: isInputCentered ? '90%' : '100%',
              transform: isInputCentered 
                ? 'translate3d(0, calc(-50vh + 50%), 0)' 
                : 'translate3d(0, 0, 0)',
              transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              willChange: 'transform',
              backfaceVisibility: 'hidden',
              perspective: 1000,
              WebkitTransform: isInputCentered 
                ? 'translate3d(0, calc(-50vh + 50%), 0)' 
                : 'translate3d(0, 0, 0)',
              WebkitBackfaceVisibility: 'hidden',
              WebkitPerspective: 1000,
            }}
          >
            <Box
              sx={{
                p: 1, // 8px padding inside bubble
                borderRadius: 0.5, // 4px rounded corners
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
              }}
            >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileUpload(e.target.files!)}
              multiple
              style={{ display: 'none' }}
            />
            {/* Show uploaded files - positioned above input bar */}
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
            {/* Chat help: positioned to the top-right of the chat input area and moves with it */}
            <Box sx={{ position: 'relative' }}>
              <Box sx={{ position: 'absolute', top: -36, right: 0, zIndex: 2 }}>
                <TutorialHelpIcon tutorialKey="chat" title="Chat tutorial" size="small" />
              </Box>
              <ChatMessageInputBar
              disabled={getCurrentSessionLoading()}
              placeholder="Ask me about stocks, crypto, portfolio optimization..."
              onSend={handleSendMessage}
              onFileClick={() => fileInputRef.current?.click()}
              onModelClick={(e) => setModelMenuAnchor(e.currentTarget)}
              modelLabel={availableModels.find(m => m.value === selectedModel)?.label || selectedModel || 'Model'}
              isLoading={getCurrentSessionLoading()}
              onStop={() => {
                if (currentSession?.session_id) {
                  console.log('🛑 ChatPage: Sending kill signal for session:', currentSession.session_id);
                  unifiedMessageHandler.cancelAllMessagesForSession(currentSession.session_id);
                }
              }}
              />
            </Box>
          </Box>
        </Box>
      </Box>
      </Box>

      {/* Context Drawer */}
      <Drawer
        anchor="right"
        open={isContextDrawerOpen}
        variant="persistent"
        PaperProps={{
          sx: {
            width: 360,
            top: `${headerHeight}px`,
            height: `calc(100vh - ${headerHeight}px)`,
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
            <Typography variant="body2" sx={{ color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
              Context ({sessionContext.length})
                </Typography>
              </Box>
          <IconButton size="small" onClick={() => setIsContextDrawerOpen(false)} sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
            </Box>
        <Box sx={{ p: 1, overflow: 'auto', '&::-webkit-scrollbar': { width: '6px' }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: '3px' }, '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' } }}>
          {sessionContext.length > 0 ? (
            <List dense sx={{ py: 0, px: 1 }}>
                {sessionContext.map((item, index) => (
                <ListItem key={item.id || index} sx={{ py: 0.5, px: 1, borderRadius: '4px', display: 'flex', alignItems: 'center', '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)', '& .remove-context-btn': { opacity: 1 } } }}>
                  <IconButton size="small" className="remove-context-btn" onClick={async () => {
                        const newContext = sessionContext.filter((_, i) => i !== index);
                        setSessionContext(newContext);
                        if (currentSession?.session_id) {
                      const syncEvent = new CustomEvent('session-context-updated', { detail: { sessionId: currentSession.session_id, contextItems: newContext } });
                          window.dispatchEvent(syncEvent);
                        }
                        if (currentSession?.session_id && user?.id) {
                          try {
                        await sessionManagementAPI.updateSession(currentSession.session_id, user.id, { session_variables: { context_items: newContext, context_added_at: Date.now() } });
                      } catch (error) { console.error('❌ Failed to update context in backend:', error); }
                        }
                  }} sx={{ opacity: 0, transition: 'opacity 0.2s', color: '#dc2626', mr: 1, '&:hover': { color: '#ef4444' } }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  <Box sx={{ flex: 1 }}>
                    <ContextItemRow
                      item={item}
                      sessionId={currentSession?.session_id}
                      userId={user?.id}
                      onRemove={() => handleRemoveContextItem(index)}
                    />
                  </Box>
                  </ListItem>
                ))}
              </List>
          ) : (
            <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.75rem', fontStyle: 'italic', p: 2, display: 'block' }}>
              No context items
            </Typography>
          )}
        </Box>
      </Drawer>

      {/* Files Drawer */}
      <Drawer
        anchor="right"
        open={isFilesDrawerOpen}
        variant="persistent"
        PaperProps={{
          sx: {
            width: 360,
            top: `${headerHeight}px`,
            height: `calc(100vh - ${headerHeight}px)`,
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
          <IconButton size="small" onClick={() => setIsFilesDrawerOpen(false)} sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}>
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
                          if (!currentSession?.session_id || !user?.id) return;
                          try {
                            const response = await fetch(`${API_CONFIG.BASE_URL}/file-download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, session_id: currentSession.session_id, filename: file.filename, s3_key: file.s3_key }) });
                            if (!response.ok) throw new Error(`Download request failed: ${response.status}`);
                            const { download_url } = await response.json();
                            const link = document.createElement('a'); link.href = download_url; link.download = file.filename; link.target = '_blank'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
                          } catch (error) { console.error('❌ Download failed:', error); }
                        }} sx={{ opacity: 0, transition: 'opacity 0.2s', color: '#3b82f6', '&:hover': { color: '#60a5fa' } }}>
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                        <IconButton edge="end" size="small" className="remove-file-btn" onClick={async () => {
                          const newFiles = (currentSession?.session_variables?.uploaded_files ?? []).filter((_: any, i: number) => i !== index);
                          if (currentSession?.session_id) {
                              updateSessionFiles(currentSession.session_id, newFiles);
                              if (currentSession?.session_id && user?.id) {
                                try {
                                await sessionManagementAPI.updateSession(currentSession.session_id, user.id, { session_variables: { ...(currentSession?.session_variables || {}), uploaded_files: newFiles, files_added_at: Date.now() } });
                              } catch (error) { console.error('❌ Failed to update files in backend:', error); }
                                }
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
                          if (!currentSession?.session_id || !user?.id) return;
                          try {
                                const response = await fetch(`${API_CONFIG.BASE_URL}/file-download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, session_id: currentSession.session_id, filename: file.filename, s3_key: file.s3_key }) });
                            if (!response.ok) throw new Error(`Download request failed: ${response.status}`);
                                const { download_url } = await response.json();
                            const link = document.createElement('a'); link.href = download_url; link.download = file.filename; link.target = '_blank'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
                          } catch (error) { console.error('❌ Agent file download failed:', error); }
                        }} sx={{ opacity: 0, transition: 'opacity 0.2s', color: '#22c55e', '&:hover': { color: '#16a34a' } }}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        <IconButton edge="end" size="small" className="remove-file-btn" onClick={async () => {
                          const newFiles = (currentSession?.session_variables?.agent_files ?? []).filter((_: any, i: number) => i !== index);
                          if (currentSession?.session_id) updateSessionAgentFiles(currentSession.session_id, newFiles);
                          if (currentSession?.session_id && user?.id) {
                            try {
                              await sessionManagementAPI.updateSession(currentSession.session_id, user.id, { session_variables: { ...(currentSession?.session_variables || {}), agent_files: newFiles } });
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
            setImportExportMode('export');
            setImportExportDialogOpen(true);
          }}
          sx={{
            color: '#e5e7eb',
            '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
          }}
        >
          <ListItemIcon>
            <ShareIcon fontSize="small" sx={{ color: '#60a5fa' }} />
          </ListItemIcon>
          <ListItemText>Share Link</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={async () => {
            setShareMenuAnchor(null);
            if (!currentSession?.session_id || !user?.id) return;
            try {
              const response = await sessionManagementAPI.shareSession(currentSession.session_id, user.id, 'download');
              if (response.success && response.downloadUrl) {
                // Use direct download approach (same as dashboard)
                const link = document.createElement('a');
                link.href = response.downloadUrl;
                link.download = `${currentSession.title || 'chat-session'}.cosine`;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                // Small delay before removing to ensure click is processed
                setTimeout(() => {
                  document.body.removeChild(link);
                }, 100);
              } else {
                console.error('Download failed:', response.error);
              }
            } catch (error) {
              console.error('Error downloading chat session:', error);
            }
          }}
          sx={{
            color: '#e5e7eb',
            '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
          }}
        >
          <ListItemIcon>
            <DownloadIcon fontSize="small" sx={{ color: '#60a5fa' }} />
          </ListItemIcon>
          <ListItemText>Download as .cosine</ListItemText>
        </MenuItem>
      </Menu>

      {/* Import/Export Dialog */}
      <ChatImportExportDialog
        open={importExportDialogOpen}
        onClose={() => setImportExportDialogOpen(false)}
        mode={importExportMode}
        sessionId={currentSession?.session_id}
        sessionTitle={currentSession?.title}
        userId={user?.id || ''}
        onImportSuccess={async (newSessionId) => {
          // Refresh session list to include the imported session
          await loadSessionsFromBackend();
          // Load and set the imported session as current
          await loadSession(newSessionId);
          // Load full session data (messages, context, etc.)
          await loadSessionFromDatabase(newSessionId);
        }}
      />

      {/* Session Context Menu */}
      <Menu
        open={sessionContextMenu !== null}
        onClose={handleCloseSessionContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          sessionContextMenu !== null
            ? { top: sessionContextMenu.mouseY, left: sessionContextMenu.mouseX }
            : undefined
        }
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
            minWidth: 200,
          },
        }}
      >
        <MenuItem 
          onClick={handleAddSessionsToContext} 
          disabled={selectedSessions.size === 0}
        >
          <ListItemIcon>
            <SidebarChatIcon sx={{ color: '#10b981' }} />
          </ListItemIcon>
          <ListItemText>
            Add to Context ({selectedSessions.size} selected)
          </ListItemText>
        </MenuItem>
      </Menu>

      {/* Model Selection Menu */}
      <Menu
        anchorEl={modelMenuAnchor}
        open={Boolean(modelMenuAnchor)}
        onClose={() => setModelMenuAnchor(null)}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(55, 65, 81, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 1,
            minWidth: 200,
            mt: 0.5,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          },
        }}
      >
        {availableModels.map((model) => (
          <MenuItem
            key={model.value}
            onClick={() => {
              handleModelChange({ target: { value: model.value } } as SelectChangeEvent);
              setModelMenuAnchor(null);
            }}
            selected={selectedModel === model.value}
            sx={{
              color: '#e5e7eb',
              '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
              '&.Mui-selected': {
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.3)' },
              },
            }}
          >
          <ListItemText>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1 }}>
                <Typography sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                  {model.label}
                </Typography>
                <Typography sx={{ color: '#9ca3af', fontSize: '0.65rem', fontWeight: 400 }}>
                  {model.value}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                {[1, 2, 3, 4].map((level) => (
                  <Typography
                    key={level}
                    component="span"
                    sx={{
                      color: level <= (model.cost || 1) ? '#fbbf24' : '#4b5563',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      lineHeight: 1,
                    }}
                  >
                    $
                  </Typography>
                ))}
              </Box>
            </Box>
            {model.tooltip && (
              <Typography sx={{ color: '#9ca3af', fontSize: '0.7rem' }}>
                {model.tooltip}
              </Typography>
            )}
          </ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

