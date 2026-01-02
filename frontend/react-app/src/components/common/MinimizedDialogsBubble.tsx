import React, { useState } from 'react';
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Tooltip,
  Badge,
} from '@mui/material';
import {
  Minimize as MinimizeIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useDialogManager } from '../../contexts/DialogManagerContext';

const MinimizedDialogsBubble: React.FC = () => {
  const { dialogs, restoreDialog, closeDialog } = useDialogManager();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const minimizedDialogs = dialogs.filter(d => d.isMinimized);
  const activeDialogs = dialogs.filter(d => !d.isMinimized);

  if (minimizedDialogs.length === 0 && activeDialogs.length === 0) {
    return null;
  }

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleRestore = (id: string) => {
    restoreDialog(id);
    handleClose();
  };

  const handleCloseDialog = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeDialog(id);
    if (minimizedDialogs.length === 1) {
      handleClose();
    }
  };

  const totalCount = dialogs.length;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 9999,
      }}
    >
      <Tooltip title={`${totalCount} open dialog${totalCount !== 1 ? 's' : ''}`} arrow>
        <IconButton
          onClick={handleClick}
          sx={{
            width: 48,
            height: 48,
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            border: '2px solid #3b82f6',
            borderRadius: '50%',
            color: '#3b82f6',
            '&:hover': {
              backgroundColor: 'rgba(59, 130, 246, 0.3)',
              borderColor: '#2563eb',
            },
          }}
        >
          <Badge badgeContent={totalCount} color="primary" max={99}>
            <MinimizeIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            borderRadius: '8px',
            minWidth: 250,
            maxWidth: 400,
            maxHeight: 500,
            overflow: 'auto',
            mt: 1,
          },
        }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      >
        {minimizedDialogs.length > 0 && (
          <>
            <MenuItem disabled sx={{ color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>
              Minimized ({minimizedDialogs.length})
            </MenuItem>
            {minimizedDialogs.map((dialog) => (
              <MenuItem
                key={dialog.id}
                onClick={() => handleRestore(dialog.id)}
                sx={{
                  color: '#ffffff',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {dialog.title}
                </Typography>
                <IconButton
                  size="small"
                  onClick={(e) => handleCloseDialog(dialog.id, e)}
                  sx={{
                    color: '#ef4444',
                    ml: 1,
                    '&:hover': {
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    },
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </MenuItem>
            ))}
            {activeDialogs.length > 0 && <Box sx={{ borderTop: '1px solid #374151', my: 0.5 }} />}
          </>
        )}
        
        {activeDialogs.length > 0 && (
          <>
            <MenuItem disabled sx={{ color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>
              Active ({activeDialogs.length})
            </MenuItem>
            {activeDialogs.map((dialog) => (
              <MenuItem
                key={dialog.id}
                disabled
                sx={{
                  color: '#9ca3af',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {dialog.title}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6b7280', ml: 1 }}>
                  Open
                </Typography>
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </Box>
  );
};

export default MinimizedDialogsBubble;

