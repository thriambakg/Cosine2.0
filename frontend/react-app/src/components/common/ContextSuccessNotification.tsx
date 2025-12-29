import React, { useState, useEffect } from 'react';
import { Snackbar, Alert, IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

/**
 * Global success notification component for sidebar context additions
 * Displays a green success message in the top center when items are added to sidebar context
 */
const ContextSuccessNotification: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const handleSidebarContextSuccess = (event: CustomEvent) => {
      const { contextItems } = event.detail;
      
      // Determine if it's a single item or multiple items
      // Single item handler sends { contextItem }
      // Multiple items handler sends { contextItems } (array)
      const isMultiple = !!contextItems && Array.isArray(contextItems);
      const itemCount = isMultiple ? contextItems.length : 1;
      
      // Set appropriate message
      if (itemCount > 1) {
        setMessage('Items were added successfully');
      } else {
        setMessage('Item was added successfully');
      }
      
      setOpen(true);
    };

    window.addEventListener('sidebar-context-success', handleSidebarContextSuccess as EventListener);

    return () => {
      window.removeEventListener('sidebar-context-success', handleSidebarContextSuccess as EventListener);
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

export default ContextSuccessNotification;

