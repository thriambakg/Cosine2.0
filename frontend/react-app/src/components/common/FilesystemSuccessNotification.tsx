import React, { useState, useEffect, useRef } from 'react';
import { Snackbar, Alert, IconButton, CircularProgress } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

type NotificationState = 'loading' | 'success' | 'timeout' | 'error';

/**
 * Global notification component for filesystem operations
 * Displays loading, success, timeout, or error messages in the top center
 * Handles loading states during operations and 504 gateway timeout errors
 */
const FilesystemSuccessNotification: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<NotificationState>('success');
  const aggregatedCountRef = useRef(0);
  const aggregationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventTimeRef = useRef<number>(0);

  useEffect(() => {
    const handleFilesystemLoading = (event: CustomEvent) => {
      const { operation = 'Adding', itemCount = 1 } = event.detail;
      
      // Determine the correct preposition based on operation type
      let preposition = 'to';
      if (operation.toLowerCase().includes('delet')) {
        preposition = 'from';
      } else if (operation.toLowerCase().includes('mov')) {
        preposition = 'in';
      }
      
      // Set loading message
      if (itemCount > 1) {
        setMessage(`${operation} ${itemCount} items ${preposition} filesystem...`);
      } else {
        setMessage(`${operation} item ${preposition} filesystem...`);
      }
      
      setState('loading');
      setOpen(true);
    };

    const handleFilesystemSuccess = (event: CustomEvent) => {
      const { itemCount = 1 } = event.detail;
      const now = Date.now();
      
      // If this event comes within 500ms of the last one, aggregate it
      // Otherwise, reset the count
      if (now - lastEventTimeRef.current < 500) {
        aggregatedCountRef.current += itemCount;
      } else {
        aggregatedCountRef.current = itemCount;
      }
      
      lastEventTimeRef.current = now;
      
      // Clear any existing timeout
      if (aggregationTimeoutRef.current) {
        clearTimeout(aggregationTimeoutRef.current);
      }
      
      // Set a timeout to show the notification after aggregation window
      aggregationTimeoutRef.current = setTimeout(() => {
        const totalCount = aggregatedCountRef.current;
        
        // Set appropriate message
        if (totalCount > 1) {
          setMessage('Items were saved successfully');
        } else {
          setMessage('Item was saved successfully');
        }
        
        // Reset aggregated count
        aggregatedCountRef.current = 0;
        
        // Change to success state (this will enable auto-hide)
        setState('success');
        
        // Close and reopen to reset the auto-hide timer and ensure it works
        setOpen(false);
        // Small delay to ensure smooth transition and reset timer
        setTimeout(() => {
          setOpen(true);
        }, 50);
      }, 500); // Wait 500ms after last event to aggregate
    };

    const handleFilesystemTimeout = (event: CustomEvent) => {
      const { operation = 'operation' } = event.detail;
      
      setMessage(`The ${operation} is taking a while. Check the filesystem in some time to see your files. Processing may take up to 15 minutes to complete depending on how large the operation is.`);
      setState('timeout');
      // Keep notification open for timeout (user can manually close)
      setOpen(true);
    };

    const handleFilesystemError = (event: CustomEvent) => {
      const { error } = event.detail;
      
      setMessage(error || 'An error occurred during the filesystem operation');
      setState('error');
      setOpen(true);
    };

    window.addEventListener('filesystem-loading', handleFilesystemLoading as EventListener);
    window.addEventListener('filesystem-success', handleFilesystemSuccess as EventListener);
    window.addEventListener('filesystem-timeout', handleFilesystemTimeout as EventListener);
    window.addEventListener('filesystem-error', handleFilesystemError as EventListener);

    return () => {
      window.removeEventListener('filesystem-loading', handleFilesystemLoading as EventListener);
      window.removeEventListener('filesystem-success', handleFilesystemSuccess as EventListener);
      window.removeEventListener('filesystem-timeout', handleFilesystemTimeout as EventListener);
      window.removeEventListener('filesystem-error', handleFilesystemError as EventListener);
      if (aggregationTimeoutRef.current) {
        clearTimeout(aggregationTimeoutRef.current);
      }
    };
  }, []);

  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  };

  // Determine severity and styling based on state
  const getSeverity = () => {
    switch (state) {
      case 'loading':
        return 'info' as const;
      case 'success':
        return 'success' as const;
      case 'timeout':
        return 'warning' as const;
      case 'error':
        return 'error' as const;
      default:
        return 'success' as const;
    }
  };

  const getBackgroundColor = () => {
    switch (state) {
      case 'loading':
        return '#3b82f6'; // Blue for loading
      case 'success':
        return '#10b981'; // Green for success
      case 'timeout':
        return '#f59e0b'; // Yellow/amber for timeout
      case 'error':
        return '#ef4444'; // Red for error
      default:
        return '#10b981';
    }
  };

  // Don't auto-hide for loading or timeout states
  // Success messages should auto-hide after 2 seconds
  // Error messages should auto-hide after 4 seconds (to give user time to read)
  const autoHideDuration = 
    state === 'loading' || state === 'timeout' 
      ? null 
      : state === 'success' 
        ? 2000  // 2 seconds for success messages
        : 4000; // 4 seconds for error messages

  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{
        top: '24px !important', // Ensure it's at the top
      }}
    >
      <Alert
        severity={getSeverity()}
        sx={{
          backgroundColor: getBackgroundColor(),
          color: '#ffffff',
          fontWeight: 500,
          minWidth: '300px',
          '& .MuiAlert-icon': {
            color: '#ffffff',
          },
          '& .MuiAlert-action': {
            paddingTop: 0,
            alignItems: 'center',
          },
        }}
        icon={state === 'loading' ? <CircularProgress size={20} sx={{ color: '#ffffff' }} /> : undefined}
        action={
          <IconButton
            size="small"
            aria-label="close"
            color="inherit"
            onClick={handleClose}
            sx={{
              color: '#ffffff',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      >
        {message}
      </Alert>
    </Snackbar>
  );
};

export default FilesystemSuccessNotification;