import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  IconButton
} from '@mui/material';
import {
  Close as CloseIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { DashboardGroup } from '../types/dashboardTypes';

interface EditGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onEditGroup: (groupId: string, name: string, color: string) => void;
  group: DashboardGroup | null;
}

const EditGroupDialog: React.FC<EditGroupDialogProps> = ({
  open,
  onClose,
  onEditGroup,
  group
}) => {
  const [groupName, setGroupName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>('');

  // Predefined colors for groups (same as tabs)
  const groupColors = [
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

  // Update form when group changes
  useEffect(() => {
    if (group) {
      setGroupName(group.name);
      setSelectedColor(group.color);
    }
  }, [group]);

  const handleSave = () => {
    if (group && groupName.trim() && selectedColor) {
      onEditGroup(group.id, groupName.trim(), selectedColor);
      handleClose();
    }
  };

  const handleClose = () => {
    setGroupName('');
    setSelectedColor('');
    onClose();
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSave();
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
          borderRadius: '12px'
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
          <EditIcon sx={{ color: '#3b82f6', mr: 1 }} />
          Edit Group
        </Box>
        <IconButton
          onClick={handleClose}
          sx={{ color: '#9ca3af' }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Group Name */}
          <Box>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
              Group Name
            </Typography>
            <TextField
              fullWidth
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter group name"
              variant="outlined"
              autoFocus
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: '#0f172a',
                  borderColor: '#374151',
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#6b7280'
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#3b82f6'
                  }
                },
                '& .MuiInputBase-input': {
                  color: '#ffffff'
                }
              }}
            />
          </Box>

          {/* Color Selection */}
          <Box>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 2 }}>
              Choose a color for your group:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {groupColors.map((color) => (
                <Box
                  key={color}
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    backgroundColor: color,
                    cursor: 'pointer',
                    border: selectedColor === color ? '3px solid #ffffff' : '2px solid transparent',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'scale(1.1)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                    }
                  }}
                  onClick={() => setSelectedColor(color)}
                />
              ))}
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ 
        borderTop: '1px solid #374151',
        p: 2,
        gap: 1
      }}>
        <Button
          onClick={handleClose}
          sx={{
            color: '#9ca3af',
            borderColor: '#374151',
            '&:hover': {
              borderColor: '#6b7280',
              backgroundColor: 'rgba(55, 65, 81, 0.1)'
            }
          }}
          variant="outlined"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!groupName.trim() || !selectedColor}
          sx={{
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            '&:hover': {
              backgroundColor: '#2563eb'
            },
            '&:disabled': {
              backgroundColor: '#374151',
              color: '#6b7280'
            }
          }}
          variant="contained"
        >
          Save Changes
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditGroupDialog;
