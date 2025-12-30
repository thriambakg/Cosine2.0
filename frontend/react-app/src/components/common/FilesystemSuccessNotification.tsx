import React, { useState, useEffect, useRef } from 'react';
import { Snackbar, Alert, IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

/**
 * Global success notification component for filesystem additions
 * Displays a green success message in the top center when items are added to filesystem
 * Aggregates rapid events to show plural notification for multiple items
 */
const FilesystemSuccessNotification: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const aggregatedCountRef = useRef(0);
  const aggregationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventTimeRef = useRef<number>(0);

  useEffect(() => {
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
        
        // Set appropriate message (same format as context notification)
        if (totalCount > 1) {
          setMessage('Items were added successfully');
        } else {
          setMessage('Item was added successfully');
        }
        
        // Reset aggregated count
        aggregatedCountRef.current = 0;
        
        // Close and reopen to reset the auto-hide timer
        setOpen(false);
        // Small delay to ensure smooth transition
        setTimeout(() => {
          setOpen(true);
        }, 50);
      }, 500); // Wait 500ms after last event to aggregate
    };

    window.addEventListener('filesystem-success', handleFilesystemSuccess as EventListener);

    return () => {
      window.removeEventListener('filesystem-success', handleFilesystemSuccess as EventListener);
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

  return (
    <Snackbar
      open={open}
      autoHideDuration={3000}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{
        top: '24px !important', // Ensure it's at the top
      }}
    >
      <Alert
        severity="success"
        sx={{
          backgroundColor: '#10b981', // Green background
          color: '#ffffff',
          fontWeight: 500,
          '& .MuiAlert-icon': {
            color: '#ffffff',
          },
          '& .MuiAlert-action': {
            paddingTop: 0,
            alignItems: 'center',
          },
        }}
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

