import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  IconButton,
  Grid,
  Paper
} from '@mui/material';
import {
  Close as CloseIcon,
  Add as AddIcon,
  Folder as FolderIcon
} from '@mui/icons-material';

interface NewGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateGroup: (name: string, color: string) => void;
}

const predefinedColors = [
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#84cc16', // Lime
  '#f97316', // Orange
  '#ec4899', // Pink
  '#6b7280', // Gray
  '#14b8a6', // Teal
  '#a855f7'  // Violet
];

const NewGroupDialog: React.FC<NewGroupDialogProps> = ({
  open,
  onClose,
  onCreateGroup
}) => {
  const [groupName, setGroupName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#3b82f6');

  const handleCreate = () => {
    if (groupName.trim()) {
      onCreateGroup(groupName.trim(), selectedColor);
      handleClose();
    }
  };

  const handleClose = () => {
    setGroupName('');
    setSelectedColor('#3b82f6');
    onClose();
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleCreate();
    } else if (event.key === 'Escape') {
      handleClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          border: '1px solid #374151',
          color: '#ffffff'
        }
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        borderBottom: '1px solid #374151',
        color: '#ffffff',
        fontSize: '1.25rem',
        fontWeight: 600
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <FolderIcon sx={{ color: '#f59e0b', mr: 1 }} />
          Create New Group
        </Box>
        <IconButton
          onClick={handleClose}
          sx={{ color: '#9ca3af' }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Group name input */}
          <TextField
            label="Group Name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={handleKeyPress}
            autoFocus
            fullWidth
            variant="outlined"
            placeholder="Enter group name..."
            sx={{
              '& .MuiOutlinedInput-root': {
                color: '#ffffff',
                '& fieldset': {
                  borderColor: '#6b7280'
                },
                '&:hover fieldset': {
                  borderColor: '#9ca3af'
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#f59e0b'
                }
              },
              '& .MuiInputLabel-root': {
                color: '#9ca3af',
                '&.Mui-focused': {
                  color: '#f59e0b'
                }
              }
            }}
          />

          {/* Color selection */}
          <Box>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 2 }}>
              Choose a color for your group:
            </Typography>
            <Grid container spacing={1}>
              {predefinedColors.map((color) => (
                <Grid item xs={2} sm={1.5} key={color}>
                  <Paper
                    elevation={selectedColor === color ? 4 : 1}
                    sx={{
                      width: '100%',
                      height: 40,
                      backgroundColor: color,
                      cursor: 'pointer',
                      border: selectedColor === color ? '3px solid #ffffff' : '1px solid #374151',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        transform: 'scale(1.05)',
                        boxShadow: 3
                      }
                    }}
                    onClick={() => setSelectedColor(color)}
                  >
                    {selectedColor === color && (
                      <Box
                        sx={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          backgroundColor: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: color
                          }}
                        />
                      </Box>
                    )}
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* Preview */}
          <Box>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
              Preview:
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                px: 2,
                py: 1,
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '4px',
                width: 'fit-content'
              }}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: selectedColor,
                  mr: 1
                }}
              />
              <Typography
                variant="body2"
                sx={{
                  color: selectedColor,
                  fontWeight: 600
                }}
              >
                {groupName || 'Group Name'}
              </Typography>
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ 
        borderTop: '1px solid #374151',
        p: 2
      }}>
        <Button
          onClick={handleClose}
          sx={{
            color: '#9ca3af',
            '&:hover': {
              backgroundColor: 'rgba(55, 65, 81, 0.5)'
            }
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          disabled={!groupName.trim()}
          variant="contained"
          startIcon={<AddIcon />}
          sx={{
            backgroundColor: '#f59e0b',
            color: '#000000',
            '&:hover': {
              backgroundColor: '#d97706'
            },
            '&:disabled': {
              backgroundColor: 'rgba(55, 65, 81, 0.5)',
              color: '#6b7280'
            }
          }}
        >
          Create Group
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewGroupDialog;
