import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Close as CloseIcon,
  Add as AddIcon,
  Folder as FolderIcon
} from '@mui/icons-material';
import { DashboardGroup } from '../types/dashboardTypes';

interface NewTabDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateTab: (name: string, groupId?: string, isPinned?: boolean, color?: string) => void;
  tabGroups: DashboardGroup[];
}

const NewTabDialog: React.FC<NewTabDialogProps> = ({
  open,
  onClose,
  onCreateTab,
  tabGroups
}) => {
  const [tabName, setTabName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [isPinned, setIsPinned] = useState(false);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string>('');

  // Predefined colors for tabs
  const tabColors = [
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

  const handleCreate = () => {
    if (tabName.trim()) {
      onCreateTab(
        tabName.trim(),
        selectedGroupId || undefined,
        isPinned,
        selectedColor || undefined
      );
      handleClose();
    }
  };

  const handleClose = () => {
    setTabName('');
    setSelectedGroupId('');
    setIsPinned(false);
    setShowGroupSelector(false);
    setSelectedColor('');
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
        Create New Dashboard
        <IconButton
          onClick={handleClose}
          sx={{ color: '#9ca3af' }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Tab name input */}
          <TextField
            label="Dashboard Name"
            value={tabName}
            onChange={(e) => setTabName(e.target.value)}
            onKeyDown={handleKeyPress}
            autoFocus
            fullWidth
            variant="outlined"
            placeholder="Enter dashboard name..."
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

          {/* Group selection */}
          {tabGroups.length > 0 && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="body2" sx={{ color: '#9ca3af', mr: 1 }}>
                  Add to group:
                </Typography>
                <Tooltip title="Select Group">
                  <IconButton
                    size="small"
                    onClick={() => setShowGroupSelector(!showGroupSelector)}
                    sx={{
                      color: showGroupSelector ? '#f59e0b' : '#9ca3af',
                      backgroundColor: showGroupSelector ? 'rgba(245, 158, 11, 0.1)' : 'transparent'
                    }}
                  >
                    <FolderIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>

              {showGroupSelector && (
                <FormControl fullWidth size="small">
                  <InputLabel sx={{ color: '#9ca3af' }}>Select Group</InputLabel>
                  <Select
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    label="Select Group"
                    sx={{
                      color: '#ffffff',
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#6b7280'
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#9ca3af'
                      },
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#f59e0b'
                      },
                      '& .MuiSvgIcon-root': {
                        color: '#9ca3af'
                      }
                    }}
                  >
                    <MenuItem value="">
                      <em>No Group</em>
                    </MenuItem>
                    {tabGroups.map((group) => (
                      <MenuItem key={group.id} value={group.id}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              backgroundColor: group.color,
                              mr: 1
                            }}
                          />
                          <Typography variant="body2">{group.name}</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {/* Selected group display */}
              {selectedGroupId && (
                <Box sx={{ mt: 1 }}>
                  {(() => {
                    const selectedGroup = tabGroups.find(g => g.id === selectedGroupId);
                    return selectedGroup ? (
                      <Chip
                        label={selectedGroup.name}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: selectedGroup.color,
                          border: `1px solid ${selectedGroup.color}`
                        }}
                        onDelete={() => setSelectedGroupId('')}
                      />
                    ) : null;
                  })()}
                </Box>
              )}
            </Box>
          )}

          {/* Color Selection */}
          <Box>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 2 }}>
              Choose a color for your tab (optional):
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {tabColors.map((color) => (
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
                  onClick={() => setSelectedColor(selectedColor === color ? '' : color)}
                />
              ))}
            </Box>
          </Box>

          {/* Options */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>
              Options:
            </Typography>
            <Chip
              label="Pin Tab"
              size="small"
              clickable
              onClick={() => setIsPinned(!isPinned)}
              sx={{
                backgroundColor: isPinned ? 'rgba(245, 158, 11, 0.2)' : 'rgba(55, 65, 81, 0.5)',
                color: isPinned ? '#f59e0b' : '#9ca3af',
                border: isPinned ? '1px solid #f59e0b' : '1px solid #6b7280'
              }}
            />
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
          disabled={!tabName.trim()}
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
          Create Dashboard
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewTabDialog;
