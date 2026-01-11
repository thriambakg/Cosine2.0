import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Breadcrumbs,
  Link,
} from '@mui/material';
import {
  Close as CloseIcon,
  Upload as UploadIcon,
  Storage as StorageIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { filesystemAPI, fileReturnAPI } from '@/services/api';
import { dashboardAPI } from '@/services/dashboardAPI';
import { useAuth } from '@/contexts/AuthContext';

interface TileImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImportSuccess?: (tileData: any) => void;
}

const TileImportDialog: React.FC<TileImportDialogProps> = ({
  open,
  onClose,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Filesystem import state
  const [currentFolderPath, setCurrentFolderPath] = useState<string>('');
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string; name: string; path: string }>>([{ id: 'root', name: 'Files', path: '' }]);
  const [currentFolderItems, setCurrentFolderItems] = useState<Array<{ id: string; name: string; type: string; s3_key?: string; created_at: number }>>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFilesystemFile, setSelectedFilesystemFile] = useState<{ id: string; name: string; s3_key: string; folder_path: string } | null>(null);
  
  const { user } = useAuth();

  // Load folder contents for filesystem browser
  const loadFolderContents = async (folderPath: string = '') => {
    if (!user) return;
    
    setIsLoadingFiles(true);
    try {
      const response = await filesystemAPI.listFolder({
        user_id: user.id,
        folder_path: folderPath,
      });
      
      if (response.success && response.result) {
        const subfolders = (response.result.subfolders || []).map((folder: any) => ({
          id: folder.id,
          name: folder.name,
          type: 'folder',
          created_at: folder.created_at || Date.now(),
        }));
        const items = (response.result.items || [])
          .filter((item: any) => item.s3_key && item.s3_key.endsWith('.cs'))
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type || 'context_item',
            s3_key: item.s3_key,
            created_at: item.created_at || Date.now(),
          }));
        setCurrentFolderItems([...subfolders, ...items]);
      }
    } catch (error) {
      console.error('Error loading folder contents:', error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (open && activeTab === 1 && user) {
      setCurrentFolderPath('');
      setFolderBreadcrumbs([{ id: 'root', name: 'Files', path: '' }]);
      loadFolderContents('');
    }
  }, [open, activeTab, user]);

  const handleFolderClick = async (folder: { id: string; name: string }) => {
    const folderPath = folder.id === 'root' ? '' : folder.id;
    setCurrentFolderPath(folderPath);
    setFolderBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name, path: folderPath }]);
    await loadFolderContents(folderPath);
  };

  const handleBreadcrumbClick = async (folderId: string) => {
    const folderIndex = folderBreadcrumbs.findIndex(f => f.id === folderId);
    if (folderIndex >= 0) {
      const newPath = folderBreadcrumbs.slice(0, folderIndex + 1);
      setFolderBreadcrumbs(newPath);
      const folderPath = folderId === 'root' ? '' : folderId;
      setCurrentFolderPath(folderPath);
      await loadFolderContents(folderPath);
    }
  };

  const handleFilesystemFileSelect = (item: { id: string; name: string; s3_key: string }) => {
    setSelectedFilesystemFile({
      id: item.id,
      name: item.name,
      s3_key: item.s3_key,
      folder_path: currentFolderPath,
    });
    setImportFile(null);
    setError('');
  };

  const handleClose = () => {

    setActiveTab(0);
    setImportFile(null);
    setError('');
    setSuccess('');
    setSelectedFilesystemFile(null);
    setCurrentFolderPath('');
    setFolderBreadcrumbs([{ id: 'root', name: 'Files', path: '' }]);
    setCurrentFolderItems([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  const handleImportFile = async () => {
    let fileToImport: File | null = importFile;
    
    // If filesystem file is selected, download it first
    if (selectedFilesystemFile && !importFile) {
      if (!user) {
        setError('User not authenticated');
        return;
      }
      
      try {
        setLoading(true);
        setError('');
        
        // Download file from filesystem
        const fileResponse = await fileReturnAPI.getFileContent({
          user_id: user.id,
          s3_key: selectedFilesystemFile.s3_key,
          bucket: undefined,
        });
        
        if (!fileResponse.success || !fileResponse.file_content) {
          setError('Failed to download file from filesystem');
          setLoading(false);
          return;
        }
        
        // Convert base64 to File object
        const base64Content = fileResponse.file_content;
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileToImport = new File([bytes], selectedFilesystemFile.name, { 
          type: 'application/json' 
        });
      } catch (error: any) {
        console.error('Error downloading file from filesystem:', error);
        setError(error.message || 'Failed to download file from filesystem');
        setLoading(false);
        return;
      }
    }
    
    if (!fileToImport) {
      setError('Please select a file');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Read file as ArrayBuffer to get raw bytes
      const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result) {
            resolve(reader.result as ArrayBuffer);
          } else {
            reject(new Error('Failed to read file'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(fileToImport);
      });

      // Convert to base64 for transmission
      const bytes = new Uint8Array(fileContent);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Content = btoa(binary);

      // Send to backend for decryption and import
      const response = await dashboardAPI.importTile({
        fileContent: base64Content,
        tabId: undefined, // Will use active tab
      });

      if (response.tile) {
        setSuccess('Tile imported successfully!');
        if (onImportSuccess) {
          onImportSuccess(response.tile);
        }
        setTimeout(() => {
          handleClose();
        }, 1500);
      } else {
        setError('Failed to import tile');
      }
    } catch (err: any) {
      console.error('Error importing tile:', err);
      setError(err.message || 'Failed to import tile');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.cs')) {
        setError('Please select a valid .cs file');
        return;
      }
      setImportFile(file);
      setSelectedFilesystemFile(null);
      setError('');
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
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #374151',
          zIndex: 1500,
        },
      }}
      sx={{
        zIndex: 1500,
      }}
      BackdropProps={{
        sx: {
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 1499,
        },
        onClick: (e) => {
          e.stopPropagation();
          handleClose();
        },
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#ffffff' }}>
        Import Tile
        <IconButton onClick={handleClose} sx={{ color: '#9ca3af' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box>
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            sx={{
              mb: 2,
              '& .MuiTab-root': {
                color: '#9ca3af',
                '&.Mui-selected': { color: '#3b82f6' },
              },
              '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' },
            }}
          >
            <Tab icon={<UploadIcon />} iconPosition="start" label="Upload File" />
            <Tab icon={<StorageIcon />} iconPosition="start" label="Filesystem" />
          </Tabs>

          {activeTab === 0 && (
            <Box>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".cs"
                style={{ display: 'none' }}
              />
              <Button
                fullWidth
                variant="outlined"
                onClick={() => fileInputRef.current?.click()}
                sx={{
                  mb: 2,
                  backgroundColor: 'rgba(31, 41, 55, 0.5)',
                  border: '2px solid #4b5563',
                  borderRadius: '0px',
                  borderColor: '#4b5563',
                  color: '#9ca3af',
                  fontWeight: 600,
                  textTransform: 'none',
                  px: 2,
                  py: 1,
                  '&:hover': { 
                    backgroundColor: '#475569',
                    borderColor: '#6b7280',
                    color: '#9ca3af',
                  },
                }}
              >
                {importFile ? importFile.name : 'Select .cs File'}
              </Button>
              <Button
                fullWidth
                variant="outlined"
                onClick={handleImportFile}
                disabled={loading || !importFile}
                sx={{
                  backgroundColor: 'rgba(31, 41, 55, 0.5)',
                  color: '#9ca3af',
                  borderRadius: '0px',
                  border: '2px solid #4b5563',
                  fontWeight: 600,
                  textTransform: 'none',
                  px: 2,
                  py: 1,
                  '&:hover': {
                    backgroundColor: '#475569',
                    borderColor: '#6b7280',
                    color: '#9ca3af',
                  },
                  '&:disabled': {
                    backgroundColor: 'rgba(31, 41, 55, 0.3)',
                    borderColor: '#4b5563',
                    color: '#6b7280',
                  },
                }}
              >
                {loading ? <CircularProgress size={24} sx={{ color: '#9ca3af' }} /> : 'Import Tile'}
              </Button>
            </Box>
          )}

          {activeTab === 1 && (
            <Box>
              {/* Breadcrumbs */}
              <Box sx={{ mb: 2, p: 1.5, border: '1px solid #374151', backgroundColor: 'rgba(30, 41, 59, 0.5)' }}>
                <Breadcrumbs
                  sx={{ color: '#9ca3af' }}
                  separator={<Typography sx={{ color: '#6b7280' }}>/</Typography>}
                >
                  {folderBreadcrumbs.map((folder, index) => (
                    <Link
                      key={folder.id}
                      component="button"
                      variant="body2"
                      onClick={() => handleBreadcrumbClick(folder.id)}
                      sx={{
                        color: index === folderBreadcrumbs.length - 1 ? '#ffffff' : '#3b82f6',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        fontWeight: index === folderBreadcrumbs.length - 1 ? 600 : 400,
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
              {currentFolderPath && (
                <Button
                  startIcon={<ArrowBackIcon />}
                  onClick={async () => {
                    const newPath = folderBreadcrumbs.slice(0, -1);
                    setFolderBreadcrumbs(newPath);
                    const newFolderId = newPath.length > 1 ? newPath[newPath.length - 1].id : 'root';
                    const folderPath = newFolderId === 'root' ? '' : newFolderId;
                    setCurrentFolderPath(folderPath);
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

              {/* Files list */}
              <Box sx={{ border: '1px solid #374151', backgroundColor: 'rgba(30, 41, 59, 0.3)', mb: 2, maxHeight: '300px', overflow: 'auto' }}>
                {isLoadingFiles ? (
                  <Box sx={{ p: 3, textAlign: 'center' }}>
                    <CircularProgress size={24} sx={{ color: '#9ca3af' }} />
                  </Box>
                ) : currentFolderItems.length === 0 ? (
                  <Box sx={{ p: 3, textAlign: 'center', color: '#6b7280' }}>
                    <Typography variant="body2">No .cs files found in this folder</Typography>
                  </Box>
                ) : (
                  <List sx={{ p: 0 }}>
                    {currentFolderItems.map((item) => (
                      <ListItem
                        key={item.id}
                        button
                        onClick={() => {
                          if (item.type === 'folder') {
                            handleFolderClick(item as any);
                          } else {
                            handleFilesystemFileSelect(item as any);
                          }
                        }}
                        selected={selectedFilesystemFile?.id === item.id}
                        sx={{
                          borderBottom: '1px solid #374151',
                          backgroundColor: selectedFilesystemFile?.id === item.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                          cursor: 'pointer',
                          '&:hover': { 
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            borderLeft: '2px solid #3b82f6',
                          },
                        }}
                      >
                        <ListItemIcon>
                          {item.type === 'folder' ? (
                            <FolderIcon sx={{ color: '#fbbf24' }} />
                          ) : (
                            <FileIcon sx={{ color: '#3b82f6' }} />
                          )}
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography sx={{ color: '#ffffff', fontWeight: 500 }}>{item.name}</Typography>
                              {item.type !== 'folder' && (
                                <Chip
                                  label=".cs"
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
                              )}
                            </Box>
                          }
                          secondary={item.type === 'folder' ? 'Folder' : `File • ${new Date(item.created_at).toLocaleDateString()}`}
                          secondaryTypographyProps={{ sx: { color: '#9ca3af', fontSize: '0.875rem' } }}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>

              {selectedFilesystemFile && (
                <Alert severity="success" sx={{ mb: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#6ee7b7', borderRadius: '0px' }}>
                  Selected: {selectedFilesystemFile.name}
                </Alert>
              )}

              <Button
                fullWidth
                variant="outlined"
                onClick={handleImportFile}
                disabled={loading || !selectedFilesystemFile}
                sx={{
                  backgroundColor: 'rgba(31, 41, 55, 0.5)',
                  color: '#9ca3af',
                  borderRadius: '0px',
                  border: '2px solid #4b5563',
                  fontWeight: 600,
                  textTransform: 'none',
                  px: 2,
                  py: 1,
                  '&:hover': {
                    backgroundColor: '#475569',
                    borderColor: '#6b7280',
                    color: '#9ca3af',
                  },
                  '&:disabled': {
                    backgroundColor: 'rgba(31, 41, 55, 0.3)',
                    borderColor: '#4b5563',
                    color: '#6b7280',
                  },
                }}
              >
                {loading ? <CircularProgress size={24} sx={{ color: '#9ca3af' }} /> : 'Import Tile'}
              </Button>
            </Box>
          )}
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2, backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#fca5a5' }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mt: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#6ee7b7' }}>
            {success}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: '1px solid #374151' }}>
        <Button onClick={handleClose} sx={{ color: '#9ca3af' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TileImportDialog;
