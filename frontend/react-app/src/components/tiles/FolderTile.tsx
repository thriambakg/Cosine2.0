import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  Checkbox,
  Chip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Close as CloseIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  CreateNewFolder as CreateFolderIcon,
  UploadFile as UploadFileIcon,
  Delete as DeleteIcon,
  MoreVert as MoreVertIcon,
  Chat as SidebarChatIcon,
  Dashboard as AddToContextIcon,
} from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';
import { filesystemAPI } from '@/services/api';
import { addToContext } from './common/contextManager';
import { TileHeaderActions, TileCustomizationDialog, confirmDialog, useTilePinning, getIconByName, getDefaultIconForTileType } from './common';
import FileBrowserDialog from '../common/FileBrowserDialog';
import FilePreviewDialog from '../common/FilePreviewDialog';

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
  s3_key?: string;
}

interface FolderTileProps {
  id: string;
  size?: { width: number; height: number };
  position?: { x: number; y: number };
  gridPosition?: { x: number; y: number };
  gridSize?: { width: number; height: number };
  folderPath?: string; // Path to the folder to display (empty string for root)
  folderId?: string; // ID of the folder to display
  customTitle?: string;
  customColor?: string;
  customIcon?: React.ReactNode;
  isPinned?: boolean;
  dashboardContext?: string;
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResize?: (id: string, size: { width: number; height: number }) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  onResizeStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (id: string, selected: boolean) => void;
}

