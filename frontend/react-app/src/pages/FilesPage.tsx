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
  Checkbox,
  CircularProgress,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Add as AddIcon,
  CreateNewFolder as CreateFolderIcon,
  MoreVert as MoreVertIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Visibility as ViewIcon,
  ArrowBack as ArrowBackIcon,
  Chat as SidebarChatIcon,
  ContentCopy as CopyIcon,
  ContentPaste as PasteIcon,
} from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';
import { useDialogManagerHelpers } from '@/hooks/useDialogManagerHelpers';
import { filesystemAPI } from '@/services/api';
import { addToContext } from '@/components/tiles/common/contextManager';

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
  const { openFilePreview } = useDialogManagerHelpers();
  
  // File system state (stored in memory/cache for now)
  const [items, setItems] = useState<Map<string, FileSystemItem>>(new Map());
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbPath, setBreadcrumbPath] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'Files' }
  ]);
  
  // Loading state (only for initial page load)
  const [isLoading, setIsLoading] = useState(true);
  
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
  
  // Multi-select state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  // Rename dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [itemToRename, setItemToRename] = useState<FileSystemItem | null>(null);
  const [newItemName, setNewItemName] = useState('');

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<FileSystemItem | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // Move dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<FileSystemItem | null>(null);
  const [itemsToMove, setItemsToMove] = useState<FileSystemItem[]>([]); // For bulk move
  const [moveDialogCurrentFolder, setMoveDialogCurrentFolder] = useState<string | null>(null);
  const [moveDialogBreadcrumb, setMoveDialogBreadcrumb] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'Files' }
  ]);

  // Clipboard state for copy/paste (stored in sessionStorage for cross-page persistence)
  const CLIPBOARD_STORAGE_KEY = 'filesystem_clipboard';
  
  const getClipboard = (): Array<{ item_id: string; source_folder_path: string; is_folder: boolean; name: string }> | null => {
    try {
      const stored = sessionStorage.getItem(CLIPBOARD_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  };

  const setClipboard = (items: Array<{ item_id: string; source_folder_path: string; is_folder: boolean; name: string }> | null) => {
    if (items) {
      sessionStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(items));
    } else {
      sessionStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    }
  };

  const [clipboard, setClipboardState] = useState<Array<{ item_id: string; source_folder_path: string; is_folder: boolean; name: string }> | null>(getClipboard());
  
  // Sync clipboard state with sessionStorage
  const updateClipboard = (items: Array<{ item_id: string; source_folder_path: string; is_folder: boolean; name: string }> | null) => {
    setClipboard(items);
    setClipboardState(items);
  };

  // Sync clipboard from sessionStorage on mount and when it changes
  React.useEffect(() => {
    const syncClipboard = () => {
      const stored = getClipboard();
      setClipboardState(stored);
    };
    
    // Initial sync
    syncClipboard();
    
    // Listen for storage events (for cross-tab sync)
    window.addEventListener('storage', syncClipboard);
    
    // Custom event for same-tab updates
    const handleClipboardUpdate = () => syncClipboard();
    window.addEventListener('filesystem-clipboard-update', handleClipboardUpdate);
    
    return () => {
      window.removeEventListener('storage', syncClipboard);
      window.removeEventListener('filesystem-clipboard-update', handleClipboardUpdate);
    };
  }, []);

  // Keyboard shortcuts for copy/paste (FilesPage only)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ctrl+C or Cmd+C for copy (only when items are selected)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey && !e.altKey) {
        if (selectedItems.size > 0 || selectedItem) {
          e.preventDefault();
          handleCopyItem();
        }
      }
      // Ctrl+V or Cmd+V for paste (only when clipboard has items)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey && !e.altKey) {
        const clipboardItems = getClipboard();
        if (clipboardItems && clipboardItems.length > 0) {
          e.preventDefault();
          handlePasteItem();
        }
      }
      // Delete key for deleting selected items
      if (e.key === 'Delete' || (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey)) {
        if (selectedItems.size > 0 || selectedItem) {
          e.preventDefault();
          handleDeleteItem();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, selectedItem, clipboard]);

  // Load filesystem data from API
  React.useEffect(() => {
    const loadFilesystem = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }
      
      setIsLoading(true);
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
              // Ensure s3_key is always included - it should be in the manifest
              // If missing, log a warning but still create the item
              if (!item.s3_key && item.type === 'context_item') {
                console.warn(`⚠️ Item ${item.id} (${item.name}) is missing s3_key in manifest response`);
              }
              
              const fileItem: FileItem = {
                id: item.id,
                name: item.name,
                type: item.type as 'context_item' | 'uploaded_file' | 'agent_file',
                parentId: 'root',
                created_at: item.created_at || Date.now(),
                updated_at: item.updated_at || Date.now(),
                metadata: item.metadata,
                s3_key: item.s3_key || undefined, // Explicitly set to undefined if missing
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
      } finally {
        setIsLoading(false);
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
        
        // Reload current folder contents to show the new folder
        await loadFolderContents(folderPath);
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

  const handleFolderClick = async (folder: Folder) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    // Clear selection when navigating
    setSelectedItems(new Set());
    setLastSelectedIndex(null);
    
    // Load folder contents from API
    const folderPath = folder.id === 'root' ? '' : folder.id;
    await loadFolderContents(folderPath);
  };

  const handleBreadcrumbClick = async (folderId: string) => {
    const folderIndex = breadcrumbPath.findIndex(f => f.id === folderId);
    if (folderIndex >= 0) {
      const newPath = breadcrumbPath.slice(0, folderIndex + 1);
      setBreadcrumbPath(newPath);
      setCurrentFolderId(folderId === 'root' ? null : folderId);
      // Clear selection when navigating
      setSelectedItems(new Set());
      setLastSelectedIndex(null);
      
      // Load folder contents from API
      const folderPath = folderId === 'root' ? '' : folderId;
      await loadFolderContents(folderPath);
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>, item?: FileSystemItem) => {
    event.preventDefault(); // Prevent browser context menu
    event.stopPropagation();
    setContextMenuAnchor(event.currentTarget);
    if (item) {
      setSelectedItem(item);
    } else {
      setSelectedItem(null); // Empty area context menu
    }
  };

  // Bulk actions for selected items
  const handleBulkDelete = async () => {
    if (selectedItems.size === 0 || !user) return;
    
    const itemsToDelete = Array.from(selectedItems).map(id => items.get(id)).filter(Boolean) as FileSystemItem[];
    if (itemsToDelete.length === 0) return;
    
    const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
    
    try {
      for (const item of itemsToDelete) {
        if (item.type === 'folder') {
          const response = await filesystemAPI.deleteFolder({
            user_id: user.id,
            folder_path: item.id === 'root' ? '' : item.id,
          });
          
          if (response.success) {
            setItems(prev => {
              const newMap = new Map(prev);
              newMap.delete(item.id);
              Array.from(newMap.values()).forEach(child => {
                if (child.parentId === item.id) {
                  newMap.delete(child.id);
                }
              });
              return newMap;
            });
          }
        } else {
          const response = await filesystemAPI.deleteItem({
            user_id: user.id,
            folder_path: folderPath,
            item_id: item.id,
          });
          
          if (response.success) {
            setItems(prev => {
              const newMap = new Map(prev);
              newMap.delete(item.id);
              return newMap;
            });
          }
        }
      }
      
      await loadFolderContents(folderPath);
      setSelectedItems(new Set());
    } catch (error) {
      console.error('Error deleting items:', error);
    }
  };

  const handleBulkMove = async () => {
    if (selectedItems.size === 0) return;
    
    const itemsToMoveArray = Array.from(selectedItems).map(id => items.get(id)).filter(Boolean) as FileSystemItem[];
    if (itemsToMoveArray.length === 0) return;
    
    // Store all items to move
    setItemsToMove(itemsToMoveArray);
    // Set first item for display purposes
    setItemToMove(itemsToMoveArray[0]);
    setMoveDialogCurrentFolder(null);
    setMoveDialogBreadcrumb([{ id: 'root', name: 'Files' }]);
    setMoveDialogOpen(true);
    await loadFolderContents('');
  };

  const handleBulkAddToContext = async (target: 'new' | 'sidebar') => {
    if (selectedItems.size === 0 || !user) return;
    
    const selectedItemsArray = Array.from(selectedItems).map(id => items.get(id)).filter(Boolean) as FileSystemItem[];
    
    for (const item of selectedItemsArray) {
      let contextItem: any;
      
      if (item.type === 'folder') {
        // For folders, get all nested items' S3 keys
        const folderPath = item.id === 'root' ? '' : item.id;
        const nestedS3Keys = await getAllNestedItems(item.id, folderPath);
        
        contextItem = {
          id: `filesystem_folder_${item.id}_${Date.now()}`,
          type: 'custom' as const,
          title: item.name,
          subtitle: `Folder with ${nestedS3Keys.length} item(s)`,
          data: {
            filesystem_type: 'folder',
            folder_id: item.id,
            folder_path: folderPath,
            s3_keys: nestedS3Keys,
          },
          timestamp: Date.now(),
        };
      } else if (item.s3_key) {
        // For files/context items, send just the S3 key
        const itemType = item.metadata?.type || 'context_item';
        
        contextItem = {
          id: `filesystem_item_${item.id}_${Date.now()}`,
          type: itemType as any,
          title: item.metadata?.title || item.name,
          subtitle: item.metadata?.subtitle || 'Filesystem Item',
          data: {
            filesystem_type: 'item',
            item_id: item.id,
            s3_key: item.s3_key,
            item_type: item.type,
          },
          timestamp: Date.now(),
        };
      }
      
      if (contextItem) {
        if (target === 'sidebar') {
          const event = new CustomEvent('add-to-sidebar-context', {
            detail: contextItem
          });
          window.dispatchEvent(event);
        } else {
          addToContext(contextItem);
        }
      }
    }
    
    setSelectedItems(new Set());
  };

  const handleAddItemToContext = async (item: FileSystemItem, target: 'new' | 'sidebar') => {
    if (!user) return;
    
    let contextItem: any;
    
    if (item.type === 'folder') {
      // For folders, get all nested items' S3 keys
      const folderPath = item.id === 'root' ? '' : item.id;
      const nestedS3Keys = await getAllNestedItems(item.id, folderPath);
      
      contextItem = {
        id: `filesystem_folder_${item.id}_${Date.now()}`,
        type: 'custom' as const,
        title: item.name,
        subtitle: `Folder with ${nestedS3Keys.length} item(s)`,
        data: {
          filesystem_type: 'folder',
          folder_id: item.id,
          folder_path: folderPath,
          s3_keys: nestedS3Keys,
        },
        timestamp: Date.now(),
      };
    } else {
      // For files/context items, send just the S3 key
      const itemType = item.metadata?.type || 'context_item';
      
      // CRITICAL: Always ensure s3_key is included in the context item data
      // First, try to use s3_key from the item (should be in manifest)
      let s3_key = item.s3_key;
      
      // Log what we have from the item for debugging
      console.log(`🔍 handleAddItemToContext - Item details:`, {
        id: item.id,
        name: item.name,
        type: item.type,
        s3_key_from_item: item.s3_key,
        has_s3_key: !!item.s3_key,
        metadata: item.metadata
      });
      
      // Check if this is a .cosine file (by name, type, or metadata)
      // Also check metadata.original_filename if it exists (for uploaded files)
      const isCosineFile = item.type === 'context_item' || 
                          item.name?.toLowerCase().endsWith('.cosine') ||
                          item.metadata?.type === 'context_item' ||
                          (item.metadata && typeof item.metadata === 'object' && 'original_filename' in item.metadata && 
                           String(item.metadata.original_filename || '').toLowerCase().endsWith('.cosine'));
      
      console.log(`🔍 isCosineFile check:`, {
        type_check: item.type === 'context_item',
        name_check: item.name?.toLowerCase().endsWith('.cosine'),
        metadata_type_check: item.metadata?.type === 'context_item',
        isCosineFile,
        final_s3_key_before_construction: s3_key
      });
      
      // If s3_key is missing from manifest, construct it for .cosine files
      if (!s3_key && user && isCosineFile) {
        // Determine folder path - check parentId and current folder
        let folderPath = '';
        if (item.parentId && item.parentId !== 'root') {
          folderPath = item.parentId;
        } else if (currentFolderId && currentFolderId !== 'root') {
          // Fallback: use current folder if parentId is not set
          folderPath = currentFolderId;
        }
        
        // Construct s3_key for .cosine files
        const folderPathPart = folderPath ? `${folderPath}/` : '';
        s3_key = `users/${user.id}/filesys/${folderPathPart}${item.id}.cosine`;
        console.warn(`⚠️ s3_key missing from manifest for item ${item.id} (${item.name}), constructed: ${s3_key}`);
      } else if (!s3_key && !isCosineFile) {
        // For non-.cosine files, we need the s3_key from the manifest
        console.error(`❌ s3_key missing from ${item.type} item ${item.id} (${item.name}) - cannot add to context`);
        alert(`Cannot add "${item.name}" to context: file location information is missing. Please refresh the page and try again.`);
        setContextMenuAnchor(null);
        setSelectedItem(null);
        return;
      } else if (!s3_key && !user) {
        // User is required to construct s3_key
        console.error(`❌ Cannot construct s3_key: user is not available`);
        alert(`Cannot add "${item.name}" to context: user information is missing. Please refresh the page and try again.`);
        setContextMenuAnchor(null);
        setSelectedItem(null);
        return;
      }
      
      // CRITICAL: Ensure s3_key is ALWAYS set before creating context item
      // Last resort: construct s3_key with empty folder path (root folder) for .cosine files
      if (!s3_key && user && isCosineFile) {
        s3_key = `users/${user.id}/filesys/${item.id}.cosine`;
        console.error(`❌ CRITICAL: s3_key was still missing after all attempts, using last-resort construction: ${s3_key}`);
      }
      
      // CRITICAL: Ensure s3_key is set - use from manifest if available, otherwise construct
      if (!s3_key) {
        console.error(`❌ CRITICAL: s3_key is still undefined after all checks!`, {
          item_id: item.id,
          item_name: item.name,
          item_type: item.type,
          item_s3_key: item.s3_key,
          user_available: !!user,
          isCosineFile
        });
        alert(`Cannot add "${item.name}" to context: file location information is missing. Please refresh the page and try again.`);
        setContextMenuAnchor(null);
        setSelectedItem(null);
        return;
      }
      
      // Always create the context item with s3_key - it should always be available at this point
      // Create data object with s3_key FIRST to ensure it's always included
      const contextData: any = {
        filesystem_type: 'item',
        item_id: item.id,
        s3_key: s3_key, // CRITICAL: Always include s3_key in data
        item_type: item.type,
      };
      
      // Verify s3_key is a non-empty string
      if (!s3_key || typeof s3_key !== 'string' || s3_key.trim() === '') {
        console.error(`❌ CRITICAL: s3_key is invalid:`, s3_key);
        alert(`Cannot add "${item.name}" to context: invalid file location. Please refresh the page and try again.`);
        setContextMenuAnchor(null);
        setSelectedItem(null);
        return;
      }
      
      contextItem = {
        id: `filesystem_item_${item.id}_${Date.now()}`,
        type: itemType as any,
        title: item.metadata?.title || item.name,
        subtitle: item.metadata?.subtitle || 'Filesystem Item',
        data: contextData, // Use pre-constructed data object with s3_key
        timestamp: Date.now(),
      };
      
      // CRITICAL: Triple-check that s3_key is actually in the data object
      if (!contextItem.data || !contextItem.data.s3_key) {
        console.error(`❌ CRITICAL ERROR: s3_key not set in contextItem.data!`, {
          contextItem,
          s3_key,
          item,
          contextData,
          data_s3_key: contextItem.data?.s3_key
        });
        // Force set it
        if (!contextItem.data) {
          contextItem.data = {};
        }
        contextItem.data.s3_key = s3_key;
      }
      
      // Log for debugging - verify s3_key is in the data
      console.log(`✅ Adding filesystem item to context:`, {
        item_id: item.id,
        name: item.name,
        item_type: item.type,
        item_s3_key_from_manifest: item.s3_key,
        final_s3_key: s3_key,
        constructed: !item.s3_key,
        contextItem_data_s3_key: contextItem.data.s3_key, // Verify it's set
        contextItem_data: JSON.stringify(contextItem.data), // Show full data object as JSON
        contextItem_full: JSON.stringify(contextItem) // Show full context item
      });
      
      // Final verification before proceeding
      if (!contextItem.data.s3_key) {
        console.error(`❌ FINAL CHECK FAILED: s3_key still missing!`, contextItem);
        alert(`Error: Cannot add "${item.name}" to context - file location is missing. Please refresh and try again.`);
        setContextMenuAnchor(null);
        setSelectedItem(null);
        return;
      }
    }
    
    if (contextItem) {
      // Verify s3_key is in the data before adding to context
      if (contextItem.data && contextItem.data.filesystem_type === 'item' && !contextItem.data.s3_key) {
        console.error(`❌ CRITICAL: Context item created without s3_key:`, contextItem);
        // Try to fix it if we have the item info
        if (user && item.id) {
          const fallbackS3Key = `users/${user.id}/filesys/${item.id}.cosine`;
          contextItem.data.s3_key = fallbackS3Key;
          console.warn(`⚠️ Fixed missing s3_key with fallback: ${fallbackS3Key}`);
        } else {
          alert(`Error: Cannot add "${item.name}" to context - file location is missing. Please refresh and try again.`);
          setContextMenuAnchor(null);
          setSelectedItem(null);
          return;
        }
      }
      
      // Final verification - log the exact data being sent
      console.log(`🔍 FINAL VERIFICATION - Context item data before dispatch:`, {
        id: contextItem.id,
        type: contextItem.type,
        title: contextItem.title,
        data: JSON.stringify(contextItem.data),
        data_s3_key: contextItem.data?.s3_key
      });
      
      if (target === 'sidebar') {
        const event = new CustomEvent('add-to-sidebar-context', {
          detail: contextItem
        });
        window.dispatchEvent(event);
      } else {
        addToContext(contextItem);
      }
    }
    
    setContextMenuAnchor(null);
    setSelectedItem(null);
  };

  // Helper function to recursively get all items in a folder (including nested folders)
  const getAllNestedItems = useCallback(async (folderId: string, folderPath: string = ''): Promise<string[]> => {
    if (!user) return [];
    
    const s3Keys: string[] = [];
    
    try {
      // Get folder contents
      const response = await filesystemAPI.listFolder({
        user_id: user.id,
        folder_path: folderPath,
      });
      
      if (response.success && response.result) {
        // Add all items' S3 keys
        if (response.result.items) {
          response.result.items.forEach((item: any) => {
            if (item.s3_key) {
              s3Keys.push(item.s3_key);
            }
          });
        }
        
        // Recursively get items from subfolders
        if (response.result.subfolders) {
          for (const subfolder of response.result.subfolders) {
            // Use the subfolder's path if available, otherwise construct it
            // The path should be relative to the user's filesys directory
            let subfolderPath: string;
            if (subfolder.path) {
              subfolderPath = subfolder.path;
            } else if (folderPath) {
              subfolderPath = `${folderPath}/${subfolder.id}`;
            } else {
              subfolderPath = subfolder.id;
            }
            const nestedKeys = await getAllNestedItems(subfolder.id, subfolderPath);
            s3Keys.push(...nestedKeys);
          }
        }
      }
    } catch (error) {
      console.error(`Error getting nested items for folder ${folderId}:`, error);
    }
    
    return s3Keys;
  }, [user]);

  const loadFolderContents = useCallback(async (folderPath: string = '') => {
    if (!user) return;
    
    try {
      const response = await filesystemAPI.listFolder({
        user_id: user.id,
        folder_path: folderPath,
      });
      
      if (response.success && response.result) {
        const folderMap = new Map<string, FileSystemItem>();
        
        // Add current folder
        const currentFolder: Folder = {
          id: response.result.folder.id || (folderPath ? folderPath.split('/').pop() || 'root' : 'root'),
          name: response.result.folder.name || 'Files',
          type: 'folder',
          parentId: folderPath ? folderPath.split('/').slice(0, -1).join('/') || null : null,
          created_at: response.result.folder.created_at || Date.now(),
          updated_at: response.result.folder.updated_at || Date.now(),
        };
        folderMap.set(currentFolder.id, currentFolder);
        
        // Add subfolders
        if (response.result.subfolders) {
          response.result.subfolders.forEach((folder: any) => {
            const folderItem: Folder = {
              id: folder.id,
              name: folder.name,
              type: 'folder',
              parentId: folderPath || 'root',
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
              parentId: folderPath || 'root',
              created_at: item.created_at || Date.now(),
              updated_at: item.updated_at || Date.now(),
              metadata: item.metadata,
              s3_key: item.s3_key,
            };
            folderMap.set(item.id, fileItem);
          });
        }
        
        // Merge with existing items (to preserve other folders)
        setItems(prev => {
          const merged = new Map(prev);
          folderMap.forEach((value, key) => merged.set(key, value));
          return merged;
        });
      }
    } catch (error) {
      console.error('Error loading folder contents:', error);
    }
  }, [user]);

  const handleDeleteItem = async () => {
    // Support both single item (from context menu) and multi-select
    const itemsToDelete = selectedItems.size > 0 
      ? Array.from(selectedItems).map(id => items.get(id)).filter(Boolean) as FileSystemItem[]
      : selectedItem 
        ? [selectedItem]
        : [];
    
    if (itemsToDelete.length === 0 || !user) return;
    
    try {
      const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
      
      // Delete all selected items
      for (const item of itemsToDelete) {
        if (item.type === 'folder') {
          const response = await filesystemAPI.deleteFolder({
            user_id: user.id,
            folder_path: item.id === 'root' ? '' : item.id,
          });
          
          if (response.success) {
            // Remove from local state
            setItems(prev => {
              const newMap = new Map(prev);
              newMap.delete(item.id);
              // Also remove children
              Array.from(newMap.values()).forEach(child => {
                if (child.parentId === item.id) {
                  newMap.delete(child.id);
                }
              });
              return newMap;
            });
          } else {
            console.error('Failed to delete folder:', response.error);
            // TODO: Show error message
          }
        } else {
          const response = await filesystemAPI.deleteItem({
            user_id: user.id,
            folder_path: folderPath,
            item_id: item.id,
          });
          
          if (response.success) {
            // Remove from local state
            setItems(prev => {
              const newMap = new Map(prev);
              newMap.delete(item.id);
              return newMap;
            });
          } else {
            console.error('Failed to delete item:', response.error);
            // TODO: Show error message
          }
        }
      }
      
      // Reload current folder
      await loadFolderContents(folderPath);
      
      // Clear selection
      setSelectedItems(new Set());
      setContextMenuAnchor(null);
      setSelectedItem(null);
    } catch (error) {
      console.error('Error deleting items:', error);
      // TODO: Show error message
    }
  };

  // Drag and drop handlers
  const handleDragStart = (event: React.DragEvent, item: FileSystemItem) => {
    const currentItems = getCurrentFolderItems();
    let itemsToDrag: FileSystemItem[];
    
    // Support multi-select - if item is selected and there are multiple selections, drag all selected items
    if (selectedItems.has(item.id) && selectedItems.size > 1) {
      // Item is part of a multi-selection, drag all selected items
      itemsToDrag = currentItems.filter(i => selectedItems.has(i.id));
    } else if (selectedItems.size > 1 && !selectedItems.has(item.id)) {
      // Multiple items are selected but this item isn't one of them - still drag all selected items
      itemsToDrag = currentItems.filter(i => selectedItems.has(i.id));
    } else {
      // Single item drag
      itemsToDrag = [item];
    }
    
    // Set up data for both internal moves (item IDs) and sidebar drops (full objects with type)
    const itemIds = itemsToDrag.map(i => i.id);
    event.dataTransfer.effectAllowed = 'copyMove'; // Allow both copy (to sidebar) and move (within folder)
    
    // Set data for internal folder moves (legacy format)
    event.dataTransfer.setData('text/plain', JSON.stringify(itemIds));
    
    // Set data for sidebar drops (new format with type and full objects)
    // Include folder path for context
    const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
    event.dataTransfer.setData('application/json', JSON.stringify({
      type: 'filesystem_items',
      items: itemsToDrag,
      folderPath: folderPath
    }));
    
    // Use the first item as the primary dragged item for visual feedback
    setDraggedItem(itemsToDrag[0]);
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

  const handleDrop = async (event: React.DragEvent, targetItem: FileSystemItem) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (!draggedItem || !user || draggedItem.id === targetItem.id) {
      setDraggedItem(null);
      setDragOverItem(null);
      setDragOverFolder(null);
      return;
    }

    try {
      // Check if we're dragging multiple items
      const dragData = event.dataTransfer.getData('text/plain');
      let itemsToMove: FileSystemItem[] = [];
      
      try {
        const parsedIds = JSON.parse(dragData);
        if (Array.isArray(parsedIds)) {
          // Multiple items
          itemsToMove = parsedIds.map(id => items.get(id)).filter(Boolean) as FileSystemItem[];
        } else {
          // Single item
          itemsToMove = [draggedItem];
        }
      } catch {
        // Single item (not JSON)
        itemsToMove = [draggedItem];
      }
      
      if (itemsToMove.length === 0) {
        setDraggedItem(null);
        setDragOverItem(null);
        setDragOverFolder(null);
        return;
      }
      
      // Determine destination folder path
      let destFolderPath: string;
      if (targetItem.type === 'folder') {
        // Dropping on a folder - move into that folder
        destFolderPath = targetItem.id === 'root' ? '' : targetItem.id;
      } else {
        // Dropping on a file - move to the same parent folder
        destFolderPath = targetItem.parentId === 'root' ? '' : targetItem.parentId || '';
      }
      
      // Move all items
      const sourceFolderPaths = new Set<string>();
      for (const item of itemsToMove) {
        const sourceFolderPath = item.parentId === 'root' ? '' : item.parentId || '';
        
        // Don't move if already in the same folder
        if (sourceFolderPath === destFolderPath) continue;
        
        sourceFolderPaths.add(sourceFolderPath);
        
        const response = await filesystemAPI.moveItem({
          user_id: user.id,
          item_id: item.id,
          source_folder_path: sourceFolderPath,
          dest_folder_path: destFolderPath,
        });
        
        if (response.success && response.result) {
          // Update local state
          setItems(prev => {
            const newMap = new Map(prev);
            const itemToUpdate = newMap.get(item.id);
            if (itemToUpdate) {
              newMap.set(item.id, {
                ...itemToUpdate,
                parentId: destFolderPath || 'root',
                updated_at: response.result.updated_at || Date.now(),
              });
            }
            return newMap;
          });
        } else {
          console.error('Failed to move item:', response.error);
          // TODO: Show error message
        }
      }
      
      // Reload all affected folders
      for (const sourcePath of sourceFolderPaths) {
        await loadFolderContents(sourcePath);
      }
      await loadFolderContents(destFolderPath);
      
      // Clear selection
      setSelectedItems(new Set());
    } catch (error) {
      console.error('Error moving items:', error);
      // TODO: Show error message
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

  // Multi-select handlers
  const handleItemClick = (item: FileSystemItem, index: number, event: React.MouseEvent) => {
    // Prevent default navigation on folders if items are selected
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
      // Regular click: Select item, or deselect if already selected
      // Folders open on double-click, not single-click
      event.preventDefault();
      if (selectedItems.has(item.id)) {
        // If item is already selected, deselect it
        setSelectedItems(new Set());
        setLastSelectedIndex(null);
      } else {
        // Otherwise, select only this item
        setSelectedItems(new Set([item.id]));
        setLastSelectedIndex(index);
      }
    }
  };

  const handleSelectAll = () => {
    const currentItems = getCurrentFolderItems();
    if (selectedItems.size === currentItems.length) {
      // Deselect all
      setSelectedItems(new Set());
    } else {
      // Select all
      setSelectedItems(new Set(currentItems.map(item => item.id)));
    }
  };

  const handleRenameItem = () => {
    if (!selectedItem) return;
    setItemToRename(selectedItem);
    setNewItemName(selectedItem.name);
    setRenameDialogOpen(true);
    setContextMenuAnchor(null);
    setSelectedItem(null);
  };

  const handleConfirmRename = async () => {
    if (!itemToRename || !newItemName.trim() || !user) return;
    
    try {
      const folderPath = itemToRename.parentId === 'root' ? '' : itemToRename.parentId || '';
      const response = await filesystemAPI.renameItem({
        user_id: user.id,
        folder_path: folderPath,
        item_id: itemToRename.id,
        new_name: newItemName.trim(),
      });
      
      if (response.success && response.result) {
        // Update local state
        setItems(prev => {
          const newMap = new Map(prev);
          const item = newMap.get(itemToRename.id);
          if (item) {
            newMap.set(itemToRename.id, {
              ...item,
              name: newItemName.trim(),
              updated_at: response.result.updated_at || Date.now(),
            });
          }
          return newMap;
        });
        
        // Reload folder contents
        await loadFolderContents(folderPath);
      } else {
        console.error('Failed to rename item:', response.error);
        // TODO: Show error message
      }
    } catch (error) {
      console.error('Error renaming item:', error);
      // TODO: Show error message
    }
    
    setRenameDialogOpen(false);
    setItemToRename(null);
    setNewItemName('');
  };

  const handleCopyItem = async () => {
    if (!user) return;
    
    const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
    
    // Support both single item (from context menu) and multi-select
    const itemsToCopy = selectedItems.size > 0 
      ? Array.from(selectedItems).map(id => items.get(id)).filter(Boolean) as FileSystemItem[]
      : selectedItem 
        ? [selectedItem]
        : [];
    
    if (itemsToCopy.length === 0) return;
    
    // Get existing clipboard or create new array
    const existingClipboard = getClipboard() || [];
    const newClipboardItems: Array<{ item_id: string; source_folder_path: string; is_folder: boolean; name: string }> = [];
    
    // Add all items to clipboard (just UUIDs and metadata, no content)
    for (const item of itemsToCopy) {
      const isFolder = item.type === 'folder';
      const sourcePath = isFolder ? (item.id === 'root' ? '' : item.id) : folderPath;
      
      const clipboardItem = {
        item_id: item.id,
        source_folder_path: sourcePath,
        is_folder: isFolder,
        name: item.name,
      };
      
      // Check if item is already in clipboard (avoid duplicates)
      const isDuplicate = existingClipboard.some(
        existing => existing.item_id === clipboardItem.item_id && existing.source_folder_path === clipboardItem.source_folder_path
      );
      
      if (!isDuplicate) {
        newClipboardItems.push(clipboardItem);
      }
    }
    
    // Merge with existing clipboard
    const newClipboard = [...existingClipboard, ...newClipboardItems];
    updateClipboard(newClipboard);
    
    setContextMenuAnchor(null);
    setSelectedItem(null);
    setSelectedItems(new Set()); // Clear selection after copying
  };

  const handlePasteItem = async () => {
    const clipboardItems = getClipboard();
    if (!clipboardItems || clipboardItems.length === 0 || !user) return;
    
    const folderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
    
    try {
      // Prepare item_data for backend (just UUIDs and paths)
      const item_data = clipboardItems.map(item => ({
        item_id: item.item_id,
        source_folder_path: item.source_folder_path,
        is_folder: item.is_folder,
      }));
      
      const response = await filesystemAPI.pasteItemsByIds({
        user_id: user.id,
        dest_folder_path: folderPath,
        item_data: item_data,
      });
      
      if (response.success) {
        // Reload folder contents
        await loadFolderContents(folderPath);
        updateClipboard(null); // Clear clipboard after successful paste
      } else {
        alert(`Failed to paste: ${response.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error pasting items:', error);
      alert(`Failed to paste: ${error.message || 'Unknown error'}`);
    }
  };

  const handleMoveItem = async () => {
    // Support both single item (from context menu) and multi-select
    const itemsToMoveArray = selectedItems.size > 0 
      ? Array.from(selectedItems).map(id => items.get(id)).filter(Boolean) as FileSystemItem[]
      : selectedItem 
        ? [selectedItem]
        : [];
    
    if (itemsToMoveArray.length === 0) return;
    
    // Store all items to move
    setItemsToMove(itemsToMoveArray);
    // Set first item for display purposes
    setItemToMove(itemsToMoveArray[0]);
    setMoveDialogCurrentFolder(null);
    setMoveDialogBreadcrumb([{ id: 'root', name: 'Files' }]);
    setMoveDialogOpen(true);
    setContextMenuAnchor(null);
    setSelectedItem(null);
    
    // Load root folder contents for the move dialog
    await loadFolderContents('');
  };

  const handleMoveDialogFolderClick = async (folder: Folder) => {
    setMoveDialogCurrentFolder(folder.id);
    setMoveDialogBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name }]);
    
    // Load folder contents for the move dialog
    const folderPath = folder.id === 'root' ? '' : folder.id;
    await loadFolderContents(folderPath);
  };

  const handleMoveDialogBreadcrumbClick = async (folderId: string) => {
    const folderIndex = moveDialogBreadcrumb.findIndex(f => f.id === folderId);
    if (folderIndex >= 0) {
      const newPath = moveDialogBreadcrumb.slice(0, folderIndex + 1);
      setMoveDialogBreadcrumb(newPath);
      setMoveDialogCurrentFolder(folderId === 'root' ? null : folderId);
      
      // Load folder contents for the move dialog
      const folderPath = folderId === 'root' ? '' : folderId;
      await loadFolderContents(folderPath);
    }
  };

  const handleConfirmMove = async (destinationFolderId: string | null) => {
    // Use itemsToMove if available (bulk move), otherwise use itemToMove (single move)
    const itemsToMoveArray = itemsToMove.length > 0 ? itemsToMove : (itemToMove ? [itemToMove] : []);
    
    if (itemsToMoveArray.length === 0 || !user) return;
    
    const destFolderPath = destinationFolderId === 'root' ? '' : destinationFolderId || '';
    const sourceFolderPaths = new Set<string>();
    
    // Helper function to check if a folder is a descendant of another folder
    const isDescendant = (folderId: string, targetId: string): boolean => {
      if (folderId === targetId) return true;
      const folder = items.get(folderId);
      if (!folder || !folder.parentId || folder.parentId === 'root') return false;
      if (folder.parentId === targetId) return true;
      return isDescendant(folder.parentId, targetId);
    };
    
    // Validate all moves first
    for (const item of itemsToMoveArray) {
      // Prevent moving item into itself or its own children
      if (item.type === 'folder') {
        if (destinationFolderId === item.id || (destinationFolderId && isDescendant(destinationFolderId, item.id))) {
          // Don't allow moving folder into itself or its descendants
          console.warn(`Cannot move folder ${item.name} into itself or its descendants`);
          continue;
        }
      }
      
      const sourceFolderPath = item.parentId === 'root' ? '' : item.parentId || '';
      
      // Don't move if already in the same folder
      if (sourceFolderPath === destFolderPath) {
        continue;
      }
      
      sourceFolderPaths.add(sourceFolderPath);
    }
    
    if (sourceFolderPaths.size === 0) {
      // No valid moves
      setMoveDialogOpen(false);
      setItemToMove(null);
      setItemsToMove([]);
      return;
    }
    
    try {
      // Move all items
      for (const item of itemsToMoveArray) {
        const sourceFolderPath = item.parentId === 'root' ? '' : item.parentId || '';
        
        // Skip invalid moves (already validated above, but double-check)
        if (sourceFolderPath === destFolderPath) continue;
        if (item.type === 'folder') {
          if (destinationFolderId === item.id || (destinationFolderId && isDescendant(destinationFolderId, item.id))) {
            continue;
          }
        }
        
        const response = await filesystemAPI.moveItem({
          user_id: user.id,
          item_id: item.id,
          source_folder_path: sourceFolderPath,
          dest_folder_path: destFolderPath,
        });
        
        if (response.success && response.result) {
          // Update local state
          setItems(prev => {
            const newMap = new Map(prev);
            const itemToUpdate = newMap.get(item.id);
            if (itemToUpdate) {
              newMap.set(item.id, {
                ...itemToUpdate,
                parentId: destinationFolderId || 'root',
                updated_at: response.result.updated_at || Date.now(),
              });
            }
            return newMap;
          });
        } else {
          console.error('Failed to move item:', response.error);
          // TODO: Show error message
        }
      }
      
      // Reload all affected folders
      for (const sourcePath of sourceFolderPaths) {
        await loadFolderContents(sourcePath);
      }
      await loadFolderContents(destFolderPath);
      
      // Also reload current folder if we're viewing it
      const currentFolderPath = currentFolderId === 'root' ? '' : currentFolderId || '';
      if (sourceFolderPaths.has(currentFolderPath) || currentFolderPath === destFolderPath) {
        await loadFolderContents(currentFolderPath);
      }
      
      // Clear selection
      setSelectedItems(new Set());
    } catch (error) {
      console.error('Error moving items:', error);
      // TODO: Show error message
    }
    
    setMoveDialogOpen(false);
    setItemToMove(null);
    setItemsToMove([]);
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
        onContextMenu={(e) => {
          // Only show context menu on empty area if no items are selected
          if (selectedItems.size === 0 && !selectedItem) {
            handleContextMenu(e);
          }
        }}
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
        {isLoading ? (
          <Box 
            sx={{ 
              p: 8, 
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '200px',
            }}
          >
            <CircularProgress 
              size={48} 
              sx={{ 
                color: '#3b82f6',
                mb: 2,
              }} 
            />
            <Typography variant="body1" sx={{ color: '#9ca3af' }}>
              Loading files...
            </Typography>
          </Box>
        ) : currentItems.length === 0 ? (
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
              {draggedItem 
                ? 'Drop here to move item' 
                : clipboard && clipboard.length > 0 
                  ? 'Right-click to paste items' 
                  : 'Create a folder or add a context item to get started'}
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0 }}>
            {/* Header with select all checkbox and bulk actions */}
            {currentItems.length > 0 && (
              <ListItem
                sx={{
                  borderBottom: '2px solid #374151',
                  backgroundColor: 'rgba(15, 23, 42, 0.5)',
                  py: 1,
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Checkbox
                    size="small"
                    indeterminate={selectedItems.size > 0 && selectedItems.size < currentItems.length}
                    checked={currentItems.length > 0 && selectedItems.size === currentItems.length}
                    onChange={handleSelectAll}
                    sx={{ 
                      color: '#9ca3af', 
                      '&.Mui-checked': { color: '#10b981' }, 
                      '&.MuiCheckbox-indeterminate': { color: '#10b981' } 
                    }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography sx={{ color: '#9ca3af', fontSize: '0.875rem', fontWeight: 600 }}>
                      {selectedItems.size > 0 ? `${selectedItems.size} selected` : 'Select all'}
                    </Typography>
                  }
                />
                {(selectedItems.size > 0 || (clipboard && clipboard.length > 0)) && (
                  <ListItemSecondaryAction>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {/* Paste button - shown when clipboard has items */}
                      {clipboard && clipboard.length > 0 && (
                        <Tooltip title="Paste">
                          <IconButton
                            size="small"
                            onClick={handlePasteItem}
                            sx={{
                              color: '#10b981',
                              '&:hover': {
                                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                              },
                            }}
                          >
                            <PasteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {/* Other bulk actions - shown when items are selected */}
                      {selectedItems.size > 0 && (
                        <>
                          <Tooltip title="Add to Context">
                            <IconButton
                              size="small"
                              onClick={() => handleBulkAddToContext('sidebar')}
                              sx={{
                                color: '#3b82f6',
                                '&:hover': {
                                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                },
                              }}
                            >
                              <SidebarChatIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Copy">
                            <IconButton
                              size="small"
                              onClick={handleCopyItem}
                              sx={{
                                color: '#9ca3af',
                                '&:hover': {
                                  backgroundColor: 'rgba(156, 163, 175, 0.2)',
                                },
                              }}
                            >
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Move">
                            <IconButton
                              size="small"
                              onClick={handleBulkMove}
                              sx={{
                                color: '#3b82f6',
                                '&:hover': {
                                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                },
                              }}
                            >
                              <FolderIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              onClick={handleBulkDelete}
                              sx={{
                                color: '#ef4444',
                                '&:hover': {
                                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                },
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </Box>
                  </ListItemSecondaryAction>
                )}
              </ListItem>
            )}
            
            {/* Folders */}
            {folders.map((folder) => {
              const isSelected = selectedItems.has(folder.id);
              const allItems = [...folders, ...files];
              const itemIndex = allItems.findIndex(item => item.id === folder.id);
              
              return (
                <ListItem
                  key={folder.id}
                  button
                  disableRipple
                  draggable={selectedItems.has(folder.id) || selectedItems.size === 0}
                  onDragStart={(e) => handleDragStart(e, folder)}
                  onDragOver={(e) => handleDragOver(e, folder.id, true)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folder)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => handleItemClick(folder, itemIndex, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleFolderClick(folder);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, folder)}
                  onMouseDown={(e) => {
                    // Prevent browser context menu on right click
                    if (e.button === 2) {
                      e.preventDefault();
                    }
                  }}
                  sx={{
                    borderBottom: '1px solid #374151',
                    backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    cursor: isSelected ? 'default' : 'grab',
                    opacity: draggedItem?.id === folder.id ? 0.5 : 1,
                    borderLeft: dragOverFolder === folder.id ? '3px solid #3b82f6' : isSelected ? '3px solid #10b981' : 'none',
                    '&:hover': { 
                      backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                      borderLeft: dragOverFolder === folder.id ? '3px solid #3b82f6' : isSelected ? '3px solid #10b981' : '2px solid #3b82f6',
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
              );
            })}

            {/* Files */}
            {files.map((file) => {
              const isSelected = selectedItems.has(file.id);
              const allItems = [...folders, ...files];
              const itemIndex = allItems.findIndex(item => item.id === file.id);
              
              return (
                <ListItem
                  key={file.id}
                  button
                  disableRipple
                  draggable={selectedItems.has(file.id) || selectedItems.size === 0}
                  onDragStart={(e) => handleDragStart(e, file)}
                  onDragOver={(e) => handleDragOver(e, file.id, false)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, file)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => handleItemClick(file, itemIndex, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (user?.id) {
                      openFilePreview(
                        {
                          id: file.id,
                          name: file.metadata?.title || file.name,
                          type: file.type as 'context_item' | 'uploaded_file' | 'agent_file',
                          s3_key: file.s3_key || '',
                          metadata: file.metadata,
                          parentId: file.parentId,
                        },
                        user.id,
                        currentFolderId === 'root' ? '' : currentFolderId || ''
                      );
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                  onMouseDown={(e) => {
                    // Prevent browser context menu on right click
                    if (e.button === 2) {
                      e.preventDefault();
                    }
                  }}
                  sx={{
                    borderBottom: '1px solid #374151',
                    backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    cursor: isSelected ? 'default' : 'grab',
                    opacity: draggedItem?.id === file.id ? 0.5 : 1,
                    borderLeft: dragOverItem === file.id ? '3px solid #3b82f6' : isSelected ? '3px solid #10b981' : 'none',
                    '&:hover': { 
                      backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                      borderLeft: dragOverItem === file.id ? '3px solid #3b82f6' : isSelected ? '3px solid #10b981' : '2px solid #3b82f6',
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
                        if (user?.id) {
                          openFilePreview(
                            {
                              id: file.id,
                              name: file.metadata?.title || file.name,
                              type: file.type as 'context_item' | 'uploaded_file' | 'agent_file',
                              s3_key: file.s3_key || '',
                              metadata: file.metadata,
                              parentId: file.parentId,
                            },
                            user.id,
                            currentFolderId === 'root' ? '' : currentFolderId || ''
                          );
                        }
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
              );
            })}
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
        {/* Paste option - always available when clipboard has items */}
        {clipboard && clipboard.length > 0 && (
          <MenuItem 
            onClick={handlePasteItem}
            sx={{ 
              color: '#10b981',
              '&:hover': { 
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
              },
            }}
          >
            <PasteIcon sx={{ mr: 1.5, fontSize: 18, color: '#10b981' }} />
            Paste {clipboard.length === 1 ? clipboard[0].name : `${clipboard.length} items`}
          </MenuItem>
        )}
        
        {/* Divider if we have both paste and item-specific options */}
        {clipboard && clipboard.length > 0 && selectedItem && <Box sx={{ borderTop: '1px solid #374151', my: 0.5 }} />}
        
        {/* Item-specific options - disabled when no item selected */}
        {selectedItem && selectedItem.type !== 'folder' && (
          <MenuItem onClick={() => {
            if (selectedItem) {
              if (user?.id && selectedItem.type !== 'folder') {
                openFilePreview(
                  {
                    id: selectedItem.id,
                    name: selectedItem.metadata?.title || selectedItem.name,
                    type: selectedItem.type as 'context_item' | 'uploaded_file' | 'agent_file',
                    s3_key: selectedItem.s3_key || '',
                    metadata: selectedItem.metadata,
                    parentId: selectedItem.parentId,
                  },
                  user.id,
                  currentFolderId === 'root' ? '' : currentFolderId || ''
                );
              }
            }
            setContextMenuAnchor(null);
          }}>
            <ViewIcon sx={{ mr: 1.5, fontSize: 18, color: '#3b82f6' }} />
            View
          </MenuItem>
        )}
        {selectedItem && (
          <>
            <MenuItem onClick={() => handleAddItemToContext(selectedItem, 'sidebar')}>
              <SidebarChatIcon sx={{ mr: 1.5, fontSize: 18, color: '#3b82f6' }} />
              Add to Context
            </MenuItem>
          </>
        )}
        <MenuItem 
          onClick={handleCopyItem}
          disabled={!selectedItem && selectedItems.size === 0}
          sx={{ 
            color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#ffffff',
            opacity: (!selectedItem && selectedItems.size === 0) ? 0.5 : 1,
            '&:hover': { 
              backgroundColor: (!selectedItem && selectedItems.size === 0) ? 'transparent' : 'rgba(59, 130, 246, 0.2)',
            },
            '&.Mui-disabled': {
              color: '#6b7280',
              opacity: 0.5,
            },
          }}
        >
          <CopyIcon sx={{ mr: 1.5, fontSize: 18, color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#9ca3af' }} />
          Copy {selectedItems.size > 1 ? `${selectedItems.size} items` : ''}
        </MenuItem>
        <MenuItem 
          onClick={handleRenameItem}
          disabled={!selectedItem}
          sx={{ 
            color: !selectedItem ? '#6b7280' : '#ffffff',
            opacity: !selectedItem ? 0.5 : 1,
            '&:hover': { 
              backgroundColor: !selectedItem ? 'transparent' : 'rgba(59, 130, 246, 0.2)',
            },
            '&.Mui-disabled': {
              color: '#6b7280',
              opacity: 0.5,
            },
          }}
        >
          <EditIcon sx={{ mr: 1.5, fontSize: 18, color: !selectedItem ? '#6b7280' : '#9ca3af' }} />
          Rename
        </MenuItem>
        <MenuItem 
          onClick={handleMoveItem}
          disabled={!selectedItem && selectedItems.size === 0}
          sx={{ 
            color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#ffffff',
            opacity: (!selectedItem && selectedItems.size === 0) ? 0.5 : 1,
            '&:hover': { 
              backgroundColor: (!selectedItem && selectedItems.size === 0) ? 'transparent' : 'rgba(59, 130, 246, 0.2)',
            },
            '&.Mui-disabled': {
              color: '#6b7280',
              opacity: 0.5,
            },
          }}
        >
          <FolderIcon sx={{ mr: 1.5, fontSize: 18, color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#3b82f6' }} />
          Move
        </MenuItem>
        <MenuItem 
          onClick={handleDeleteItem} 
          disabled={!selectedItem && selectedItems.size === 0}
          sx={{ 
            color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#ef4444',
            opacity: (!selectedItem && selectedItems.size === 0) ? 0.5 : 1,
            '&:hover': { 
              backgroundColor: (!selectedItem && selectedItems.size === 0) ? 'transparent' : 'rgba(239, 68, 68, 0.2)',
            },
            '&.Mui-disabled': {
              color: '#6b7280',
              opacity: 0.5,
            },
          }}
        >
          <DeleteIcon sx={{ mr: 1.5, fontSize: 18, color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#ef4444' }} />
          Delete
        </MenuItem>
      </Menu>


      {/* Rename Dialog */}
      <Dialog
        open={renameDialogOpen}
        onClose={() => {
          setRenameDialogOpen(false);
          setItemToRename(null);
          setNewItemName('');
        }}
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
          Rename {itemToRename?.type === 'folder' ? 'Folder' : 'Item'}
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            variant="outlined"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleConfirmRename();
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
            onClick={() => {
              setRenameDialogOpen(false);
              setItemToRename(null);
              setNewItemName('');
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
            onClick={handleConfirmRename}
            variant="contained"
            disabled={!newItemName.trim()}
            sx={{
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              borderRadius: '0px',
              border: '1px solid #2563eb',
              '&:hover': { backgroundColor: '#2563eb' },
              '&:disabled': {
                backgroundColor: '#374151',
                color: '#6b7280',
                borderColor: '#374151',
              },
            }}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Move Dialog */}
      <Dialog
        open={moveDialogOpen}
        onClose={() => {
          setMoveDialogOpen(false);
          setItemToMove(null);
          setItemsToMove([]);
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
          Move {itemsToMove.length > 1 ? `${itemsToMove.length} items` : `"${itemToMove?.name}"`}
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
              onClick={async () => {
                const newPath = moveDialogBreadcrumb.slice(0, -1);
                setMoveDialogBreadcrumb(newPath);
                const newFolderId = newPath.length > 1 ? newPath[newPath.length - 1].id : null;
                setMoveDialogCurrentFolder(newFolderId);
                
                // Load folder contents for the move dialog
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
              setItemsToMove([]);
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

