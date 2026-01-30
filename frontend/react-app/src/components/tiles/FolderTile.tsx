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
  FormControlLabel,
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
  ContentCopy as CopyIcon,
  ContentPaste as PasteIcon,
  DriveFileRenameOutline as RenameIcon,
  DriveFileMove as MoveIcon,
} from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';
import { filesystemAPI } from '@/services/api';
import { addToContext } from './common/contextManager';
import { TileHeaderActions, TileCustomizationDialog, useTilePinning, getIconByName, getDefaultIconForTileType } from './common';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';

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
  isDeletingTiles?: boolean;
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
  isDeletingTiles = false,
  onDragStart,
  isDragging = false,
  isSelected = false,
  onSelectionChange,
}) => {
  const { user } = useAuth();
  const { openFilePreview } = useDialogManagerHelpers();
  
  // Clipboard helpers (must be defined before state initialization)
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
    if (items && items.length > 0) {
      sessionStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(items));
      window.dispatchEvent(new CustomEvent('filesystem-clipboard-update'));
    } else {
      sessionStorage.removeItem(CLIPBOARD_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent('filesystem-clipboard-update'));
    }
  };
  
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
  const [uploadTermsDialogOpen, setUploadTermsDialogOpen] = useState(false);
  const [uploadTermsAccepted, setUploadTermsAccepted] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [itemToRename, setItemToRename] = useState<FileSystemItem | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  
  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<FileSystemItem | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);

  // Context menu
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [itemContextMenuAnchor, setItemContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [itemContextMenuPosition, setItemContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedItem, setSelectedItem] = useState<FileSystemItem | null>(null);
  const [folderSelectionDialogOpen, setFolderSelectionDialogOpen] = useState(false);
  
  
  // Multi-select state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Clipboard state (synced with sessionStorage)
  const [clipboard, setClipboardState] = useState<Array<{ item_id: string; source_folder_path: string; is_folder: boolean; name: string }> | null>(getClipboard());
  
  // Sync clipboard from sessionStorage
  React.useEffect(() => {
    const syncClipboard = () => {
      const stored = getClipboard();
      setClipboardState(stored);
    };
    
    // Initial sync
    syncClipboard();
    
    // Listen for clipboard updates
    const handleClipboardUpdate = () => syncClipboard();
    window.addEventListener('filesystem-clipboard-update', handleClipboardUpdate);
    window.addEventListener('storage', syncClipboard);
    
    return () => {
      window.removeEventListener('filesystem-clipboard-update', handleClipboardUpdate);
      window.removeEventListener('storage', syncClipboard);
    };
  }, []);

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

  // Handle remove tile
  const handleRemove = () => {
    onRemove(id);
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

  // Copy item (supports both single item and multi-select)
  const handleCopyItem = () => {
    if (!user) return;
    
    const currentItems = getCurrentFolderItems();
    
    // Support both single item (from context menu) and multi-select
    const itemsToCopy = selectedItems.size > 0 
      ? currentItems.filter(item => selectedItems.has(item.id))
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
      const sourcePath = isFolder ? (item.id === 'root' ? '' : item.id) : currentFolderPath;
      
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
    setClipboard(newClipboard);
    setClipboardState(newClipboard);
    
    setItemContextMenuAnchor(null);
    setSelectedItem(null);
    setSelectedItems(new Set()); // Clear selection after copying
  };

  // Paste item
  const handlePasteItem = async () => {
    const clipboardItems = getClipboard();
    if (!clipboardItems || clipboardItems.length === 0 || !user) return;
    
    try {
      // Prepare item_data for backend (just UUIDs and paths)
      const item_data = clipboardItems.map(item => ({
        item_id: item.item_id,
        source_folder_path: item.source_folder_path,
        is_folder: item.is_folder,
      }));
      
      const response = await filesystemAPI.pasteItemsByIds({
        user_id: user.id,
        dest_folder_path: currentFolderPath,
        item_data: item_data,
      });
      
      if (response.success) {
        // Reload folder contents
        await loadFolderContents(currentFolderPath);
        setClipboard(null); // Clear clipboard after successful paste
        setClipboardState(null);
        setItemContextMenuAnchor(null); // Close context menu
      } else {
        setError(response.error || 'Failed to paste items');
      }
    } catch (err: any) {
      console.error('Error pasting items:', err);
      setError(err.message || 'Error pasting items');
    }
  };

  // Rename item handler
  const handleRenameItem = () => {
    if (!selectedItem) return;
    setItemToRename(selectedItem);
    setNewItemName(selectedItem.name);
    setRenameDialogOpen(true);
    setItemContextMenuAnchor(null);
    setSelectedItem(null);
  };

  const handleConfirmRename = async () => {
    if (!itemToRename || !newItemName.trim() || !user) return;
    
    try {
      const response = await filesystemAPI.renameItem({
        user_id: user.id,
        folder_path: currentFolderPath,
        item_id: itemToRename.id,
        new_name: newItemName.trim(),
      });
      
      if (response.success && response.result) {
        // Reload folder contents
        await loadFolderContents(currentFolderPath);
      } else {
        setError(response.error || 'Failed to rename item');
      }
    } catch (err: any) {
      setError(err.message || 'Error renaming item');
    }
    
    setRenameDialogOpen(false);
    setItemToRename(null);
    setNewItemName('');
  };

  // Move item handler
  const handleMoveItem = () => {
    if (!selectedItem && selectedItems.size === 0) return;
    setMoveDialogOpen(true);
    setItemContextMenuAnchor(null);
  };

  const handleConfirmMove = async (destFolderPath: string) => {
    if (!user) return;
    
    const currentItems = getCurrentFolderItems();
    const itemsToMove = selectedItems.size > 0 
      ? currentItems.filter(item => selectedItems.has(item.id))
      : selectedItem 
        ? [selectedItem]
        : [];
    
    if (itemsToMove.length === 0) return;
    
    try {
      // Use bulk move operation for better performance
      // Don't move if already in the same folder
      const items = currentFolderPath !== destFolderPath
        ? itemsToMove.map(item => ({
            item_id: item.id,
            source_folder_path: currentFolderPath,
          }))
        : [];
      
      if (items.length === 0) {
        // All items are already in the destination folder
        setMoveDialogOpen(false);
        return;
      }
      
      const response = await filesystemAPI.moveBulkItems({
        user_id: user.id,
        items: items,
        dest_folder_path: destFolderPath,
      });
      
      if (response.success) {
        const result = response.result as any;
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} item(s) failed to move:`, result.errors);
          setError(`Failed to move ${result.errors.length} item(s). Check console for details.`);
        }
      } else {
        setError(response.error || 'Failed to move items');
        return;
      }
      
      // Reload folder contents
      await loadFolderContents(currentFolderPath);
      setSelectedItems(new Set());
      setSelectedItem(null);
    } catch (err: any) {
      setError(err.message || 'Error moving items');
    }
    
    setMoveDialogOpen(false);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, item: FileSystemItem) => {
    setDraggedItem(item);
    // Support multi-select - if item is selected and there are multiple selections, drag all selected items
    const currentItems = getCurrentFolderItems();
    let itemsToDrag: FileSystemItem[];
    
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
    e.dataTransfer.effectAllowed = 'copyMove'; // Allow both copy (to sidebar) and move (within folder)
    
    // Set data for internal folder moves (legacy format)
    e.dataTransfer.setData('text/plain', JSON.stringify(itemIds));
    
    // Set data for sidebar drops (new format with type and full objects)
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'filesystem_items',
      items: itemsToDrag,
      folderPath: currentFolderPath
    }));
  };

  const handleDragOver = (e: React.DragEvent, targetItem: FileSystemItem) => {
    // Check if this is an external drag (from another tile)
    const types = e.dataTransfer.types;
    const isExternalDrag = !draggedItem && (types.includes('text/plain') || types.includes('application/json'));
    
    // For external drags, allow event to bubble up to List component
    if (isExternalDrag) {
      return; // Don't prevent default or stop propagation, let it bubble to List
    }
    
    // For internal drags, handle as before
    e.preventDefault();
    e.stopPropagation();
    if (draggedItem && draggedItem.id !== targetItem.id) {
      setDragOverItem(targetItem.id);
    }
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = async (e: React.DragEvent, targetItem: FileSystemItem) => {
    // Check if this is an external drag (from another tile)
    const types = e.dataTransfer.types;
    const isExternalDrag = !draggedItem && (types.includes('text/plain') || types.includes('application/json'));
    
    // For external drags, allow event to bubble up to List component
    if (isExternalDrag) {
      return; // Don't prevent default or stop propagation, let it bubble to List
    }
    
    // For internal drags, handle as before
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedItem || !user || draggedItem.id === targetItem.id) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }

    try {
      // Check if we're dragging multiple items
      const dragData = e.dataTransfer.getData('text/plain');
      let itemsToMove: FileSystemItem[] = [];
      
      try {
        const parsedIds = JSON.parse(dragData);
        if (Array.isArray(parsedIds)) {
          // Multiple items
          const currentItems = getCurrentFolderItems();
          itemsToMove = parsedIds.map(id => currentItems.find(item => item.id === id)).filter(Boolean) as FileSystemItem[];
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
        return;
      }
      
      // Determine destination folder path
      let destFolderPath: string;
      if (targetItem.type === 'folder') {
        // Dropping on a folder - move into that folder
        destFolderPath = targetItem.id === 'root' ? '' : targetItem.id;
      } else {
        // Dropping on a file - move to the same parent folder (current folder)
        destFolderPath = currentFolderPath;
      }
      
      // Use bulk move operation for better performance
      // Don't move if already in the same folder
      const items = currentFolderPath !== destFolderPath
        ? itemsToMove.map(item => ({
            item_id: item.id,
            source_folder_path: currentFolderPath,
          }))
        : [];
      
      if (items.length === 0) {
        // All items are already in the destination folder
        setDraggedItem(null);
        setDragOverItem(null);
        return;
      }
      
      const response = await filesystemAPI.moveBulkItems({
        user_id: user.id,
        items: items,
        dest_folder_path: destFolderPath,
      });
      
      if (response.success) {
        const result = response.result as any;
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} item(s) failed to move:`, result.errors);
          setError(`Failed to move ${result.errors.length} item(s). Check console for details.`);
        }
      } else {
        setError(response.error || 'Failed to move items');
        return;
      }
      
      // Reload folder contents
      await loadFolderContents(currentFolderPath);
      
      // Clear selection
      setSelectedItems(new Set());
    } catch (err: any) {
      setError(err.message || 'Error moving items');
    }
    
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  // Delete item (supports both single item and multi-select)
  const handleDeleteItem = async () => {
    if (!user) return;
    
    const currentItems = getCurrentFolderItems();
    
    // Support both single item (from context menu) and multi-select
    const itemsToDelete = selectedItems.size > 0 
      ? currentItems.filter(item => selectedItems.has(item.id))
      : selectedItem 
        ? [selectedItem]
        : [];
    
    if (itemsToDelete.length === 0) return;
    
    try {
      // Use bulk delete operation for better performance
      const items = itemsToDelete.map(item => ({
        item_id: item.id,
        folder_path: item.type === 'folder' ? (item.id === 'root' ? '' : item.id) : currentFolderPath,
        is_folder: item.type === 'folder',
      }));
      
      const response = await filesystemAPI.deleteBulkItems({
        user_id: user.id,
        items: items,
      });
      
      if (response.success) {
        const result = response.result as any;
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} item(s) failed to delete:`, result.errors);
          setError(`Failed to delete ${result.errors.length} item(s). Check console for details.`);
        }
      } else {
        setError(response.error || 'Failed to delete items');
        return;
      }
      
      setItemContextMenuAnchor(null);
      setSelectedItem(null);
      setSelectedItems(new Set());
      await loadFolderContents(currentFolderPath);
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
    e.preventDefault(); // Prevent browser context menu
    e.stopPropagation(); // Prevent GridDashboard context menu
    setSelectedItem(item);
    // Also add to selectedItems if not already selected
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      newSet.add(item.id);
      return newSet;
    });
    setItemContextMenuPosition({ x: e.clientX, y: e.clientY });
    setItemContextMenuAnchor(e.currentTarget as HTMLElement);
  };

  // Handle right-click on empty area within the tile
  const handleTileContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent browser context menu
    e.stopPropagation(); // Prevent GridDashboard context menu
    setSelectedItem(null); // Empty area context menu
    setItemContextMenuPosition({ x: e.clientX, y: e.clientY });
    setItemContextMenuAnchor(e.currentTarget as HTMLElement);
  };

  const handleItemContextMenuClose = () => {
    setItemContextMenuAnchor(null);
    setItemContextMenuPosition(null);
    setSelectedItem(null);
  };

  // Add to context (handles multiple selected items)
  const handleAddToContext = async (target: 'new' | 'sidebar') => {
    if (!user) return;
    
    const currentItems = getCurrentFolderItems();
    
    // If a single item is selected via right-click, include it
    let itemsToAdd = currentItems.filter(item => selectedItems.has(item.id));
    
    // If no items in selectedItems but selectedItem is set, use that
    if (itemsToAdd.length === 0 && selectedItem) {
      itemsToAdd = [selectedItem];
    }
    
    if (itemsToAdd.length === 0) return;
    
    try {
      // Prepare all context items
      const contextItems = itemsToAdd.map(item => ({
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
      }));
      
      if (target === 'sidebar') {
        // Use batch addition for multiple items, single event for one item
        if (contextItems.length > 1) {
          const event = new CustomEvent('add-multiple-to-sidebar-context', {
            detail: contextItems
          });
          window.dispatchEvent(event);
        } else {
          const event = new CustomEvent('add-to-sidebar-context', {
            detail: contextItems[0]
          });
          window.dispatchEvent(event);
        }
      } else {
        // Add to new chat - dispatch each item separately for new chat context
        contextItems.forEach(contextItem => {
          addToContext(contextItem);
        });
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

  // Drag and drop handlers for accepting items from other tiles
  const [isDragOverTile, setIsDragOverTile] = useState(false);

  // Global drag end handler to reset state when drag ends outside the drop zone
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setIsDragOverTile(false);
    };
    
    document.addEventListener('dragend', handleGlobalDragEnd);
    return () => {
      document.removeEventListener('dragend', handleGlobalDragEnd);
    };
  }, []);

  const handleTileDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if this is a drag from another tile by checking available data types
    // External tiles use text/plain or application/json, internal moves use filesystem_items
    const types = e.dataTransfer.types;
    // Only show drag over visual for external tiles (not internal filesystem moves)
    // External tiles will have text/plain or application/json with structured data
    // Internal moves will be handled by the item-level drop handlers
    if (types.includes('text/plain') || types.includes('application/json')) {
      // Check if it's not a filesystem_items type (which is handled by item-level handlers)
      // We'll allow the drop and check the actual data in handleTileDrop
      setIsDragOverTile(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleTileDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear drag over if we're leaving the tile area (not entering a child)
    const relatedTarget = e.relatedTarget as Node;
    if (!e.currentTarget.contains(relatedTarget)) {
      setIsDragOverTile(false);
    }
  }, []);

  const handleTileDragEnd = useCallback(() => {
    // Always reset drag over state when drag ends
    setIsDragOverTile(false);
  }, []);

  const handleTileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverTile(false);
    
    if (!user) return;

    try {
      // Try to get data from text/plain first (standard format for tiles)
      let data;
      try {
        const textData = e.dataTransfer.getData('text/plain');
        if (textData) {
          data = JSON.parse(textData);
        } else {
          // Fallback to application/json
          const jsonData = e.dataTransfer.getData('application/json');
          if (jsonData) {
            data = JSON.parse(jsonData);
          } else {
            return; // No valid drag data
          }
        }
      } catch {
        return; // Failed to parse drag data
      }

      // Ignore filesystem_items (handled by internal drop handlers)
      if (data && data.type === 'filesystem_items') {
        return; // Let internal handlers handle this
      }

      // Handle different tile types
      let items: Array<{ 
        context_data: any; 
        title: string; 
        item_type?: 'context_item' | 'tile' | 'sec_filing' | 'lda_disclosure' | 'congress_bill' | 'politician_trade' | 'govt_contract' | 'news_article' | 'stock_result' 
      }> = [];

      if (data && data.type === 'lda_filings' && data.filings && Array.isArray(data.filings)) {
        items = data.filings.map((filing: any) => {
          const filingId = filing.id || filing.filing_uuid || `filing_${Date.now()}`;
          const title = filing.registrant_name 
            ? `LDA Filing - ${filing.registrant_name}${filing.client_name ? ` / ${filing.client_name}` : ''}`
            : `LDA Filing ${filingId}`;
          return {
            context_data: filing,
            title: title,
            item_type: 'lda_disclosure' as const,
          };
        });
      } else if (data.type === 'govt_contracts' && data.awards && Array.isArray(data.awards)) {
        items = data.awards.map((award: any) => {
          const title = award.recipient_name 
            ? `Government Contract - ${award.recipient_name}${award.awarding_agency_name ? ` / ${award.awarding_agency_name}` : ''}`
            : `Government Contract ${award.award_id || ''}`;
          return {
            context_data: award,
            title: title,
            item_type: 'govt_contract' as const,
          };
        });
      } else if (data.type === 'sec_filings' && data.filings && Array.isArray(data.filings)) {
        items = data.filings.map((filing: any) => {
          const title = filing.filingEntity 
            ? `SEC Filing - ${filing.filingEntity}${filing.form ? ` (${filing.form})` : ''}`
            : `SEC Filing ${filing.accession || ''}`;
          return {
            context_data: filing,
            title: title,
            item_type: 'sec_filing' as const,
          };
        });
      } else if (data.type === 'congress_bills' && data.bills && Array.isArray(data.bills)) {
        items = data.bills.map((bill: any) => {
          const title = `${bill.bill_type || 'Bill'} ${bill.bill_number || ''} - ${bill.bill_title || 'Untitled Bill'}`.trim();
          return {
            context_data: bill,
            title: title,
            item_type: 'congress_bill' as const,
          };
        });
      } else if (data.type === 'politician_trades' && data.trades && Array.isArray(data.trades)) {
        items = data.trades.map((trade: any) => {
          const title = `${trade.politicianName || 'Unknown'} - ${trade.securitySymbol || trade.securityName || 'Trade'}`;
          return {
            context_data: trade,
            title: title,
            item_type: 'politician_trade' as const,
          };
        });
      } else if (data.type === 'news_articles' && data.articles && Array.isArray(data.articles)) {
        items = data.articles.map((article: any) => {
          const title = article.title || 'News Article';
          return {
            context_data: article,
            title: title,
            item_type: 'news_article' as const,
          };
        });
      } else if (data.type === 'stocks' && data.stocks && Array.isArray(data.stocks)) {
        items = data.stocks.map((stock: any) => {
          const title = `${stock.symbol || 'Stock'} - ${stock.name || stock.symbol || 'Unknown'}`;
          return {
            context_data: stock,
            title: title,
            item_type: 'stock_result' as const,
          };
        });
      }

      if (items.length === 0) {
        // No valid items to add
        return;
      }

      // Use bulk operation to add items to current folder
      const response = await filesystemAPI.addBulkContextItems({
        user_id: user.id,
        folder_path: currentFolderPath,
        items: items,
      });

      if (response.success) {
        const result = response.result as any;
        console.log(`✅ FolderTile [${id}]: Saved ${result?.succeeded || items.length} of ${items.length} item(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} item(s) failed to save:`, result.errors);
        }
        
        // Refresh folder contents to show the new items
        await loadFolderContents(currentFolderPath);
      } else {
        console.error('❌ FolderTile: Failed to save items:', response.error);
        setError(response.error || 'Failed to save items');
      }
    } catch (error: any) {
      console.error('❌ FolderTile: Error handling drop:', error);
      setError(error.message || 'Error saving items');
    } finally {
      // Always reset drag over state after drop completes (success or error)
      setIsDragOverTile(false);
    }
  }, [user, currentFolderPath, id, loadFolderContents]);

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
      onContextMenu={handleTileContextMenu}
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
            disabled: isDeletingTiles,
          }}
        />
      </Box>

      {/* Content Area */}
      <Box
        onDragOver={handleTileDragOver}
        onDragLeave={handleTileDragLeave}
        onDrop={handleTileDrop}
        onDragEnd={handleTileDragEnd}
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          position: 'relative',
          border: isDragOverTile ? `2px dashed ${tileColor}` : '2px solid transparent',
          borderRadius: isDragOverTile ? '4px' : '0px',
          backgroundColor: isDragOverTile ? `${tileColor}10` : 'transparent',
          transition: 'all 0.2s ease',
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
        {/* Drag over indicator */}
        {isDragOverTile && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${tileColor}20`,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            <Typography
              variant="h6"
              sx={{
                color: tileColor,
                fontWeight: 600,
                textAlign: 'center',
                px: 3,
                py: 2,
                border: `2px dashed ${tileColor}`,
                borderRadius: '4px',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
              }}
            >
              Drop items here to add to folder
            </Typography>
          </Box>
        )}
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
        ) : items.length === 0 && folders.length === 0 ? (
          <Box
            sx={{
              p: 4,
              textAlign: 'center',
              minHeight: '150px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleTileContextMenu(e);
            }}
          >
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>
              This folder is empty
            </Typography>
            <Typography variant="caption" sx={{ color: '#6b7280', mt: 1 }}>
              {clipboard && clipboard.length > 0 ? 'Right-click to paste items' : 'Create a folder or add a file to get started'}
            </Typography>
          </Box>
        ) : (
          <List 
            onDragOver={handleTileDragOver}
            onDragLeave={handleTileDragLeave}
            onDrop={handleTileDrop}
            onDragEnd={handleTileDragEnd}
            onContextMenu={(e) => {
              // Only show context menu on empty area if no items are selected
              if (selectedItems.size === 0 && !selectedItem) {
                e.preventDefault();
                e.stopPropagation();
                handleTileContextMenu(e);
              }
            }}
            sx={{ 
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
                  draggable
                  onDragStart={(e) => handleDragStart(e, folder)}
                  onDragOver={(e) => handleDragOver(e, folder)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folder)}
                  onDragEnd={handleDragEnd}
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
                    backgroundColor: dragOverItem === folder.id ? 'rgba(59, 130, 246, 0.2)' : (isSelected ? 'rgba(16, 185, 129, 0.15)' : 'transparent'),
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
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDragOver={(e) => handleDragOver(e, item)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, item)}
                  onDragEnd={handleDragEnd}
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
                    if (user?.id) {
                      const itemType = item.type === 'context_item' || item.type === 'uploaded_file' || item.type === 'agent_file' 
                        ? item.type 
                        : 'context_item' as 'context_item' | 'uploaded_file' | 'agent_file';
                      const s3Key = item.s3_key || '';
                      openFilePreview(
                        {
                          id: item.id,
                          name: item.metadata?.title || item.name,
                          type: itemType,
                          parentId: item.parentId,
                          metadata: item.metadata,
                          s3_key: s3Key,
                        },
                        user.id,
                        currentFolderPath
                      );
                    }
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
                    backgroundColor: dragOverItem === item.id ? 'rgba(59, 130, 246, 0.2)' : (isSelected ? 'rgba(16, 185, 129, 0.15)' : 'transparent'),
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
        onClose={() => {
          if (!isUploading) {
            setUploadFileDialogOpen(false);
            setUploadTermsDialogOpen(false);
            setUploadTermsAccepted(false);
          }
        }}
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
            onClick={() => {
              setUploadFileDialogOpen(false);
              setUploadTermsDialogOpen(false);
              setUploadTermsAccepted(false);
            }}
            sx={{ color: '#9ca3af' }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => setUploadTermsDialogOpen(true)}
            disabled={!fileTitle.trim() || isUploading}
            sx={{ color: customColor }}
          >
            {isUploading ? <CircularProgress size={20} /> : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upload Terms & Conditions Dialog */}
      <Dialog
        open={uploadTermsDialogOpen}
        onClose={() => {
          if (!isUploading) {
            setUploadTermsDialogOpen(false);
            setUploadTermsAccepted(false);
          }
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            color: '#ffffff',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #374151', pb: 2, color: '#ffffff' }}>
          Terms & Conditions — File Upload
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body1" sx={{ color: '#e5e7eb', mb: 2, lineHeight: 1.6 }}>
            By uploading files to this system, you confirm that:
          </Typography>
          <Box
            component="ul"
            sx={{
              color: '#d1d5db',
              pl: 2.5,
              mb: 2,
              '& li': { mb: 1 },
            }}
          >
            <li>You will <strong>not</strong> upload any <strong>Official Use Only (OUO)</strong> or similarly restricted documents.</li>
            <li>You will <strong>not</strong> upload any documents that could create <strong>compliance risks</strong>, including but not limited to: classified, export-controlled, attorney-client privileged, or personally identifiable information (PII) that is not authorized for this system.</li>
            <li>You are responsible for ensuring that your uploads comply with your organization&apos;s policies and applicable laws.</li>
          </Box>
          <Typography variant="body2" sx={{ color: '#9ca3af', fontStyle: 'italic' }}>
            Violation of these terms may result in disciplinary action and removal of content.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={uploadTermsAccepted}
                onChange={(e) => setUploadTermsAccepted(e.target.checked)}
                sx={{
                  color: '#9ca3af',
                  '&.Mui-checked': { color: '#10b981' },
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: '#e5e7eb' }}>
                I have read and agree to these terms. I confirm that my upload does not include OUO or compliance-sensitive content.
              </Typography>
            }
            sx={{ mt: 2, display: 'block' }}
          />
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => {
              setUploadTermsDialogOpen(false);
              setUploadTermsAccepted(false);
            }}
            disabled={isUploading}
            sx={{ color: '#9ca3af' }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!uploadTermsAccepted) return;
              setUploadTermsDialogOpen(false);
              setUploadTermsAccepted(false);
              handleUploadFile();
            }}
            disabled={!uploadTermsAccepted || isUploading}
            sx={{ color: customColor }}
          >
            {isUploading ? <CircularProgress size={20} /> : 'I Accept'}
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
          Add to Context {selectedItems.size > 0 ? `(${selectedItems.size} item${selectedItems.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
      </Menu>

      {/* Item Context Menu */}
      <Menu
        anchorEl={itemContextMenuAnchor}
        anchorPosition={itemContextMenuPosition ? { top: itemContextMenuPosition.y, left: itemContextMenuPosition.x } : undefined}
        anchorReference={itemContextMenuPosition ? 'anchorPosition' : 'anchorEl'}
        open={Boolean(itemContextMenuAnchor)}
        onClose={handleItemContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          },
        }}
      >
        {/* Paste option - always available when clipboard has items */}
        {clipboard && clipboard.length > 0 && (
          <MenuItem
            onClick={handlePasteItem}
            sx={{ color: '#10b981', '&:hover': { backgroundColor: 'rgba(16, 185, 129, 0.2)' } }}
          >
            <PasteIcon sx={{ mr: 1, fontSize: 18, color: '#10b981' }} />
            Paste {clipboard.length === 1 ? clipboard[0].name : `${clipboard.length} items`}
          </MenuItem>
        )}
        
        {/* Divider if we have both paste and item-specific options */}
        {clipboard && clipboard.length > 0 && (selectedItem || selectedItems.size > 0) && <Box sx={{ borderTop: '1px solid #374151', my: 0.5 }} />}
        
        {/* Item-specific options */}
        {(selectedItem || selectedItems.size > 0) && (
          <MenuItem 
            onClick={() => handleAddToContext('sidebar')}
            disabled={selectedItems.size === 0 && !selectedItem}
            sx={{ 
              color: (selectedItems.size === 0 && !selectedItem) ? '#6b7280' : '#ffffff',
              opacity: (selectedItems.size === 0 && !selectedItem) ? 0.5 : 1,
              '&:hover': { 
                backgroundColor: (selectedItems.size === 0 && !selectedItem) ? 'transparent' : 'rgba(59, 130, 246, 0.2)',
              },
              '&.Mui-disabled': {
                color: '#6b7280',
                opacity: 0.5,
              },
            }}
          >
            <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: (selectedItems.size === 0 && !selectedItem) ? '#6b7280' : '#3b82f6' }} />
            Add to Context {selectedItems.size > 0 ? `(${selectedItems.size} item${selectedItems.size > 1 ? 's' : ''})` : selectedItem ? '(1 item)' : ''}
          </MenuItem>
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
          <CopyIcon sx={{ mr: 1, fontSize: 18, color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#9ca3af' }} />
          Copy {selectedItems.size > 1 ? `${selectedItems.size} items` : ''}
        </MenuItem>
        <MenuItem
          onClick={handleRenameItem}
          disabled={!selectedItem || selectedItems.size > 1}
          sx={{ 
            color: (!selectedItem || selectedItems.size > 1) ? '#6b7280' : '#ffffff',
            opacity: (!selectedItem || selectedItems.size > 1) ? 0.5 : 1,
            '&:hover': { 
              backgroundColor: (!selectedItem || selectedItems.size > 1) ? 'transparent' : 'rgba(59, 130, 246, 0.2)',
            },
            '&.Mui-disabled': {
              color: '#6b7280',
              opacity: 0.5,
            },
          }}
        >
          <RenameIcon sx={{ mr: 1, fontSize: 18, color: (!selectedItem || selectedItems.size > 1) ? '#6b7280' : '#9ca3af' }} />
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
          <MoveIcon sx={{ mr: 1, fontSize: 18, color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#9ca3af' }} />
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
          <DeleteIcon sx={{ mr: 1, fontSize: 18, color: (!selectedItem && selectedItems.size === 0) ? '#6b7280' : '#ef4444' }} />
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

      {/* Rename Dialog */}
      <Dialog
        open={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff' }}>Rename Item</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="New Name"
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
                '& fieldset': { borderColor: '#374151' },
              },
              '& .MuiInputLabel-root': { color: '#9ca3af' },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setRenameDialogOpen(false)}
            sx={{ color: '#9ca3af' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmRename}
            disabled={!newItemName.trim()}
            sx={{ color: customColor }}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Move Dialog */}
      <FileBrowserDialog
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        onSelect={handleConfirmMove}
        allowCreateFolder={true}
        title="Select Destination Folder"
      />


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
