import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Breadcrumbs,
  Link,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Box,
  Chip,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  ArrowBack as ArrowBackIcon,
  CreateNewFolder as CreateFolderIcon,
} from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';
import { filesystemAPI } from '@/services/api';

interface FileBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folderPath: string) => void;
  allowCreateFolder?: boolean;
  title?: string;
}

interface Folder {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

interface FileItem {
  id: string;
  name: string;
  type: string;
  created_at: number;
  updated_at: number;
}

const FileBrowserDialog: React.FC<FileBrowserDialogProps> = ({
  open,
  onClose,
  onSelect,
  allowCreateFolder = true,
  title = 'Select Folder',
}) => {
  const { user } = useAuth();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbPath, setBreadcrumbPath] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'Files' }
  ]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<FileItem[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const loadFolderContents = async (folderPath: string = '') => {
    if (!user) return;
    
    console.log(`📁 FileBrowserDialog: Loading folder contents for folder_path: "${folderPath}"`);
    try {
      const response = await filesystemAPI.listFolder({
        user_id: user.id,
        folder_path: folderPath,
      });
      
      if (response.success && response.result) {
        const subfolders = response.result.subfolders || [];
        const items = response.result.items || [];
        console.log(`✅ FileBrowserDialog: Loaded ${subfolders.length} folders and ${items.length} items from folder_path: "${folderPath}"`);
        setFolders(subfolders);
        setItems(items);
      } else {
        console.error(`❌ FileBrowserDialog: Failed to load folder from folder_path: "${folderPath}"`, response.error);
      }
    } catch (error) {
      console.error(`❌ FileBrowserDialog: Error loading folder contents for folder_path: "${folderPath}"`, error);
    }
  };

  useEffect(() => {
    if (open && user) {
      setCurrentFolderId(null);
      setBreadcrumbPath([{ id: 'root', name: 'Files' }]);
      loadFolderContents('');
    }
  }, [open, user]);

  const handleFolderClick = async (folder: Folder) => {
    console.log(`📁 FileBrowserDialog: Clicked on folder:`, {
      folderId: folder.id,
      folderName: folder.name,
      folderPath: folder.path,
    });
    setCurrentFolderId(folder.id);
    setBreadcrumbPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    // Use folder.id as folder_path (like FolderTile and FilesPage do)
    // The API expects folder ID, not folder path
    const folderPath = folder.id === 'root' ? '' : folder.id;
    console.log(`📁 FileBrowserDialog: Navigating to folder with folder_path: "${folderPath}"`);
    await loadFolderContents(folderPath);
  };

  const handleBreadcrumbClick = async (folderId: string) => {
    const folderIndex = breadcrumbPath.findIndex(f => f.id === folderId);
    if (folderIndex >= 0) {
      const newPath = breadcrumbPath.slice(0, folderIndex + 1);
      setBreadcrumbPath(newPath);
      setCurrentFolderId(folderId === 'root' ? null : folderId);
      
      const folderPath = folderId === 'root' ? '' : folderId;
      await loadFolderContents(folderPath);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !user || isCreatingFolder) return;
    
    setIsCreatingFolder(true);
    try {
      const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
      const response = await filesystemAPI.createFolder({
        user_id: user.id,
        folder_name: newFolderName.trim(),
        parent_path: folderPath || undefined,
      });
      
      if (response.success && response.result) {
        setNewFolderName('');
        setShowCreateFolder(false);
        await loadFolderContents(folderPath);
      } else {
        console.error('Failed to create folder:', response.error);
      }
    } catch (error) {
      console.error('Error creating folder:', error);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const isSelectingRef = useRef(false);

  const handleSelect = () => {
    // Prevent multiple simultaneous selections
    if (isSelectingRef.current) {
      console.warn('📁 FileBrowserDialog: Select operation already in progress, ignoring duplicate call');
      return;
    }
    
    isSelectingRef.current = true;
    const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
    onSelect(folderPath);
    onClose();
    
    // Reset after a short delay to allow the operation to complete
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 1000);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid #374151',
          borderRadius: '0px',
          color: '#ffffff',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #374151', pb: 2 }}>
        {title}
      </DialogTitle>
      <DialogContent sx={{ pt: 3, minHeight: '400px' }}>
        {/* Breadcrumbs */}
        <Box sx={{ mb: 2, p: 1.5, border: '1px solid #374151', backgroundColor: 'rgba(30, 41, 59, 0.5)' }}>
          <Breadcrumbs
            sx={{ color: '#9ca3af' }}
            separator={<Typography sx={{ color: '#6b7280' }}>/</Typography>}
          >
            {breadcrumbPath.map((folder, index) => (
              <Link
                key={folder.id}
                component="button"
                variant="body2"
                onClick={() => handleBreadcrumbClick(folder.id)}
                sx={{
                  color: index === breadcrumbPath.length - 1 ? '#ffffff' : '#3b82f6',
                  textDecoration: 'none',
                  cursor: 'pointer',
                  fontWeight: index === breadcrumbPath.length - 1 ? 600 : 400,
                  '&:hover': { textDecoration: 'underline' },
                  border: 'none',
                  background: 'none',
                  padding: 0,
                }}
              >
                {folder.name}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>

        {/* Back button */}
        {currentFolderId && (
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={async () => {
              const newPath = breadcrumbPath.slice(0, -1);
              setBreadcrumbPath(newPath);
              const newFolderId = newPath.length > 1 ? newPath[newPath.length - 1].id : null;
              setCurrentFolderId(newFolderId);
              
              const folderPath = newFolderId === 'root' ? '' : newFolderId || '';
              await loadFolderContents(folderPath);
            }}
            sx={{ 
              mb: 2, 
              color: '#9ca3af',
              border: '1px solid #374151',
              borderRadius: '0px',
              '&:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderColor: '#3b82f6',
              },
            }}
            variant="outlined"
          >
            Back
          </Button>
        )}

        {/* Create Folder */}
        {allowCreateFolder && (
          <Box sx={{ mb: 2 }}>
            {!showCreateFolder ? (
              <Button
                startIcon={<CreateFolderIcon />}
                onClick={() => setShowCreateFolder(true)}
                sx={{
                  color: '#9ca3af',
                  border: '1px solid #374151',
                  borderRadius: '0px',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderColor: '#3b82f6',
                    color: '#3b82f6',
                  },
                }}
                variant="outlined"
                fullWidth
              >
                New Folder
              </Button>
            ) : (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateFolder();
                    } else if (e.key === 'Escape') {
                      setShowCreateFolder(false);
                      setNewFolderName('');
                    }
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      color: '#ffffff',
                      borderRadius: '0px',
                      '& fieldset': { borderColor: '#374151', borderWidth: '2px' },
                      '&:hover fieldset': { borderColor: '#4b5563' },
                      '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                    },
                    '& .MuiInputLabel-root': { color: '#9ca3af' },
                  }}
                />
                <Button
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim() || isCreatingFolder}
                  sx={{
                    color: '#ffffff',
                    backgroundColor: '#3b82f6',
                    borderRadius: '0px',
                    border: '1px solid #2563eb',
                    minWidth: 80,
                    '&:hover': { backgroundColor: '#2563eb' },
                    '&:disabled': {
                      backgroundColor: '#374151',
                      color: '#6b7280',
                      borderColor: '#374151',
                    },
                  }}
                >
                  {isCreatingFolder ? '...' : 'Create'}
                </Button>
                <Button
                  onClick={() => {
                    setShowCreateFolder(false);
                    setNewFolderName('');
                  }}
                  sx={{
                    color: '#9ca3af',
                    border: '1px solid #374151',
                    borderRadius: '0px',
                    minWidth: 60,
                    '&:hover': {
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      borderColor: '#ef4444',
                      color: '#ef4444',
                    },
                  }}
                  variant="outlined"
                >
                  Cancel
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Items list */}
        <Box sx={{ border: '1px solid #374151', backgroundColor: 'rgba(30, 41, 59, 0.3)' }}>
          <List sx={{ p: 0, maxHeight: '300px', overflow: 'auto' }}>
            {/* Folders */}
            {folders.map((folder) => (
              <ListItem
                key={folder.id}
                button
                onClick={() => handleFolderClick(folder)}
                sx={{
                  borderBottom: '1px solid #374151',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  '&:hover': { 
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderLeft: '2px solid #3b82f6',
                  },
                }}
              >
                <ListItemIcon>
                  <FolderIcon sx={{ color: '#fbbf24' }} />
                </ListItemIcon>
                <ListItemText
                  primary={folder.name}
                  secondary={`Folder • ${new Date(folder.created_at).toLocaleDateString()}`}
                  primaryTypographyProps={{ sx: { color: '#ffffff', fontWeight: 500 } }}
                  secondaryTypographyProps={{ sx: { color: '#9ca3af', fontSize: '0.875rem' } }}
                />
              </ListItem>
            ))}

            {/* Files (shown but not selectable) */}
            {items
              .filter(item => item.type !== 'folder')
              .map((file) => (
                <ListItem
                  key={file.id}
                  sx={{
                    borderBottom: '1px solid #374151',
                    backgroundColor: 'transparent',
                    opacity: 0.6,
                  }}
                >
                  <ListItemIcon>
                    <FileIcon sx={{ color: '#3b82f6' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ color: '#9ca3af', fontWeight: 400 }}>{file.name}</Typography>
                        <Chip
                          label={file.type.replace('_', ' ')}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.65rem',
                            backgroundColor: 'rgba(59, 130, 246, 0.2)',
                            color: '#3b82f6',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '0px',
                          }}
                        />
                      </Box>
                    }
                    secondary={`${new Date(file.created_at).toLocaleDateString()}`}
                    secondaryTypographyProps={{ sx: { color: '#6b7280', fontSize: '0.75rem' } }}
                  />
                </ListItem>
              ))}
          </List>
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #374151', p: 2, justifyContent: 'space-between' }}>
        <Button 
          onClick={onClose}
          sx={{ 
            color: '#9ca3af',
            borderRadius: '0px',
            border: '1px solid #374151',
            '&:hover': {
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderColor: '#ef4444',
              color: '#ef4444',
            },
          }}
          variant="outlined"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSelect}
          sx={{
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            borderRadius: '0px',
            border: '1px solid #2563eb',
            fontWeight: 600,
            '&:hover': {
              backgroundColor: '#2563eb',
            },
          }}
          variant="contained"
        >
          Select Here
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FileBrowserDialog;




