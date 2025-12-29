import React, { useState, useRef } from 'react';
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
  Tooltip,
  Tabs,
  Tab,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress
} from '@mui/material';
import {
  Close as CloseIcon,
  Add as AddIcon,
  Folder as FolderIcon,
  Upload as UploadIcon,
  Link as LinkIcon,
  CloudUpload as CloudUploadIcon,
  Storage as StorageIcon,
  InsertDriveFile as FileIcon
} from '@mui/icons-material';
import { DashboardGroup } from '../../types/dashboardTypes';
import { useAuth } from '../../contexts/AuthContext';
import { filesystemAPI, fileReturnAPI } from '../../services/api';

interface NewTabDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateTab: (name: string, groupId?: string, isPinned?: boolean, color?: string) => void;
  onImportTab?: (file: File | null, shareLink: string | null) => Promise<void>;
  tabGroups: DashboardGroup[];
}

type DialogMode = 'create' | 'import';

const NewTabDialog: React.FC<NewTabDialogProps> = ({
  open,
  onClose,
  onCreateTab,
  onImportTab,
  tabGroups
}) => {
  const [mode, setMode] = useState<DialogMode>('create');
  const [tabName, setTabName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [isPinned, setIsPinned] = useState(false);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string>('');
  
  // Import mode state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [shareLink, setShareLink] = useState<string>('');
  const [importError, setImportError] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [currentFolderPath, setCurrentFolderPath] = useState<string>('');
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string; name: string; path: string }>>([{ id: 'root', name: 'Files', path: '' }]);
  const [currentFolderItems, setCurrentFolderItems] = useState<Array<{ id: string; name: string; type: string; s3_key?: string; path?: string; created_at: number; isFolder: boolean }>>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFilesystemFile, setSelectedFilesystemFile] = useState<{ id: string; name: string; s3_key: string; folder_path: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

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

  const handleImport = async () => {
    if (!onImportTab) {
      setImportError('Import functionality is not available');
      return;
    }

    if (!importFile && !shareLink.trim() && !selectedFilesystemFile) {
      setImportError('Please provide either a file, a share link, or select a file from your filesystem');
      return;
    }

    setIsImporting(true);
    setImportError('');

    try {
      let fileToImport = importFile;
      
      // If a filesystem file is selected, download it first
      if (selectedFilesystemFile && !fileToImport) {
        try {
          // Get file content directly (avoids CORS issues)
          const contentResponse = await fileReturnAPI.getFileContent({
            user_id: user?.id || '',
            s3_key: selectedFilesystemFile.s3_key,
            filename: selectedFilesystemFile.name,
          });

          if (!contentResponse.success || !contentResponse.file_content) {
            throw new Error(contentResponse.error || 'Failed to get file content from filesystem');
          }

          // Decode base64 content
          const binaryString = atob(contentResponse.file_content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Convert to Blob, then to File
          const blob = new Blob([bytes], { type: 'application/x-cosine-context' });
          fileToImport = new File([blob], contentResponse.filename || selectedFilesystemFile.name, { 
            type: 'application/x-cosine-context' 
          });
        } catch (error: any) {
          console.error('Error downloading file from filesystem:', error);
          setImportError(error.message || 'Failed to download file from filesystem');
          setIsImporting(false);
          return;
        }
      }

      await onImportTab(fileToImport, shareLink.trim() || null);
      handleClose();
    } catch (error: any) {
      setImportError(error.message || 'Failed to import dashboard');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type (should be .cosine file)
      if (!file.name.endsWith('.cosine')) {
        setImportError('Please select a valid .cosine dashboard file');
        return;
      }
      setImportFile(file);
      setShareLink(''); // Clear share link when file is selected
      setSelectedFilesystemFile(null); // Clear filesystem file when file is selected
      setImportError('');
    }
  };

  const handleLinkChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setShareLink(event.target.value);
    if (event.target.value.trim()) {
      setImportFile(null); // Clear file when link is entered
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
    setImportError('');
  };

  const handleClose = () => {
    setTabName('');
    setSelectedGroupId('');
    setIsPinned(false);
    setShowGroupSelector(false);
    setSelectedColor('');
    setMode('create');
    setImportFile(null);
    setShareLink('');
    setImportError('');
    setIsImporting(false);
    setFilePickerOpen(false);
    setSelectedFilesystemFile(null);
    setCurrentFolderItems([]);
    setCurrentFolderPath('');
    setFolderBreadcrumbs([{ id: 'root', name: 'Files', path: '' }]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  // Load folder contents for file browser
  const loadFolderContents = async (folderPath: string = '') => {
    if (!user) return;
    
    setIsLoadingFiles(true);
    try {
      const response = await filesystemAPI.listFolder({
        user_id: user.id,
        folder_path: folderPath,
      });

      if (response.success && response.result) {
        const items = response.result.items || [];
        const subfolders = response.result.subfolders || [];
        
        // Combine folders and files, marking which are folders
        const allItems = [
          ...subfolders.map((folder: any) => ({
            id: folder.id,
            name: folder.name,
            type: 'folder',
            path: folder.path || folder.id,
            created_at: folder.created_at || 0,
            isFolder: true,
          })),
          ...items.map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type || 'file',
            s3_key: item.s3_key,
            created_at: item.created_at || 0,
            isFolder: false,
          })),
        ].sort((a, b) => {
          // Sort: folders first, then by name
          if (a.isFolder && !b.isFolder) return -1;
          if (!a.isFolder && b.isFolder) return 1;
          return a.name.localeCompare(b.name);
        });
        
        setCurrentFolderItems(allItems);
      } else {
        setCurrentFolderItems([]);
      }
    } catch (error: any) {
      console.error('Error loading folder contents:', error);
      setImportError(error.message || 'Failed to load folder contents');
      setCurrentFolderItems([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleOpenFilePicker = async () => {
    if (!user) {
      setImportError('Please log in to browse files');
      return;
    }
    
    setFilePickerOpen(true);
    setCurrentFolderPath('');
    setFolderBreadcrumbs([{ id: 'root', name: 'Files', path: '' }]);
    setImportError('');
    await loadFolderContents('');
  };

  const handleFolderClick = async (folder: { id: string; name: string; path: string }) => {
    const folderPath = folder.path || folder.id;
    setCurrentFolderPath(folderPath);
    
    // Update breadcrumbs
    const newBreadcrumbs = [...folderBreadcrumbs];
    const existingIndex = newBreadcrumbs.findIndex(b => b.id === folder.id);
    if (existingIndex >= 0) {
      // Navigate back to this folder
      setFolderBreadcrumbs(newBreadcrumbs.slice(0, existingIndex + 1));
    } else {
      // Navigate into new folder
      setFolderBreadcrumbs([...newBreadcrumbs, folder]);
    }
    
    await loadFolderContents(folderPath);
  };

  const handleBreadcrumbClick = async (breadcrumb: { id: string; path: string }) => {
    if (breadcrumb.id === 'root') {
      setCurrentFolderPath('');
      setFolderBreadcrumbs([{ id: 'root', name: 'Files', path: '' }]);
      await loadFolderContents('');
    } else {
      const breadcrumbIndex = folderBreadcrumbs.findIndex(b => b.id === breadcrumb.id);
      if (breadcrumbIndex >= 0) {
        setCurrentFolderPath(breadcrumb.path);
        setFolderBreadcrumbs(folderBreadcrumbs.slice(0, breadcrumbIndex + 1));
        await loadFolderContents(breadcrumb.path);
      }
    }
  };

  // Check if a file is a dashboard file (.cosine extension)
  const isDashboardFile = (item: { name: string; type: string; s3_key?: string }): boolean => {
    // Check if it has .cosine extension
    if (item.name?.toLowerCase().endsWith('.cosine')) {
      return true;
    }
    // Check if s3_key ends with .cosine
    if (item.s3_key?.toLowerCase().endsWith('.cosine')) {
      return true;
    }
    // Check if it's a context_item type (these are saved as .cosine files)
    if (item.type === 'context_item') {
      return true;
    }
    return false;
  };

  const handleFilePickerSelect = (item: { id: string; name: string; s3_key?: string; type: string }) => {
    if (!item.s3_key) {
      setImportError('File does not have an S3 key');
      return;
    }
    
    setSelectedFilesystemFile({
      id: item.id,
      name: item.name,
      s3_key: item.s3_key,
      folder_path: currentFolderPath,
    });
    setImportFile(null); // Clear uploaded file
    setShareLink(''); // Clear share link
    setImportError('');
    setFilePickerOpen(false);
  };

  const handleModeChange = (_event: React.SyntheticEvent, newMode: DialogMode) => {
    setMode(newMode);
    setImportError('');
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
        flexDirection: 'column',
        borderBottom: '1px solid #374151',
        color: '#ffffff',
        p: 0
      }}>
        {/* Navigation Tabs */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          px: 3,
          pt: 2,
          pb: 1
        }}>
          <Typography sx={{ 
            fontSize: '1.25rem', 
            fontWeight: 600 
          }}>
            {mode === 'create' ? 'Create New Dashboard' : 'Import Dashboard'}
          </Typography>
          <IconButton
            onClick={handleClose}
            sx={{ color: '#9ca3af' }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        
        {/* Mode Toggle Tabs */}
        <Tabs
          value={mode}
          onChange={handleModeChange}
          sx={{
            borderBottom: '1px solid #374151',
            '& .MuiTab-root': {
              color: '#9ca3af',
              textTransform: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
              minHeight: 48,
              '&.Mui-selected': {
                color: '#f59e0b'
              }
            },
            '& .MuiTabs-indicator': {
              backgroundColor: '#f59e0b'
            }
          }}
        >
          <Tab 
            label="Create" 
            value="create"
            icon={<AddIcon sx={{ fontSize: 18, mb: 0.5 }} />}
            iconPosition="start"
          />
          <Tab 
            label="Import" 
            value="import"
            icon={<UploadIcon sx={{ fontSize: 18, mb: 0.5 }} />}
            iconPosition="start"
          />
        </Tabs>
      </DialogTitle>

      <DialogContent sx={{ pt: 4, px: 3 }}>
        {mode === 'create' ? (
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
              mt: 2,
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
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Import Error Alert */}
            {importError && (
              <Alert 
                severity="error" 
                onClose={() => setImportError('')}
                sx={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  '& .MuiAlert-icon': {
                    color: '#ef4444'
                  }
                }}
              >
                {importError}
              </Alert>
            )}

            {/* File Upload Section */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1.5 }}>
                Upload Dashboard File:
              </Typography>
              <Box
                sx={{
                  border: '2px dashed #6b7280',
                  borderRadius: 2,
                  p: 3,
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: importFile ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                  borderColor: importFile ? '#3b82f6' : '#6b7280',
                  '&:hover': {
                    borderColor: '#9ca3af',
                    backgroundColor: 'rgba(55, 65, 81, 0.3)'
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".cosine"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <CloudUploadIcon sx={{ fontSize: 48, color: '#6b7280', mb: 1 }} />
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  {importFile ? importFile.name : 'Click to select a .cosine file'}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6b7280' }}>
                  Supported format: .cosine
                </Typography>
              </Box>
            </Box>

            {/* Divider */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 2 }}>
              <Box sx={{ flex: 1, height: '1px', backgroundColor: '#374151' }} />
              <Typography variant="body2" sx={{ color: '#6b7280' }}>
                OR
              </Typography>
              <Box sx={{ flex: 1, height: '1px', backgroundColor: '#374151' }} />
            </Box>

            {/* Filesystem File Selection Section */}
            <Box>
              <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1.5 }}>
                Select from Filesystem:
              </Typography>
              <Box
                sx={{
                  border: '2px dashed #6b7280',
                  borderRadius: 2,
                  p: 3,
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: selectedFilesystemFile ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                  borderColor: selectedFilesystemFile ? '#3b82f6' : '#6b7280',
                  '&:hover': {
                    borderColor: '#9ca3af',
                    backgroundColor: 'rgba(55, 65, 81, 0.3)'
                  }
                }}
                onClick={handleOpenFilePicker}
              >
                <StorageIcon sx={{ fontSize: 48, color: '#6b7280', mb: 1 }} />
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  {selectedFilesystemFile ? selectedFilesystemFile.name : 'Click to browse your files'}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6b7280' }}>
                  Select a .cosine file from your filesystem
                </Typography>
              </Box>
            </Box>

            {/* Divider */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 2 }}>
              <Box sx={{ flex: 1, height: '1px', backgroundColor: '#374151' }} />
              <Typography variant="body2" sx={{ color: '#6b7280' }}>
                OR
              </Typography>
              <Box sx={{ flex: 1, height: '1px', backgroundColor: '#374151' }} />
            </Box>

            {/* Share Link Section */}
            <Box>
              <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1.5 }}>
                Paste Share Link:
              </Typography>
              <TextField
                value={shareLink}
                onChange={handleLinkChange}
                placeholder="Paste dashboard share link here..."
                fullWidth
                variant="outlined"
                InputProps={{
                  startAdornment: (
                    <LinkIcon sx={{ color: '#6b7280', mr: 1 }} />
                  )
                }}
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
            </Box>
          </Box>
        )}
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
        {mode === 'create' ? (
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
        ) : (
          <Button
            onClick={handleImport}
            disabled={(!importFile && !shareLink.trim() && !selectedFilesystemFile) || isImporting}
            variant="contained"
            startIcon={<UploadIcon />}
            sx={{
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              '&:hover': {
                backgroundColor: '#2563eb'
              },
              '&:disabled': {
                backgroundColor: 'rgba(55, 65, 81, 0.5)',
                color: '#6b7280'
              }
            }}
          >
            {isImporting ? 'Importing...' : 'Import Dashboard'}
          </Button>
        )}
      </DialogActions>

      {/* File Picker Dialog for Filesystem Selection */}
      <Dialog
        open={filePickerOpen}
        onClose={() => setFilePickerOpen(false)}
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
          borderBottom: '1px solid #374151'
        }}>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 600 }}>
            Select Dashboard File
          </Typography>
          <IconButton
            onClick={() => setFilePickerOpen(false)}
            sx={{ color: '#9ca3af' }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 3, minHeight: '300px', maxHeight: '500px', overflow: 'auto' }}>
          {/* Breadcrumbs */}
          <Box sx={{ mb: 2, p: 1.5, border: '1px solid #374151', backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              {folderBreadcrumbs.map((breadcrumb, index) => (
                <React.Fragment key={breadcrumb.id}>
                  {index > 0 && <Typography sx={{ color: '#6b7280' }}>/</Typography>}
                  <Button
                    onClick={() => handleBreadcrumbClick(breadcrumb)}
                    sx={{
                      color: index === folderBreadcrumbs.length - 1 ? '#ffffff' : '#3b82f6',
                      textTransform: 'none',
                      minWidth: 'auto',
                      p: 0.5,
                      fontWeight: index === folderBreadcrumbs.length - 1 ? 600 : 400,
                      '&:hover': {
                        backgroundColor: 'transparent',
                        textDecoration: 'underline',
                      },
                    }}
                  >
                    {breadcrumb.name}
                  </Button>
                </React.Fragment>
              ))}
            </Box>
          </Box>

          {isLoadingFiles ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
              <CircularProgress sx={{ color: '#3b82f6' }} />
              <Typography sx={{ ml: 2, color: '#9ca3af' }}>
                Loading...
              </Typography>
            </Box>
          ) : currentFolderItems.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <FolderIcon sx={{ fontSize: 48, color: '#6b7280', mb: 2 }} />
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                This folder is empty
              </Typography>
            </Box>
          ) : (
            <List sx={{ p: 0, border: '1px solid #374151', borderRadius: 1 }}>
              {currentFolderItems.map((item) => {
                const isDashboard = !item.isFolder && isDashboardFile(item);
                const isSelectable = !item.isFolder && isDashboard;
                
                return (
                  <ListItem
                    key={item.id}
                    {...((isSelectable || item.isFolder) ? { component: 'button' } : {})}
                    onClick={() => {
                      if (item.isFolder) {
                        handleFolderClick({ id: item.id, name: item.name, path: item.path || item.id });
                      } else if (isSelectable) {
                        handleFilePickerSelect(item);
                      }
                    }}
                    disabled={!item.isFolder && !isSelectable}
                    sx={{
                      borderBottom: '1px solid #374151',
                      backgroundColor: selectedFilesystemFile?.id === item.id ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                      cursor: (item.isFolder || isSelectable) ? 'pointer' : 'default',
                      opacity: (!item.isFolder && !isSelectable) ? 0.5 : 1,
                      '&:hover': {
                        backgroundColor: (item.isFolder || isSelectable) ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                        borderLeft: (item.isFolder || isSelectable) ? '2px solid #3b82f6' : 'none',
                      },
                    }}
                  >
                    <ListItemIcon>
                      {item.isFolder ? (
                        <FolderIcon sx={{ color: '#fbbf24' }} />
                      ) : (
                        <FileIcon sx={{ color: isDashboard ? '#3b82f6' : '#6b7280' }} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ color: '#ffffff', fontWeight: 500 }}>
                            {item.name}
                          </Typography>
                          {isDashboard && (
                            <Chip
                              label="Dashboard"
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.65rem',
                                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                color: '#3b82f6',
                                border: '1px solid rgba(59, 130, 246, 0.3)',
                              }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        item.isFolder 
                          ? 'Folder' 
                          : `${item.type} • ${new Date(item.created_at * 1000).toLocaleDateString()}`
                      }
                      secondaryTypographyProps={{ sx: { color: '#9ca3af', fontSize: '0.875rem' } }}
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => setFilePickerOpen(false)}
            sx={{
              color: '#9ca3af',
              '&:hover': {
                backgroundColor: 'rgba(55, 65, 81, 0.5)'
              }
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default NewTabDialog;
