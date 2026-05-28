import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  List,
  ListItem,
  Chip,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Send as SendIcon,
  DragIndicator as DragIcon,
  Dashboard as ContextIcon,
  Delete as DeleteIcon,
  Clear as ClearAllIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material';
import { useContextWindow } from '../../contexts/ContextWindowContext';
import { useAuth } from '../../contexts/AuthContext';
// Note: Removed API imports - tiles now pass metadata only, AI agent fetches data using tools
import { ContextItem } from '../tiles/common/contextManager';

interface ContextWindowProps {
  className?: string;
  isVisible?: boolean;
}

const ContextWindow: React.FC<ContextWindowProps> = ({ 
  className, 
  isVisible: externalIsVisible
}) => {
  // Use context for global state management
  const { contextItems, removeContextItem, clearContext, isVisible: contextIsVisible, setIsVisible: setContextIsVisible } = useContextWindow();
  
  // Use external visibility control if provided, otherwise use context
  const isVisible = externalIsVisible !== undefined ? externalIsVisible : contextIsVisible;
  
  // Bring window to foreground when items are added
  useEffect(() => {
    if (isVisible && contextItems.length > 0) {
      setIsForeground(true);
      // Reset foreground after a short delay
      const timer = setTimeout(() => {
        setIsForeground(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [contextItems.length, isVisible]);
  
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const saved = sessionStorage.getItem('context-window-position');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure position is within viewport bounds
        const maxX = Math.max(0, window.innerWidth - 424);
        const maxY = Math.max(0, window.innerHeight - 600);
        return {
          x: Math.min(parsed.x || window.innerWidth - 424, maxX),
          y: Math.min(parsed.y || 24, maxY),
        };
      } catch (e) {
        console.error('Error parsing saved position:', e);
      }
    }
    // Default position: right side, 24px from bottom
    return { 
      x: Math.max(0, window.innerWidth - 424), 
      y: 24 
    };
  });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isForeground, setIsForeground] = useState<boolean>(false);
  const [messageInput, setMessageInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendProgress, setSendProgress] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(5);
  const [sendError, setSendError] = useState<string | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  
  const { user } = useAuth();

  const handleWindowClick = () => {
    // Bring window to foreground when clicked
    setIsForeground(true);
    
    // Reset foreground state after a short delay
    setTimeout(() => {
      setIsForeground(false);
    }, 2000);
  };

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget || (event.target as HTMLElement).closest('[data-drag-handle]')) {
      setIsDragging(true);
      const rect = windowRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (isDragging) {
      const newX = event.clientX - dragOffset.x;
      const newY = event.clientY - dragOffset.y;
      
      // Convert from top-left coordinates to bottom-left coordinates
      const bottomY = window.innerHeight - newY - 600; // 600 is approximate window height
      
      // Keep window within viewport bounds
      const maxX = window.innerWidth - 400; // Window width
      const maxY = window.innerHeight - 600; // Window height
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(bottomY, maxY)),
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Add global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  // Save position to sessionStorage whenever position changes
  useEffect(() => {
    sessionStorage.setItem('context-window-position', JSON.stringify(position));
  }, [position]);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || contextItems.length === 0 || isSending || !user?.id) return;
    
    // Check item limit
    if (contextItems.length > 20) {
      setSendError('Too many context items (max 20). Please remove some items.');
      return;
    }
    
    setIsSending(true);
    setSendError(null);
    const userMessage = messageInput.trim();
    
    try {
      console.log('🚀 Starting context-aware message send');
      console.log('📦 Context items:', contextItems.length);
      
      // OPTIMIZATION: Send only metadata instead of full data
      // The AI agent will use database tools to retrieve data as needed
      setSendProgress(`Preparing context metadata for ${contextItems.length} items...`);
      
      // Create lightweight context metadata (no heavy data fetching)
      // CRITICAL: For filesystem items (context_item with filesystem_type), preserve the full data field including s3_key
      const enrichedContextItems = contextItems.map((item: ContextItem) => {
        // For chat sessions, preserve essential metadata
        if (item.type === 'chat') {
          return {
            id: item.id,
            type: item.type,
            title: item.title,
            subtitle: item.subtitle,
            timestamp: item.timestamp,
            data: {
              session_id: item.data?.session_id,
              user_id: item.data?.user_id,
              model: item.data?.model,
              message_count: item.data?.message_count,
              created_at: item.data?.created_at,
              last_updated: item.data?.last_updated,
            }
          };
        }
        
        // CRITICAL: For filesystem items (custom type with filesystem_type in data), preserve the FULL data field
        // This includes s3_key which is essential for the agent to decrypt and read .cosine files
        if ((item.type === 'custom' || item.type === 'filesystem') && item.data?.filesystem_type) {
          console.log('🔍 ContextWindow: Preserving full data for filesystem item:', {
            id: item.id,
            filesystem_type: item.data.filesystem_type,
            has_s3_key: !!item.data.s3_key,
            s3_key: item.data.s3_key,
            full_data: item.data
          });
          return {
            id: item.id,
            type: item.type,
            title: item.title,
            subtitle: item.subtitle,
            timestamp: item.timestamp,
            data: item.data // Preserve FULL data object for filesystem items
          };
        }
        
        // CRITICAL: For data-rich context items (LDA filings, SEC filings, contracts, bills, trades, etc.), preserve FULL data
        // These items contain structured data that the AI agent needs to analyze
        const dataRichTypes = ['lda_filing', 'sec_filing', 'govt_contract_award', 'congress_bill', 'politician_trade', 'fec_entity', 'stock_data'];
        if (dataRichTypes.includes(item.type)) {
          console.log('🔍 ContextWindow: Preserving full data for data-rich item:', {
            id: item.id,
            type: item.type,
            has_data: !!item.data,
            data_keys: item.data ? Object.keys(item.data) : [],
            full_data: item.data
          });
          return {
            id: item.id,
            type: item.type,
            title: item.title,
            subtitle: item.subtitle,
            timestamp: item.timestamp,
            data: item.data // Preserve FULL data object for data-rich items
          };
        }
        
        // For other types (tiles, stocks, etc.), use lightweight metadata
        return {
          id: item.id,
          type: item.type,
          title: item.title,
          subtitle: item.subtitle,
          timestamp: item.timestamp,
          data: {
            tileType: item.data?.tileType,
            symbol: item.data?.symbol,
            timeframe: item.data?.timeframe,
            // Don't include heavy backendData or processed data
          }
        };
      });
      
      console.log('✅ Prepared context metadata:', enrichedContextItems.length);
      
      // Step 2: Create new chat session with context via WebSocket
      setSendProgress('Creating analysis session...');
      
      // Generate a new session ID for this context-aware chat
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store context session data in sessionStorage for ChatPage to pick up
      const contextSessionData = {
        userId: user.id,
        sessionId: newSessionId, // This is temporary - ChatPage will create the real session ID
        userMessage: userMessage,
        contextItems: enrichedContextItems,
        timestamp: Date.now(),
      };
      sessionStorage.setItem('pending-context-session', JSON.stringify(contextSessionData));
      
      // Dispatch event immediately for the global handler to process
      const contextSessionEvent = new CustomEvent('create-context-session', {
        detail: contextSessionData
      });
      window.dispatchEvent(contextSessionEvent);
      
      console.log('✅ Context message sent to global handler');
      
      // Step 3: Show success message
      setShowSuccess(true);
      setMessageInput('');
      setCountdown(5);
      
      // Step 4: Start countdown timer
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            // Reset, clear, and collapse the window
            setShowSuccess(false);
            clearContext();
            setContextIsVisible(false);
            console.log('🔽 Context window collapsed after sending message');
            return 5;
          }
          return prev - 1;
        });
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error sending context message:', error);
      setSendError('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
      setSendProgress('');
    }
  };
  

  // Don't render if hidden (visibility controlled by toolbar)
  if (!isVisible) {
    return null;
  }

  return (
    <Box
      ref={windowRef}
      className={className}
      onClick={handleWindowClick}
      onMouseDown={handleMouseDown}
      sx={{
        position: 'fixed',
        left: position.x,
        bottom: position.y,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '12px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        zIndex: isForeground ? 1400 : 1300,
        width: 400,
        height: 600,
        display: 'flex',
        flexDirection: 'column',
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: 'none',
        transform: isDragging ? 'scale(1.02)' : isForeground ? 'scale(1.02)' : 'scale(1)',
        transition: isDragging ? 'none' : 'all 0.2s ease',
        borderColor: isForeground ? '#3b82f6' : '#374151',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          borderBottom: '1px solid #374151',
          cursor: 'grab',
        }}
        data-drag-handle
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ContextIcon sx={{ color: '#3b82f6', fontSize: '1.25rem' }} />
          <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '1rem' }}>
            Analysis Context
          </Typography>
          <Chip
            label={contextItems.length}
            size="small"
            sx={{
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              fontSize: '0.75rem',
              height: '20px',
              minWidth: '20px',
            }}
          />
        </Box>
        
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Drag to Move">
            <IconButton
              size="small"
              data-drag-handle
              sx={{
                color: '#9ca3af',
                cursor: 'grab',
                '&:hover': {
                  color: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
              }}
            >
              <DragIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          
          {contextItems.length > 0 && (
            <Tooltip title="Clear All">
              <IconButton
                size="small"
                onClick={clearContext}
                sx={{
                  color: '#9ca3af',
                  '&:hover': {
                    color: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  },
                }}
              >
                <ClearAllIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Context Items List */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
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
        {contextItems.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 2,
            }}
          >
            <ContextIcon sx={{ fontSize: 48, color: '#374151' }} />
            <Typography variant="body2" sx={{ color: '#9ca3af', textAlign: 'center' }}>
              No items in context
            </Typography>
            <Typography variant="caption" sx={{ color: '#6b7280', textAlign: 'center', px: 2 }}>
              Right-click tiles or elements and select "Add to Context" to start building your analysis
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0 }}>
            {contextItems.map((item, index) => (
              <React.Fragment key={item.id}>
                <ListItem
                  sx={{
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    borderRadius: '8px',
                    mb: 1,
                    p: 1.5,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1,
                    '&:hover': {
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      borderColor: 'rgba(59, 130, 246, 0.3)',
                    },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: '#ffffff',
                        fontWeight: 500,
                        mb: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title}
                    </Typography>
                    {item.subtitle && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: '#9ca3af',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {item.subtitle}
                      </Typography>
                    )}
                    <Chip
                      label={item.type}
                      size="small"
                      sx={{
                        mt: 0.5,
                        height: '18px',
                        fontSize: '0.7rem',
                        backgroundColor: 'rgba(139, 92, 246, 0.2)',
                        color: '#a78bfa',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                      }}
                    />
                  </Box>
                  
                  <IconButton
                    size="small"
                    onClick={() => removeContextItem(item.id)}
                    sx={{
                      color: '#9ca3af',
                      flexShrink: 0,
                      '&:hover': {
                        color: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      },
                    }}
                  >
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </ListItem>
                {index < contextItems.length - 1 && (
                  <Divider sx={{ my: 0.5, backgroundColor: 'rgba(55, 65, 81, 0.3)' }} />
                )}
              </React.Fragment>
            ))}
          </List>
        )}
      </Box>

      {/* Success Message */}
      {showSuccess && (
        <Box
          sx={{
            p: 2,
            borderTop: '1px solid #374151',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
          }}
        >
          <Alert
            icon={<CheckIcon />}
            severity="success"
            sx={{
              backgroundColor: 'transparent',
              color: '#22c55e',
              '& .MuiAlert-icon': {
                color: '#22c55e',
              },
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              ✓ Analysis started in AI Chat
            </Typography>
            <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mt: 0.5 }}>
              Closing in {countdown} second{countdown !== 1 ? 's' : ''}...
            </Typography>
          </Alert>
        </Box>
      )}
      
      {/* Progress Indicator */}
      {isSending && sendProgress && (
        <Box
          sx={{
            p: 2,
            borderTop: '1px solid #374151',
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <CircularProgress size={20} sx={{ color: '#3b82f6' }} />
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            {sendProgress}
          </Typography>
        </Box>
      )}
      
      {/* Error Message */}
      {sendError && (
        <Box
          sx={{
            p: 2,
            borderTop: '1px solid #374151',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
          }}
        >
          <Alert
            severity="error"
            onClose={() => setSendError(null)}
            sx={{
              backgroundColor: 'transparent',
              color: '#ef4444',
              '& .MuiAlert-icon': {
                color: '#ef4444',
              },
            }}
          >
            {sendError}
          </Alert>
        </Box>
      )}

      {/* Message Input */}
      <Box
        sx={{
          p: 2,
          borderTop: '1px solid #374151',
        }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={3}
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder={contextItems.length > 0 ? "Ask a question about your context..." : "Add items to context first..."}
          disabled={contextItems.length === 0 || isSending || showSuccess}
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
                  disabled={!messageInput.trim() || contextItems.length === 0 || isSending || showSuccess}
                  sx={{
                    color: messageInput.trim() && contextItems.length > 0 ? '#3b82f6' : '#6b7280',
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
        
        {contextItems.length > 0 && (
          <Typography
            variant="caption"
            sx={{
              color: '#6b7280',
              display: 'block',
              mt: 1,
              textAlign: 'center',
            }}
          >
            Press Enter to send • Shift + Enter for new line
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export default ContextWindow;