const FolderTile: React.FC<FolderTileProps> = ({
  id,
  folderPath = '',
  customTitle,
  customColor = '#fbbf24',
  customIcon,
  isPinned = false,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isSelected = false,
  onSelectionChange,
}) => {
  const { user } = useAuth();
  
  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });

  // Folder state
  const [items, setItems] = useState<FileSystemItem[]>([]);
  const [folders, setFolders] = useState<FileSystemItem[]>([]);
  const [currentFolderPath, setCurrentFolderPath] = useState<string>(folderPath);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [uploadFileDialogOpen, setUploadFileDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);

  // Context menu
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [itemContextMenuAnchor, setItemContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedItem, setSelectedItem] = useState<FileSystemItem | null>(null);
  const [folderSelectionDialogOpen, setFolderSelectionDialogOpen] = useState(false);
  
  // Preview dialog
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<FileSystemItem | null>(null);
  
  // Multi-select state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Load folder contents
  const loadFolderContents = useCallback(async (path: string = '') => {
    if (!user) return;
    
    console.log(`📁 FolderTile [${id}]: Loading folder contents for path: "${path}"`);
    setIsLoading(true);
    setError(null);
    try {
      const response = await filesystemAPI.listFolder({
        user_id: user.id,
        folder_path: path,
      });
      
      if (response.success && response.result) {
        const subfolders = (response.result.subfolders || []).map((folder: any) => ({
          ...folder,
          type: 'folder' as const, // Ensure type is set correctly
        }));
        const items = (response.result.items || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type || 'context_item',
          parentId: path || null,
          created_at: item.created_at || Date.now(),
          updated_at: item.updated_at || Date.now(),
          metadata: item.metadata, // Include full metadata for previews
          s3_key: item.s3_key, // Include s3_key for preview functionality
        }));
        console.log(`✅ FolderTile [${id}]: Loaded ${subfolders.length} folders and ${items.length} items from path: "${path}"`);
        console.log(`📁 FolderTile [${id}]: Sample folder data:`, subfolders[0] || 'none');
        console.log(`📁 FolderTile [${id}]: Sample item data:`, items[0] || 'none');
        setFolders(subfolders);
        setItems(items);
      } else {
        console.error(`❌ FolderTile [${id}]: Failed to load folder from path: "${path}"`, response.error);
        setError(response.error || 'Failed to load folder');
      }
    } catch (err: any) {
      console.error(`❌ FolderTile [${id}]: Error loading folder from path: "${path}"`, err);
      setError(err.message || 'Error loading folder');
    } finally {
      setIsLoading(false);
    }
  }, [user, id]);

  // Sync currentFolderPath with folderPath prop when it changes (from backend restore)
  useEffect(() => {
    if (folderPath !== undefined && folderPath !== currentFolderPath) {
      console.log(`🔄 FolderTile [${id}]: Restoring folder path from props: "${folderPath}" (current: "${currentFolderPath}")`);
      setCurrentFolderPath(folderPath);
    }
  }, [folderPath, id]);

  // Load folder on mount and when currentFolderPath changes
  useEffect(() => {
    loadFolderContents(currentFolderPath);
  }, [currentFolderPath, loadFolderContents]);

  // Get current folder items (folders + files combined)
  const getCurrentFolderItems = useCallback((): FileSystemItem[] => {
    return [...folders, ...items];
  }, [folders, items]);

  // Handle folder navigation (internal function)
  const navigateToFolder = async (folder: FileSystemItem) => {
    // Always use folder.id for API calls (like FilesPage does)
    // The API expects folder ID, not folder name or path
    const folderPath = folder.id === 'root' ? '' : folder.id;
    
    console.log(`📁 FolderTile [${id}]: Navigating to folder:`, {
      folderId: folder.id,
      folderName: folder.name,
      folderPath: folderPath,
      previousPath: currentFolderPath,
      folderObject: folder,
    });
    
    setCurrentFolderPath(folderPath);
    setSelectedItems(new Set()); // Clear selection when navigating
    
    // Persist folder path to backend (store the folder ID)
    console.log(`💾 FolderTile [${id}]: Persisting folder path to backend: "${folderPath}"`);
    onSettingsChange(id, { folderPath: folderPath });
    onUpdate(id, { folderPath: folderPath, lastUpdated: Date.now() });
  };
  
  // Multi-select handlers (like FilesPage)
  const handleItemClick = (item: FileSystemItem, index: number, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // CTRL/CMD+Click: Toggle selection
      event.preventDefault();
      event.stopPropagation();
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        if (newSet.has(item.id)) {
          newSet.delete(item.id);
        } else {
          newSet.add(item.id);
        }
        return newSet;
      });
      setLastSelectedIndex(index);
    } else if (event.shiftKey && lastSelectedIndex !== null) {
      // SHIFT+Click: Select range
      event.preventDefault();
      event.stopPropagation();
      const currentItems = getCurrentFolderItems();
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        for (let i = start; i <= end; i++) {
          newSet.add(currentItems[i].id);
        }
        return newSet;
      });
    } else {
      // Regular click: Select item (for both folders and files)
      // Folders open on double-click, not single-click
      event.preventDefault();
      setSelectedItems(new Set([item.id]));
      setLastSelectedIndex(index);
    }
  };

  // Handle select/deselect all
  const handleSelectAll = () => {
    const currentItems = getCurrentFolderItems();
    if (selectedItems.size === currentItems.length) {
      // Deselect all
      setSelectedItems(new Set());
      setLastSelectedIndex(null);
    } else {
      // Select all
      setSelectedItems(new Set(currentItems.map(item => item.id)));
      setLastSelectedIndex(currentItems.length - 1);
    }
  };

  // Handle remove tile with confirmation
  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: 'Remove Tile',
      message: 'Remove Folder Tile from dashboard?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmColor: 'error',
    });

    if (confirmed) {
      onRemove(id);
    }
  };




  // Create folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !user) return;
    
    setIsUploading(true);
    try {
      const response = await filesystemAPI.createFolder({
        user_id: user.id,
        folder_name: newFolderName.trim(),
        parent_path: currentFolderPath || undefined,
      });
      
      if (response.success) {
        setNewFolderName('');
        setCreateFolderDialogOpen(false);
        await loadFolderContents(currentFolderPath);
      } else {
        setError(response.error || 'Failed to create folder');
      }
    } catch (err: any) {
      setError(err.message || 'Error creating folder');
    } finally {
      setIsUploading(false);
    }
  };

  // Upload file
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setFileTitle(file.name);
      setUploadFileDialogOpen(true);
    }
  };

  const handleUploadFile = async () => {
    if (!selectedFile || !fileTitle.trim() || !user) return;
    
    setIsUploading(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      const fileContent = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix (e.g., "data:application/pdf;base64,")
          const base64 = result.split(',')[1] || result;
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      const response = await filesystemAPI.addFile({
        user_id: user.id,
        folder_path: currentFolderPath || undefined,
        file_content: fileContent,
        filename: selectedFile.name,
        title: fileTitle.trim(),
      });
      
      if (response.success && response.result) {
        // Add the new item directly to state with full metadata (like FilesPage does)
        // This ensures preview data is available immediately
        const newItem: FileSystemItem = {
          id: response.result.id,
          name: response.result.name,
          type: response.result.type as 'context_item' | 'uploaded_file' | 'agent_file',
          parentId: currentFolderPath || 'root',
          created_at: response.result.created_at,
          updated_at: response.result.updated_at,
          metadata: response.result.metadata,
          s3_key: response.result.s3_key, // Include s3_key for preview functionality
        };
        
        // Add to items state immediately with full metadata (like FilesPage)
        // This ensures preview data is available immediately for newly added items
        setItems(prev => {
          // Check if item already exists (from reload), if so update it, otherwise add it
          const existingIndex = prev.findIndex(item => item.id === newItem.id);
          if (existingIndex >= 0) {
            // Update existing item with full metadata
            const updated = [...prev];
            updated[existingIndex] = newItem;
            return updated;
          } else {
            // Add new item
            return [...prev, newItem];
          }
        });
        
        setSelectedFile(null);
        setFileTitle('');
        setUploadFileDialogOpen(false);
        
        // Also reload folder contents to ensure consistency and get any other updates
        // The newly added item will be merged/updated with the reloaded data
        await loadFolderContents(currentFolderPath);
      } else {
        setError(response.error || 'Failed to upload file');
      }
    } catch (err: any) {
      setError(err.message || 'Error uploading file');
    } finally {
      setIsUploading(false);
    }
  };

  // Delete item
  const handleDeleteItem = async () => {
    if (!selectedItem || !user) return;
    
    try {
      let response;
      if (selectedItem.type === 'folder') {
        response = await filesystemAPI.deleteFolder({
          user_id: user.id,
          folder_path: selectedItem.id === 'root' ? '' : selectedItem.id,
        });
      } else {
        response = await filesystemAPI.deleteItem({
          user_id: user.id,
          folder_path: currentFolderPath,
          item_id: selectedItem.id,
        });
      }
      
      if (response.success) {
        setItemContextMenuAnchor(null);
        setSelectedItem(null);
        await loadFolderContents(currentFolderPath);
      } else {
        setError(response.error || 'Failed to delete item');
      }
    } catch (err: any) {
      setError(err.message || 'Error deleting item');
    }
  };

  // Context menu handlers
  const handleContextMenuClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    setContextMenuAnchor(e.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleItemContextMenu = (e: React.MouseEvent, item: FileSystemItem) => {
    e.stopPropagation();
    setSelectedItem(item);
    setItemContextMenuAnchor(e.currentTarget as HTMLElement);
  };

  const handleItemContextMenuClose = () => {
    setItemContextMenuAnchor(null);
    setSelectedItem(null);
  };

  // Add to context (handles multiple selected items)
  const handleAddToContext = async (target: 'new' | 'sidebar') => {
    if (selectedItems.size === 0 || !user) return;
    
    const currentItems = getCurrentFolderItems();
    const selectedItemObjects = currentItems.filter(item => selectedItems.has(item.id));
    
    if (selectedItemObjects.length === 0) return;
    
    try {
      for (const item of selectedItemObjects) {
        const contextItem = {
          id: item.id,
          type: 'filesystem' as const,
          title: item.metadata?.title || item.name,
          subtitle: item.metadata?.subtitle || item.type,
          timestamp: item.created_at,
          data: {
            filesystem_type: item.type === 'folder' ? 'folder' : 'item',
            item_id: item.id,
            folder_path: currentFolderPath,
            s3_key: item.s3_key,
            ...item.metadata?.data,
          },
        };
        
        if (target === 'sidebar') {
          // Add to current sidebar session's context
          const event = new CustomEvent('add-to-sidebar-context', {
            detail: contextItem
          });
          window.dispatchEvent(event);
        } else {
          // Add to new chat
          addToContext(contextItem);
        }
      }
      
      setSelectedItems(new Set());
      handleContextMenuClose();
    } catch (err) {
      console.error('Error adding to context:', err);
    }
  };


  // Handle folder selection from dialog
  const handleFolderSelection = async (folderPath: string) => {
    console.log(`📁 FolderTile [${id}]: Folder selected from dialog: "${folderPath}"`);
    
    // Update current folder path
    setCurrentFolderPath(folderPath);
    
    // Load folder contents
    await loadFolderContents(folderPath);
    
    // Persist folder path to backend
    onSettingsChange(id, { folderPath: folderPath });
    onUpdate(id, { folderPath: folderPath, lastUpdated: Date.now() });
    
    setFolderSelectionDialogOpen(false);
  };

  // Refresh
  const handleRefresh = () => {
    loadFolderContents(currentFolderPath);
  };

  const tileColor = customColor || '#fbbf24';
  const displayTitle = customTitle || 'Folder';

  return (
    <Box
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: `1px solid ${tileColor}40`,
        borderRadius: '0px',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        cursor: pinnedState ? 'default' : (isDragging ? 'grabbing' : (onDragStart ? 'grab' : 'default')),
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          borderColor: tileColor,
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : `0 8px 25px ${tileColor}25`,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: tileColor,
        },
      }}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Header with controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onSelectionChange(id, !isSelected);
              }}
              sx={{ 
                color: '#9ca3af',
                '&.Mui-checked': { color: tileColor },
                p: 0.5,
                '&:hover': { backgroundColor: `${tileColor}20` }
              }}
              size="small"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            />
          )}
          
          {(() => {
            const TileIcon = getIconByName(typeof customIcon === 'string' ? customIcon : undefined, getDefaultIconForTileType('folder'));
            return (
              <>
                <TileIcon sx={{ color: tileColor, fontSize: '1.5rem', mr: 1 }} />
                <Typography variant="h6" color="white" fontWeight={600}>
                  {displayTitle}
                </Typography>
              </>
            );
          })()}
        </Box>

        <TileHeaderActions
          pinButton={{
            isPinned: pinnedState,
            onTogglePin: togglePin,
          }}
          contextButton={{
            onClick: handleContextMenuClick,
            disabled: selectedItems.size === 0,
            tooltip: selectedItems.size > 0 ? `Add ${selectedItems.size} item(s) to context` : 'Select items to add to context',
            icon: <AddToContextIcon fontSize="small" />,
          }}
          collapsibleActions={
            <>
              {/* Folder Selection Button */}
              <Tooltip title="Select folder to view">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderSelectionDialogOpen(true);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{
                    color: '#9ca3af',
                    '&:hover': { color: '#fbbf24' },
                  }}
                >
                  <FolderIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
          customizeButton={{
            onClick: (e) => {
              e.stopPropagation();
              setCustomizeDialogOpen(true);
            },
          }}
          deleteButton={{
            onClick: handleRemove,
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
          }}
        />
      </Box>

      {/* Content Area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          '&::-webkit-scrollbar': {
            width: '6px',
            height: '6px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'rgba(55, 65, 81, 0.3)',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(59, 130, 246, 0.5)',
            borderRadius: '3px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
          },
          '&::-webkit-scrollbar-corner': {
            backgroundColor: 'rgba(55, 65, 81, 0.3)',
          },
        }}
      >
        {/* Action Bar with Select All on left, Actions on right - Always visible */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1, borderBottom: '1px solid #374151' }}>
          {/* Select All on left */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Checkbox
              checked={getCurrentFolderItems().length > 0 && selectedItems.size === getCurrentFolderItems().length}
              indeterminate={selectedItems.size > 0 && selectedItems.size < getCurrentFolderItems().length}
              onChange={handleSelectAll}
              disabled={getCurrentFolderItems().length === 0}
              sx={{ 
                color: '#9ca3af', 
                '&.Mui-checked': { color: '#10b981' }, 
                '&.MuiCheckbox-indeterminate': { color: '#10b981' },
                '&.Mui-disabled': { color: '#6b7280' }
              }}
              size="small"
            />
            <Typography variant="body2" sx={{ color: '#9ca3af', ml: 1 }}>
              {selectedItems.size > 0 ? `${selectedItems.size} selected` : 'Select all'}
            </Typography>
          </Box>
          
          {/* Action Buttons on right */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Create Folder">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateFolderDialogOpen(true);
                }}
                sx={{ color: '#9ca3af', '&:hover': { color: customColor } }}
              >
                <CreateFolderIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Upload File">
              <IconButton
                size="small"
                component="label"
                onClick={(e) => e.stopPropagation()}
                sx={{ color: '#9ca3af', '&:hover': { color: customColor } }}
              >
                <UploadFileIcon fontSize="small" />
                <input
                  type="file"
                  hidden
                  onChange={handleFileSelect}
                />
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRefresh();
                }}
                disabled={isLoading}
                sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
              >
                {isLoading ? (
                  <CircularProgress size={16} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Folder/File List */}
        {isLoading && items.length === 0 && folders.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <CircularProgress size={24} />
          </Box>
        ) : error ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: '#ef4444' }}>
              {error}
            </Typography>
          </Box>
        ) : (
          <List sx={{ 
            flex: 1, 
            overflow: 'auto', 
            p: 0,
            '&::-webkit-scrollbar': {
              width: '6px',
              height: '6px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'rgba(55, 65, 81, 0.3)',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
              borderRadius: '3px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              backgroundColor: 'rgba(59, 130, 246, 0.7)',
            },
            '&::-webkit-scrollbar-corner': {
              backgroundColor: 'rgba(55, 65, 81, 0.3)',
            },
          }}>
            {/* Folders */}
            {folders.map((folder, index) => {
              const isSelected = selectedItems.has(folder.id);
              return (
                <ListItem
                  key={folder.id}
                  button
                  disableRipple
                  onClick={(e) => handleItemClick(folder, index, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    navigateToFolder(folder);
                  }}
                  onContextMenu={(e) => handleItemContextMenu(e, folder)}
                  onMouseDown={(e) => {
                    // Prevent browser context menu on right click
                    if (e.button === 2) {
                      e.preventDefault();
                    }
                  }}
                  sx={{
                    borderBottom: '1px solid #374151',
                    backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    cursor: isSelected ? 'default' : 'pointer',
                    borderLeft: isSelected ? '3px solid #10b981' : 'none',
                    '&:hover': { 
                      backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                      borderLeft: isSelected ? '3px solid #10b981' : '2px solid #3b82f6',
                    },
                  }}
                >
                  <ListItemIcon>
                    <FolderIcon sx={{ color: '#fbbf24', fontSize: '1.25rem' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={folder.name}
                    secondary={`Folder • ${new Date(folder.created_at || Date.now()).toLocaleDateString()}`}
                    primaryTypographyProps={{ sx: { color: '#ffffff', fontWeight: 500, fontSize: '0.875rem' } }}
                    secondaryTypographyProps={{ sx: { color: '#9ca3af', fontSize: '0.75rem' } }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleItemContextMenu(e, folder);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      sx={{ 
                        color: '#9ca3af',
                        '&:hover': { 
                          color: '#ffffff',
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        },
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              );
            })}
            
            {/* Files */}
            {items.map((item, index) => {
              const itemIndex = folders.length + index;
              const isSelected = selectedItems.has(item.id);
              return (
                <ListItem
                  key={item.id}
                  button
                  disableRipple
                  onClick={(e) => handleItemClick(item, itemIndex, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    console.log('📁 FolderTile: Double-clicked file item:', {
                      id: item.id,
                      name: item.name,
                      type: item.type,
                      s3_key: item.s3_key,
                      hasMetadata: !!item.metadata,
                      metadataKeys: item.metadata ? Object.keys(item.metadata) : [],
                    });
                    setPreviewItem(item);
                    setPreviewDialogOpen(true);
                  }}
                  onContextMenu={(e) => handleItemContextMenu(e, item)}
                  onMouseDown={(e) => {
                    // Prevent browser context menu on right click
                    if (e.button === 2) {
                      e.preventDefault();
                    }
                  }}
                  sx={{
                    borderBottom: '1px solid #374151',
                    backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    cursor: isSelected ? 'default' : 'pointer',
                    borderLeft: isSelected ? '3px solid #10b981' : 'none',
                    '&:hover': { 
                      backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                      borderLeft: isSelected ? '3px solid #10b981' : '2px solid #3b82f6',
                    },
                  }}
                >
                  <ListItemIcon>
                    <FileIcon sx={{ color: '#3b82f6', fontSize: '1.25rem' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ color: '#ffffff', fontWeight: 500, fontSize: '0.875rem' }}>
                          {item.metadata?.title || item.name}
                        </Typography>
                        {item.type && (
                          <Chip
                            label={item.type.replace('_', ' ')}
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
                    secondary={
                      item.metadata?.subtitle || 
                      `Context Item • ${new Date(item.created_at || Date.now()).toLocaleDateString()}`
                    }
                    primaryTypographyProps={{
                      sx: { color: '#ffffff', fontSize: '0.875rem' },
                    }}
                    secondaryTypographyProps={{
                      sx: { color: '#9ca3af', fontSize: '0.75rem' },
                    }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleItemContextMenu(e, item);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      sx={{ 
                        color: '#9ca3af',
                        '&:hover': { 
                          color: '#ffffff',
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        },
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              );
            })}
            
            {folders.length === 0 && items.length === 0 && !isLoading && (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: '#6b7280' }}>
                  Empty folder
                </Typography>
              </Box>
            )}
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
            border: '1px solid #374151',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff' }}>Create Folder</DialogTitle>
        <DialogContent>
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
                '& fieldset': { borderColor: '#374151' },
              },
              '& .MuiInputLabel-root': { color: '#9ca3af' },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setCreateFolderDialogOpen(false)}
            sx={{ color: '#9ca3af' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || isUploading}
            sx={{ color: customColor }}
          >
            {isUploading ? <CircularProgress size={20} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upload File Dialog */}
      <Dialog
        open={uploadFileDialogOpen}
        onClose={() => setUploadFileDialogOpen(false)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff' }}>Upload File</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="File Title"
            fullWidth
            variant="outlined"
            value={fileTitle}
            onChange={(e) => setFileTitle(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: '#ffffff',
                '& fieldset': { borderColor: '#374151' },
              },
              '& .MuiInputLabel-root': { color: '#9ca3af' },
            }}
          />
          {selectedFile && (
            <Typography variant="body2" sx={{ color: '#9ca3af', mt: 1 }}>
              Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setUploadFileDialogOpen(false)}
            sx={{ color: '#9ca3af' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUploadFile}
            disabled={!fileTitle.trim() || isUploading}
            sx={{ color: customColor }}
          >
            {isUploading ? <CircularProgress size={20} /> : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          },
        }}
      >
        <MenuItem
          onClick={() => handleAddToContext('sidebar')}
          disabled={selectedItems.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context
        </MenuItem>
      </Menu>

      {/* Item Context Menu */}
      <Menu
        anchorEl={itemContextMenuAnchor}
        open={Boolean(itemContextMenuAnchor)}
        onClose={handleItemContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          },
        }}
      >
        <MenuItem
          onClick={handleDeleteItem}
          sx={{ color: '#ef4444', '&:hover': { backgroundColor: 'rgba(239, 68, 68, 0.2)' } }}
        >
          <DeleteIcon sx={{ mr: 1, fontSize: 18 }} />
          Delete
        </MenuItem>
      </Menu>


      {/* Folder Selection Dialog (for selecting folder to view) */}
      <FileBrowserDialog
        open={folderSelectionDialogOpen}
        onClose={() => setFolderSelectionDialogOpen(false)}
        onSelect={handleFolderSelection}
        allowCreateFolder={false}
        title="Select Folder to View"
      />

      {/* File Preview Dialog */}
      {previewItem && previewItem.type !== 'folder' && user?.id && (() => {
        // Type guard: we know previewItem.type is not 'folder' at this point
        const itemType = previewItem.type === 'context_item' || previewItem.type === 'uploaded_file' || previewItem.type === 'agent_file' 
          ? previewItem.type 
          : 'context_item' as 'context_item' | 'uploaded_file' | 'agent_file';
        
        // Log preview item data for debugging
        console.log('📁 FolderTile: Opening preview for item:', {
          id: previewItem.id,
          name: previewItem.name,
          type: itemType,
          s3_key: previewItem.s3_key,
          hasMetadata: !!previewItem.metadata,
          metadataKeys: previewItem.metadata ? Object.keys(previewItem.metadata) : [],
          fullItem: previewItem,
        });
        
        // Ensure s3_key is available - FileSystemItem has s3_key directly
        const s3Key = previewItem.s3_key || '';
        
        if (!s3Key) {
          console.error('❌ FolderTile: No s3_key available for preview:', {
            itemId: previewItem.id,
            itemName: previewItem.name,
            itemType: previewItem.type,
            hasS3Key: !!previewItem.s3_key,
          });
        }
        
        return (
          <FilePreviewDialog
            open={previewDialogOpen}
            onClose={() => {
              setPreviewDialogOpen(false);
              setPreviewItem(null);
            }}
            item={{
              id: previewItem.id,
              name: previewItem.metadata?.title || previewItem.name,
              type: itemType,
              parentId: previewItem.parentId,
              metadata: previewItem.metadata,
              s3_key: s3Key, // Use the resolved s3_key
            }}
            user_id={user.id}
            folder_path={currentFolderPath}
          />
        );
      })()}

      {/* Tile Customization Dialog */}
      <TileCustomizationDialog
        open={customizeDialogOpen}
        onClose={() => setCustomizeDialogOpen(false)}
        onSave={(customizations) => {
          onSettingsChange(id, customizations);
        }}
        currentTitle={customTitle || 'Folder'}
        currentColor={customColor}
        currentIcon={typeof customIcon === 'string' ? customIcon : undefined}
      />
    </Box>
  );
};

// Memo with custom comparison
const FolderTileMemo = memo(FolderTile, (prevProps, nextProps) => {
  if (
    prevProps.id !== nextProps.id ||
    prevProps.folderPath !== nextProps.folderPath ||
    prevProps.folderId !== nextProps.folderId ||
    prevProps.customTitle !== nextProps.customTitle ||
    prevProps.customColor !== nextProps.customColor ||
    prevProps.isPinned !== nextProps.isPinned ||
    prevProps.isDragging !== nextProps.isDragging ||
    prevProps.isResizing !== nextProps.isResizing ||
    prevProps.isSelected !== nextProps.isSelected
  ) {
    return false;
  }
  
  const prevGridPos = prevProps.gridPosition;
  const nextGridPos = nextProps.gridPosition;
  if (prevGridPos && nextGridPos) {
    if (prevGridPos.x !== nextGridPos.x || prevGridPos.y !== nextGridPos.y) {
      return false;
    }
  }
  
  const prevGridSize = prevProps.gridSize;
  const nextGridSize = nextProps.gridSize;
  if (prevGridSize && nextGridSize) {
    if (prevGridSize.width !== nextGridSize.width || prevGridSize.height !== nextGridSize.height) {
      return false;
    }
  }
  
  return true;
});

export default FolderTileMemo;

