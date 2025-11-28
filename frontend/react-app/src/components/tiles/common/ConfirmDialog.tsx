import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
}

interface ConfirmDialogState {
  open: boolean;
  options: ConfirmDialogOptions | null;
  resolve: ((value: boolean) => void) | null;
}

let confirmDialogState: ConfirmDialogState = {
  open: false,
  options: null,
  resolve: null,
};

const listeners: Array<(state: ConfirmDialogState) => void> = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener(confirmDialogState));
};

/**
 * Shows a confirmation dialog and returns a promise that resolves to true/false
 * @param options Dialog options
 * @returns Promise that resolves to true if confirmed, false if cancelled
 */
export const confirmDialog = (options: ConfirmDialogOptions): Promise<boolean> => {
  return new Promise((resolve) => {
    confirmDialogState = {
      open: true,
      options,
      resolve,
    };
    notifyListeners();
  });
};

/**
 * Reusable confirmation dialog component
 * Should be rendered once at the app level
 */
export const ConfirmDialog: React.FC = () => {
  const [state, setState] = useState<ConfirmDialogState>(confirmDialogState);

  React.useEffect(() => {
    const listener = (newState: ConfirmDialogState) => {
      setState(newState);
    };
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  const handleClose = useCallback((confirmed: boolean) => {
    if (state.resolve) {
      state.resolve(confirmed);
    }
    confirmDialogState = {
      open: false,
      options: null,
      resolve: null,
    };
    notifyListeners();
  }, [state]);

  const handleConfirm = () => {
    handleClose(true);
  };

  const handleCancel = () => {
    handleClose(false);
  };

  if (!state.options) {
    return null;
  }

  const {
    title = 'Confirm Action',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmColor = 'primary',
  } = state.options;

  return (
    <Dialog
      open={state.open}
      onClose={handleCancel}
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #374151',
          color: 'white',
          minWidth: '300px',
        },
      }}
    >
      <DialogTitle sx={{ color: 'white', pb: 1 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: '#9ca3af' }}>
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={handleCancel}
          sx={{
            color: '#9ca3af',
            '&:hover': {
              backgroundColor: 'rgba(156, 163, 175, 0.1)',
            },
          }}
        >
          {cancelText}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color={confirmColor}
          sx={{
            backgroundColor: confirmColor === 'error' ? '#dc2626' : '#3b82f6',
            '&:hover': {
              backgroundColor: confirmColor === 'error' ? '#b91c1c' : '#2563eb',
            },
          }}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

