import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  Breadcrumbs,
  Link,
  Menu,
  MenuItem,
  Tooltip,
  Chip,
  Card,
  CardContent,
  Container,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Add as AddIcon,
  CreateNewFolder as CreateFolderIcon,
  MoreVert as MoreVertIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Download as DownloadIcon,
  Visibility as ViewIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';
import FilePreviewDialog from '@/components/common/FilePreviewDialog';
import { filesystemAPI } from '@/services/api';

// Custom styled components matching other pages
const GlassCard = ({ children, sx = {}, ...props }: any) => {
  const safeSx = sx && typeof sx === 'object' ? sx : {};
  
  return (
    <Card
      sx={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '0px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        ...safeSx
      }}
      {...props}
    >
      <CardContent sx={{ p: 0 }}>
        {children}
      </CardContent>
    </Card>
  );
};

interface FileSystemItem {
  id: string;
  name: string;
  type: 'folder' | 'context_item' | 'uploaded_file' | 'agent_file';
  parentId: string | null;
  created_at: number;
  updated_at: number;
  metadata?: {
    title?: string;
    subtitle?: string;
    type?: string;
    data?: any;
    timestamp?: number;
  };
  s3_key?: string; // For preview functionality
}

interface Folder extends FileSystemItem {
  type: 'folder';
}

interface FileItem extends FileSystemItem {
  type: 'context_item' | 'uploaded_file' | 'agent_file';
}

const FilesPage: React.FC = () => {
  const { user } = useAuth();
  
  // File system state (stored in memory/cache for now)
  const [items, setItems] = useState<Map<string, FileSystemItem>>(new Map());
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbPath, setBreadcrumbPath] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'Files' }
  ]);
  
  // Dialog states
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [addFileDialogOpen, setAddFileDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState('');
  const [fileDescription, setFileDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  // Context menu
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedItem, setSelectedItem] = useState<FileSystemItem | null>(null);
  
  // Preview dialog
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<FileSystemItem | null>(null);

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<FileSystemItem | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // Move dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<FileSystemItem | null>(null);
  const [moveDialogCurrentFolder, setMoveDialogCurrentFolder] = useState<string | null>(null);
  const [moveDialogBreadcrumb, setMoveDialogBreadcrumb] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'Files' }
  ]);

  // Load filesystem data from API
  React.useEffect(() => {
    const loadFilesystem = async () => {
      if (!user) return;
      
      try {
        const response = await filesystemAPI.listFolder({
          user_id: user.id,
          folder_path: '',
        });
        
        if (response.success && response.result) {
          const folderMap = new Map<string, FileSystemItem>();
          
          // Add root folder
          const rootFolder: Folder = {
            id: response.result.folder.id || 'root',
            name: response.result.folder.name || 'Files',
            type: 'folder',
            parentId: null,
            created_at: response.result.folder.created_at || Date.now(),
            updated_at: response.result.folder.updated_at || Date.now(),
          };
          folderMap.set(rootFolder.id, rootFolder);
          
          // Add subfolders
          if (response.result.subfolders) {
            response.result.subfolders.forEach((folder: any) => {
              const folderItem: Folder = {
                id: folder.id,
                name: folder.name,
                type: 'folder',
                parentId: 'root', // Will be updated when navigating
                created_at: folder.created_at || Date.now(),
                updated_at: folder.updated_at || Date.now(),
              };
              folderMap.set(folder.id, folderItem);
            });
          }
          
          // Add items
          if (response.result.items) {
            response.result.items.forEach((item: any) => {
              const fileItem: FileItem = {
                id: item.id,
                name: item.name,
                type: item.type as 'context_item' | 'uploaded_file' | 'agent_file',
                parentId: 'root',
                created_at: item.created_at || Date.now(),
                updated_at: item.updated_at || Date.now(),
                metadata: item.metadata,
                s3_key: item.s3_key,
              };
              folderMap.set(item.id, fileItem);
            });
          }
          
          setItems(folderMap);
        }
      } catch (error) {
        console.error('Error loading filesystem:', error);
        // Initialize with root folder on error
        const rootFolder: Folder = {
          id: 'root',
          name: 'Files',
          type: 'folder',
          parentId: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        setItems(new Map([['root', rootFolder]]));
      }
    };
    
    loadFilesystem();
  }, [user]);

  const getCurrentFolderItems = useCallback(() => {
    const folderId = currentFolderId || 'root';
    return Array.from(items.values()).filter(
      item => item.parentId === folderId
    );
  }, [items, currentFolderId]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !user) return;
    
    try {
      const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
      const response = await filesystemAPI.createFolder({
        user_id: user.id,
        folder_name: newFolderName.trim(),
        parent_path: folderPath || undefined,
      });
      
      if (response.success && response.result) {
        const newFolder: Folder = {
          id: response.result.id,
          name: response.result.name,
          type: 'folder',
          parentId: folderPath || 'root',
          created_at: response.result.created_at,
          updated_at: response.result.updated_at,
        };
        
        setItems(prev => new Map(prev).set(newFolder.id, newFolder));
        setNewFolderName('');
        setCreateFolderDialogOpen(false);
      } else {
        console.error('Failed to create folder:', response.error);
        // TODO: Show error message
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      // TODO: Show error message
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!fileTitle) {
        setFileTitle(file.name);
      }
    }
  };

  const handleAddFile = async () => {
    if (!selectedFile || !user) return;
    
    setIsUploading(true);
    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Content = (reader.result as string).split(',')[1]; // Remove data URL prefix
          const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
          
          const response = await filesystemAPI.addFile({
            user_id: user.id,
            folder_path: folderPath,
            file_content: base64Content,
            filename: selectedFile.name,
            title: fileTitle.trim() || undefined,
            description: fileDescription.trim() || undefined,
          });
          
          if (response.success && response.result) {
            // Convert API response to FileSystemItem format
            const newItem: FileItem = {
              id: response.result.id,
              name: response.result.name,
              type: response.result.type as 'context_item' | 'uploaded_file' | 'agent_file',
              parentId: folderPath || 'root',
              created_at: response.result.created_at,
              updated_at: response.result.updated_at,
              metadata: response.result.metadata,
              s3_key: response.result.s3_key,
            };
            
            setItems(prev => new Map(prev).set(newItem.id, newItem));
            setSelectedFile(null);
            setFileTitle('');
            setFileDescription('');
            setAddFileDialogOpen(false);
          } else {
            console.error('Failed to upload file:', response.error);
            // TODO: Show error message to user
          }
        } catch (error) {
          console.error('Error uploading file:', error);
          // TODO: Show error message
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(selectedFile);
    } catch (error) {
      console.error('Error reading file:', error);
      setIsUploading(false);
    }
  };

  const handleFolderClick = (folder: Folder) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbPath(prev => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (folderId: string) => {
    const folderIndex = breadcrumbPath.findIndex(f => f.id === folderId);
    if (folderIndex >= 0) {
      const newPath = breadcrumbPath.slice(0, folderIndex + 1);
      setBreadcrumbPath(newPath);
      setCurrentFolderId(folderId === 'root' ? null : folderId);
    }
  };

  const handleItemClick = (item: FileSystemItem) => {
    if (item.type === 'folder') {
      handleFolderClick(item as Folder);
    } else {
      // Open preview for files
      setPreviewItem(item);
      setPreviewDialogOpen(true);
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>, item: FileSystemItem) => {
    event.stopPropagation();
    setContextMenuAnchor(event.currentTarget);
    setSelectedItem(item);
  };

  const handleDeleteItem = () => {
    if (!selectedItem) return;
    
    // Delete item and all children if it's a folder
    const deleteRecursive = (itemId: string) => {
      setItems(prev => {
        const newMap = new Map(prev);
        newMap.delete(itemId);
        
        // Delete children
        Array.from(newMap.values()).forEach(child => {
          if (child.parentId === itemId) {
            deleteRecursive(child.id);
          }
        });
        
        return newMap;
      });
    };
    
    deleteRecursive(selectedItem.id);
    setContextMenuAnchor(null);
    setSelectedItem(null);
  };

  // Drag and drop handlers
  const handleDragStart = (event: React.DragEvent, item: FileSystemItem) => {
    setDraggedItem(item);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
  };

  const handleDragOver = (event: React.DragEvent, itemId: string, isFolder: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (isFolder) {
      setDragOverFolder(itemId);
    } else {
      setDragOverItem(itemId);
    }
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
    setDragOverFolder(null);
  };

  const handleDrop = (event: React.DragEvent, targetItem: FileSystemItem) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (!draggedItem || draggedItem.id === targetItem.id) {
      setDraggedItem(null);
      setDragOverItem(null);
      setDragOverFolder(null);
      return;
    }

    // If dropping on a folder, move the item into that folder
    if (targetItem.type === 'folder') {
      setItems(prev => {
        const newMap = new Map(prev);
        const item = newMap.get(draggedItem.id);
        if (item) {
          newMap.set(draggedItem.id, {
            ...item,
            parentId: targetItem.id,
            updated_at: Date.now(),
          });
        }
        return newMap;
      });
    } else {
      // If dropping on a file, move to the same parent (reordering)
      const targetParentId = targetItem.parentId;
      setItems(prev => {
        const newMap = new Map(prev);
        const item = newMap.get(draggedItem.id);
        if (item) {
          newMap.set(draggedItem.id, {
            ...item,
            parentId: targetParentId,
            updated_at: Date.now(),
          });
        }
        return newMap;
      });
    }
    
    setDraggedItem(null);
    setDragOverItem(null);
    setDragOverFolder(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
    setDragOverFolder(null);
  };

  const handleRenameItem = () => {
    // TODO: Implement rename functionality
    setContextMenuAnchor(null);
  };

  const handleMoveItem = () => {
    if (!selectedItem) return;
    setItemToMove(selectedItem);
    setMoveDialogCurrentFolder(null);
    setMoveDialogBreadcrumb([{ id: 'root', name: 'Files' }]);
    setMoveDialogOpen(true);
    setContextMenuAnchor(null);
    setSelectedItem(null);
  };

  const handleMoveDialogFolderClick = (folder: Folder) => {
    setMoveDialogCurrentFolder(folder.id);
    setMoveDialogBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleMoveDialogBreadcrumbClick = (folderId: string) => {
    const folderIndex = moveDialogBreadcrumb.findIndex(f => f.id === folderId);
    if (folderIndex >= 0) {
      const newPath = moveDialogBreadcrumb.slice(0, folderIndex + 1);
      setMoveDialogBreadcrumb(newPath);
      setMoveDialogCurrentFolder(folderId === 'root' ? null : folderId);
    }
  };

  const handleConfirmMove = (destinationFolderId: string | null) => {
    if (!itemToMove) return;
    
    // Prevent moving item into itself or its own children
    if (itemToMove.type === 'folder') {
      const isDescendant = (folderId: string, targetId: string): boolean => {
        const folder = items.get(folderId);
        if (!folder || folder.parentId === null) return false;
        if (folder.parentId === targetId) return true;
        return isDescendant(folder.parentId, targetId);
      };
      
      if (destinationFolderId === itemToMove.id || isDescendant(destinationFolderId || 'root', itemToMove.id)) {
        // Don't allow moving folder into itself or its descendants
        setMoveDialogOpen(false);
        setItemToMove(null);
        return;
      }
    }
    
    setItems(prev => {
      const newMap = new Map(prev);
      const item = newMap.get(itemToMove.id);
      if (item) {
        newMap.set(itemToMove.id, {
          ...item,
          parentId: destinationFolderId || 'root',
          updated_at: Date.now(),
        });
      }
      return newMap;
    });
    
    setMoveDialogOpen(false);
    setItemToMove(null);
  };

  const getMoveDialogFolderItems = () => {
    const folderId = moveDialogCurrentFolder || 'root';
    return Array.from(items.values()).filter(
      item => item.parentId === folderId && item.type === 'folder'
    ) as Folder[];
  };

  const getMoveDialogAllItems = () => {
    const folderId = moveDialogCurrentFolder || 'root';
    return Array.from(items.values()).filter(
      item => item.parentId === folderId
    );
  };

  const currentItems = getCurrentFolderItems();
  const folders = currentItems.filter(item => item.type === 'folder') as Folder[];
  const files = currentItems.filter(item => item.type !== 'folder') as FileItem[];

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ color: '#ffffff', fontWeight: 600, mb: 1 }}>
            Files
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            Manage your saved context items and files
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<CreateFolderIcon />}
            onClick={() => setCreateFolderDialogOpen(true)}
            sx={{
              backgroundColor: 'transparent',
              color: '#9ca3af',
              borderRadius: '0px',
              border: '1px solid #374151',
              fontWeight: 600,
              textTransform: 'none',
              px: 2,
              py: 1,
              '&:hover': { 
                backgroundColor: '#475569',
                borderColor: '#334155',
                color: '#9ca3af',
              },
              '& .MuiButton-startIcon': {
                color: '#9ca3af',
                marginRight: '8px',
              },
              '&:hover .MuiButton-startIcon': {
                color: '#9ca3af',
              },
            }}
          >
            New Folder
          </Button>
          <Button
            startIcon={<AddIcon />}
            onClick={() => setAddFileDialogOpen(true)}
            sx={{
              backgroundColor: 'transparent',
              color: '#9ca3af',
              borderRadius: '0px',
              border: '1px solid #374151',
              fontWeight: 600,
              textTransform: 'none',
              px: 2,
              py: 1,
              '&:hover': { 
                backgroundColor: '#475569',
                borderColor: '#334155',
                color: '#9ca3af',
              },
              '& .MuiButton-startIcon': {
                color: '#9ca3af',
                marginRight: '8px',
              },
              '&:hover .MuiButton-startIcon': {
                color: '#9ca3af',
              },
            }}
          >
            Add File
          </Button>
        </Box>
      </Box>

      {/* Breadcrumbs */}
      <GlassCard sx={{ mb: 2, p: 2 }}>
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
              }}
            >
              {folder.name}
            </Link>
          ))}
        </Breadcrumbs>
      </GlassCard>

      {/* Back button */}
      {currentFolderId && (
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => {
            const newPath = breadcrumbPath.slice(0, -1);
            setBreadcrumbPath(newPath);
            setCurrentFolderId(newPath.length > 1 ? newPath[newPath.length - 1].id : null);
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

      {/* File System View */}
      <Box
        onDragOver={(e) => {
          if (draggedItem) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={(e) => {
          if (draggedItem) {
            e.preventDefault();
            e.stopPropagation();
            // Move item to current folder
            setItems(prev => {
              const newMap = new Map(prev);
              const item = newMap.get(draggedItem.id);
              if (item) {
                newMap.set(draggedItem.id, {
                  ...item,
                  parentId: currentFolderId || 'root',
                  updated_at: Date.now(),
                });
              }
              return newMap;
            });
            setDraggedItem(null);
            setDragOverItem(null);
            setDragOverFolder(null);
          }
        }}
        sx={{
          background: 'rgba(15, 23, 42, 0.95)',
          border: dragOverFolder === 'empty-area' ? '1px solid #3b82f6' : '1px solid #374151',
          borderRadius: '0px',
          backgroundColor: dragOverFolder === 'empty-area' ? 'rgba(59, 130, 246, 0.1)' : undefined,
        }}
      >
        {currentItems.length === 0 ? (
          <Box 
            sx={{ 
              p: 4, 
              textAlign: 'center',
              border: dragOverFolder === 'empty-area' ? '2px dashed #3b82f6' : '2px dashed transparent',
              backgroundColor: dragOverFolder === 'empty-area' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
              transition: 'all 0.2s ease',
            }}
            onDragOver={(e) => {
              if (draggedItem) {
                e.preventDefault();
                e.stopPropagation();
                setDragOverFolder('empty-area');
              }
            }}
            onDragLeave={() => {
              setDragOverFolder(null);
            }}
            onDrop={(e) => {
              if (draggedItem) {
                e.preventDefault();
                e.stopPropagation();
                setItems(prev => {
                  const newMap = new Map(prev);
                  const item = newMap.get(draggedItem.id);
                  if (item) {
                    newMap.set(draggedItem.id, {
                      ...item,
                      parentId: currentFolderId || 'root',
                      updated_at: Date.now(),
                    });
                  }
                  return newMap;
                });
                setDraggedItem(null);
                setDragOverFolder(null);
              }
            }}
          >
            <Typography variant="body1" sx={{ color: '#9ca3af', mb: 2 }}>
              This folder is empty
            </Typography>
            <Typography variant="body2" sx={{ color: '#6b7280' }}>
              {draggedItem ? 'Drop here to move item' : 'Create a folder or add a context item to get started'}
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0 }}>
            {/* Folders */}
            {folders.map((folder) => (
              <ListItem
                key={folder.id}
                button
                draggable
                onDragStart={(e) => handleDragStart(e, folder)}
                onDragOver={(e) => handleDragOver(e, folder.id, true)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, folder)}
                onDragEnd={handleDragEnd}
                onClick={() => handleItemClick(folder)}
                onContextMenu={(e) => handleContextMenu(e, folder)}
                sx={{
                  borderBottom: '1px solid #374151',
                  backgroundColor: 'transparent',
                  cursor: 'grab',
                  opacity: draggedItem?.id === folder.id ? 0.5 : 1,
                  borderLeft: dragOverFolder === folder.id ? '3px solid #3b82f6' : 'none',
                  '&:hover': { 
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderLeft: dragOverFolder === folder.id ? '3px solid #3b82f6' : '2px solid #3b82f6',
                  },
                  '&:active': {
                    cursor: 'grabbing',
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
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    onClick={(e) => handleContextMenu(e, folder)}
                    sx={{ 
                      color: '#9ca3af',
                      '&:hover': { 
                        color: '#ffffff',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      },
                    }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}

            {/* Files */}
            {files.map((file) => (
              <ListItem
                key={file.id}
                button
                draggable
                onDragStart={(e) => handleDragStart(e, file)}
                onDragOver={(e) => handleDragOver(e, file.id, false)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, file)}
                onDragEnd={handleDragEnd}
                onClick={() => handleItemClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                sx={{
                  borderBottom: '1px solid #374151',
                  backgroundColor: 'transparent',
                  cursor: 'grab',
                  opacity: draggedItem?.id === file.id ? 0.5 : 1,
                  borderLeft: dragOverItem === file.id ? '3px solid #3b82f6' : 'none',
                  '&:hover': { 
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderLeft: dragOverItem === file.id ? '3px solid #3b82f6' : '2px solid #3b82f6',
                  },
                  '&:active': {
                    cursor: 'grabbing',
                  },
                }}
              >
                <ListItemIcon>
                  <FileIcon sx={{ color: '#3b82f6' }} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ color: '#ffffff', fontWeight: 500 }}>{file.name}</Typography>
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
                  secondary={
                    file.metadata?.subtitle || 
                    `Context Item • ${new Date(file.created_at).toLocaleDateString()}`
                  }
                  secondaryTypographyProps={{ sx: { color: '#9ca3af', fontSize: '0.875rem' } }}
                />
                <ListItemSecondaryAction>
                  <Tooltip title="View">
                    <IconButton
                      edge="end"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewItem(file);
                        setPreviewDialogOpen(true);
                      }}
                      sx={{ 
                        color: '#3b82f6',
                        mr: 1,
                        '&:hover': { 
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        },
                      }}
                    >
                      <ViewIcon />
                    </IconButton>
                  </Tooltip>
                  <IconButton
                    edge="end"
                    onClick={(e) => handleContextMenu(e, file)}
                    sx={{ 
                      color: '#9ca3af',
                      '&:hover': { 
                        color: '#ffffff',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      },
                    }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {/* Create Folder Dialog */}
      <Dialog
        open={createFolderDialogOpen}
        onClose={() => setCreateFolderDialogOpen(false)}
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
          Create New Folder
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <TextField
            autoFocus
            margin="dense"
            label="Folder Name"
            fullWidth
            variant="outlined"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleCreateFolder();
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
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button 
            onClick={() => setCreateFolderDialogOpen(false)} 
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
            onClick={handleCreateFolder}
            variant="contained"
            sx={{
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              borderRadius: '0px',
              border: '1px solid #2563eb',
              '&:hover': { backgroundColor: '#2563eb' },
            }}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add File Dialog */}
      <Dialog
        open={addFileDialogOpen}
        onClose={() => {
          if (!isUploading) {
            setAddFileDialogOpen(false);
            setSelectedFile(null);
            setFileTitle('');
            setFileDescription('');
          }
        }}
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
          Add File
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Box sx={{ mb: 2 }}>
            <input
              accept="*/*"
              style={{ display: 'none' }}
              id="file-upload-input"
              type="file"
              onChange={handleFileSelect}
              disabled={isUploading}
            />
            <label htmlFor="file-upload-input">
              <Button
                variant="outlined"
                component="span"
                fullWidth
                startIcon={<AddIcon />}
                disabled={isUploading}
                sx={{
                  color: '#9ca3af',
                  borderColor: '#374151',
                  borderRadius: '0px',
                  py: 2,
                  '&:hover': {
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: '#3b82f6',
                  },
                }}
              >
                {selectedFile ? selectedFile.name : 'Choose File'}
              </Button>
            </label>
            {selectedFile && (
              <Typography variant="caption" sx={{ color: '#6b7280', mt: 1, display: 'block' }}>
                {(selectedFile.size / 1024).toFixed(2)} KB
              </Typography>
            )}
          </Box>
          <TextField
            autoFocus
            margin="dense"
            label="Title (optional)"
            fullWidth
            variant="outlined"
            value={fileTitle}
            onChange={(e) => setFileTitle(e.target.value)}
            placeholder={selectedFile?.name || 'File name'}
            disabled={isUploading}
            sx={{
              mb: 2,
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
          <TextField
            margin="dense"
            label="Description (optional)"
            fullWidth
            variant="outlined"
            multiline
            rows={3}
            value={fileDescription}
            onChange={(e) => setFileDescription(e.target.value)}
            disabled={isUploading}
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
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button 
            onClick={() => {
              setAddFileDialogOpen(false);
              setSelectedFile(null);
              setFileTitle('');
              setFileDescription('');
            }}
            disabled={isUploading}
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
            onClick={handleAddFile}
            variant="contained"
            disabled={!selectedFile || isUploading}
            sx={{
              backgroundColor: '#10b981',
              color: '#ffffff',
              borderRadius: '0px',
              border: '1px solid #059669',
              '&:hover': { backgroundColor: '#059669' },
              '&:disabled': {
                backgroundColor: '#374151',
                color: '#6b7280',
                borderColor: '#374151',
              },
            }}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={() => {
          setContextMenuAnchor(null);
          setSelectedItem(null);
        }}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            borderRadius: '0px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            '& .MuiMenuItem-root': {
              color: '#ffffff',
              borderRadius: '0px',
              '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
            },
          },
        }}
      >
        {selectedItem?.type !== 'folder' && (
          <MenuItem onClick={() => {
            if (selectedItem) {
              setPreviewItem(selectedItem);
              setPreviewDialogOpen(true);
            }
            setContextMenuAnchor(null);
          }}>
            <ViewIcon sx={{ mr: 1.5, fontSize: 18, color: '#3b82f6' }} />
            View
          </MenuItem>
        )}
        <MenuItem onClick={handleRenameItem}>
          <EditIcon sx={{ mr: 1.5, fontSize: 18, color: '#9ca3af' }} />
          Rename
        </MenuItem>
        <MenuItem onClick={handleMoveItem}>
          <FolderIcon sx={{ mr: 1.5, fontSize: 18, color: '#3b82f6' }} />
          Move
        </MenuItem>
        <MenuItem 
          onClick={handleDeleteItem} 
          sx={{ 
            color: '#ef4444',
            '&:hover': { 
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
            },
          }}
        >
          <DeleteIcon sx={{ mr: 1.5, fontSize: 18, color: '#ef4444' }} />
          Delete
        </MenuItem>
      </Menu>

      {/* File Preview Dialog */}
      {previewItem && (
        <FilePreviewDialog
          open={previewDialogOpen}
          onClose={() => {
            setPreviewDialogOpen(false);
            setPreviewItem(null);
          }}
          item={{
            id: previewItem.id,
            name: previewItem.name,
            type: previewItem.type as 'context_item' | 'uploaded_file' | 'agent_file',
            s3_key: previewItem.s3_key || '',
            metadata: previewItem.metadata,
          }}
          user_id={user?.id || ''}
        />
      )}

      {/* Move Dialog */}
      <Dialog
        open={moveDialogOpen}
        onClose={() => {
          setMoveDialogOpen(false);
          setItemToMove(null);
        }}
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
          Move "{itemToMove?.name}"
        </DialogTitle>
        <DialogContent sx={{ pt: 3, minHeight: '400px' }}>
          {/* Breadcrumbs */}
          <GlassCard sx={{ mb: 2, p: 1.5 }}>
            <Breadcrumbs
              sx={{ color: '#9ca3af' }}
              separator={<Typography sx={{ color: '#6b7280' }}>/</Typography>}
            >
              {moveDialogBreadcrumb.map((folder, index) => (
                <Link
                  key={folder.id}
                  component="button"
                  variant="body2"
                  onClick={() => handleMoveDialogBreadcrumbClick(folder.id)}
                  sx={{
                    color: index === moveDialogBreadcrumb.length - 1 ? '#ffffff' : '#3b82f6',
                    textDecoration: 'none',
                    cursor: 'pointer',
                    fontWeight: index === moveDialogBreadcrumb.length - 1 ? 600 : 400,
                    '&:hover': { textDecoration: 'underline' },
                  }}
                >
                  {folder.name}
                </Link>
              ))}
            </Breadcrumbs>
          </GlassCard>

          {/* Back button */}
          {moveDialogCurrentFolder && (
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => {
                const newPath = moveDialogBreadcrumb.slice(0, -1);
                setMoveDialogBreadcrumb(newPath);
                setMoveDialogCurrentFolder(newPath.length > 1 ? newPath[newPath.length - 1].id : null);
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

          {/* Items list */}
          <GlassCard>
            <List sx={{ p: 0 }}>
              {/* Folders in current location */}
              {getMoveDialogFolderItems().map((folder) => (
                <ListItem
                  key={folder.id}
                  button
                  onClick={() => handleMoveDialogFolderClick(folder)}
                  sx={{
                    borderBottom: '1px solid #374151',
                    backgroundColor: 'transparent',
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

              {/* Files in current location */}
              {getMoveDialogAllItems()
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
          </GlassCard>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2, justifyContent: 'space-between' }}>
          <Button 
            onClick={() => {
              setMoveDialogOpen(false);
              setItemToMove(null);
            }} 
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
            onClick={() => handleConfirmMove(moveDialogCurrentFolder || 'root')}
            variant="contained"
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
          >
            Move here
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
    </Box>
  );
};

export default FilesPage;

