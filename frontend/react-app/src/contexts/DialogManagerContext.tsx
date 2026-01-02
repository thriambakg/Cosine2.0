import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

export type DialogType = 'file_preview' | 'item_details';

export interface DialogItem {
  id: string;
  type: DialogType;
  title: string;
  data: any;
  props: any; // Additional props specific to each dialog type
  isMinimized: boolean;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  cachedContent?: any; // Cached preview/content data
  zIndex?: number; // Z-index for layering dialogs
}

interface DialogManagerContextType {
  dialogs: DialogItem[];
  openDialog: (dialog: Omit<DialogItem, 'id' | 'isMinimized'>) => string;
  closeDialog: (id: string) => void;
  minimizeDialog: (id: string) => void;
  restoreDialog: (id: string) => void;
  updateDialog: (id: string, updates: Partial<DialogItem>) => void;
  getDialog: (id: string) => DialogItem | undefined;
  clearAllDialogs: () => void;
  bringToFront: (id: string) => void; // Bring dialog to front
}

export const DialogManagerContext = createContext<DialogManagerContextType | undefined>(undefined);

export const useDialogManager = () => {
  const context = useContext(DialogManagerContext);
  if (!context) {
    throw new Error('useDialogManager must be used within DialogManagerProvider');
  }
  return context;
};

export const DialogManagerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialogs, setDialogs] = useState<DialogItem[]>([]);
  const dialogIdCounter = useRef(0);
  const zIndexCounter = useRef(1000); // Start z-index at 1000

  // Load dialogs from sessionStorage on mount
  useEffect(() => {
    try {
      const savedDialogs = sessionStorage.getItem('dialog-manager-dialogs');
      if (savedDialogs) {
        const parsed = JSON.parse(savedDialogs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter out dialogs with invalid data structure
          const validDialogs = parsed.filter((d: DialogItem) => {
            if (!d.data) {
              console.warn(`Removing dialog ${d.id} with missing data`);
              return false;
            }
            if (d.type === 'file_preview' && (!d.data.item || !d.data.user_id)) {
              console.warn(`Removing invalid file_preview dialog ${d.id}`);
              return false;
            }
            if (d.type === 'item_details' && (!d.data.itemType || !d.data.data)) {
              console.warn(`Removing invalid item_details dialog ${d.id}`);
              return false;
            }
            return true;
          });
          
          if (validDialogs.length > 0) {
            setDialogs(validDialogs);
            // Restore counter to avoid ID conflicts
            const maxId = Math.max(...validDialogs.map((d: DialogItem) => {
              const match = d.id.match(/dialog-(\d+)/);
              return match ? parseInt(match[1], 10) : 0;
            }), 0);
            dialogIdCounter.current = maxId;
          } else {
            // Clear invalid dialogs from storage
            sessionStorage.removeItem('dialog-manager-dialogs');
            setDialogs([]);
          }
        } else {
          // No dialogs in storage, ensure state is empty
          setDialogs([]);
        }
      } else {
        // No dialogs in storage, ensure state is empty
        setDialogs([]);
      }
    } catch (e) {
      console.warn('Failed to load dialogs from sessionStorage:', e);
      // Clear corrupted data
      try {
        sessionStorage.removeItem('dialog-manager-dialogs');
      } catch {
        // Ignore
      }
      setDialogs([]);
    }
  }, []);

  // Listen for logout events to clear dialogs
  useEffect(() => {
    const handleLogout = () => {
      setDialogs([]);
      dialogIdCounter.current = 0;
    };

    window.addEventListener('user-logout', handleLogout);
    return () => {
      window.removeEventListener('user-logout', handleLogout);
    };
  }, []);

  // Save dialogs to sessionStorage whenever they change - debounced and non-blocking
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs; // Keep ref in sync

  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Don't save if dialogs array is empty (might be after logout)
    if (dialogs.length === 0) {
      try {
        sessionStorage.removeItem('dialog-manager-dialogs');
      } catch (e) {
        // Ignore
      }
      return;
    }

    // Debounce the save operation and make it non-blocking
    saveTimeoutRef.current = setTimeout(() => {
      // Use requestIdleCallback if available, otherwise setTimeout
      const saveToStorage = () => {
        try {
          // Only save essential data, not cached content (that's saved separately)
          const dialogsToSave = dialogsRef.current.map(d => ({
            ...d,
            cachedContent: undefined, // Don't save cached content here, it's saved separately
          }));
          sessionStorage.setItem('dialog-manager-dialogs', JSON.stringify(dialogsToSave));
        } catch (e) {
          console.warn('Failed to save dialogs to sessionStorage:', e);
        }
      };

      if ('requestIdleCallback' in window) {
        requestIdleCallback(saveToStorage, { timeout: 1000 });
      } else {
        setTimeout(saveToStorage, 0);
      }
    }, 300); // Debounce by 300ms

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [dialogs]);

  // Helper function to generate a unique key for a dialog to detect duplicates
  const getDialogKey = useCallback((dialog: Omit<DialogItem, 'id' | 'isMinimized'>): string | null => {
    if (dialog.type === 'file_preview' && dialog.data?.item?.id) {
      return `file_preview_${dialog.data.item.id}`;
    } else if (dialog.type === 'item_details' && dialog.data?.itemType && dialog.data?.data) {
      const itemData = dialog.data.data;
      // Try to find a unique identifier based on item type
      const uniqueId = 
        itemData.award_id || // Govt contracts
        itemData.filing_uuid || // LDA disclosures
        itemData.id || // Generic ID
        itemData.trade_id || // Politician trades
        itemData.bill_id || // Congress bills
        itemData.symbol || // Stock results
        itemData.accession || // SEC filings - accession number is unique per filing
        itemData.adsh || // SEC filings - alternative unique identifier
        itemData.cik || // SEC filings - fallback (not unique per filing, but better than nothing)
        itemData.article_id || // News articles
        null;
      
      if (uniqueId) {
        return `item_details_${dialog.data.itemType}_${uniqueId}`;
      }
    }
    return null;
  }, []);

  const openDialog = useCallback((dialog: Omit<DialogItem, 'id' | 'isMinimized'>): string => {
    // Check if a duplicate dialog already exists
    const dialogKey = getDialogKey(dialog);
    if (dialogKey) {
      const existingDialog = dialogs.find(d => {
        const existingKey = getDialogKey(d);
        return existingKey === dialogKey;
      });

      if (existingDialog) {
        // If dialog is minimized, restore it
        if (existingDialog.isMinimized) {
          setDialogs(prev => prev.map(d => 
            d.id === existingDialog.id ? { ...d, isMinimized: false } : d
          ));
        }
        // Return existing dialog ID instead of creating a new one
        return existingDialog.id;
      }
    }

    // No duplicate found, create new dialog
    dialogIdCounter.current += 1;
    zIndexCounter.current += 1; // Increment z-index for new dialog
    const id = `dialog-${dialogIdCounter.current}`;
    
    const newDialog: DialogItem = {
      ...dialog,
      id,
      isMinimized: false,
      position: dialog.position || { x: 100 + (dialogs.length * 30), y: 100 + (dialogs.length * 30) },
      size: dialog.size || { width: 900, height: 600 },
      zIndex: zIndexCounter.current,
    };

    setDialogs(prev => [...prev, newDialog]);
    return id;
  }, [dialogs, getDialogKey]);

  const closeDialog = useCallback((id: string) => {
    setDialogs(prev => prev.filter(d => d.id !== id));
    // Clear cached content from sessionStorage
    try {
      sessionStorage.removeItem(`dialog-cache-${id}`);
    } catch (e) {
      // Ignore
    }
  }, []);

  const minimizeDialog = useCallback((id: string) => {
    setDialogs(prev => prev.map(d => 
      d.id === id ? { ...d, isMinimized: true } : d
    ));
  }, []);

  const restoreDialog = useCallback((id: string) => {
    zIndexCounter.current += 1; // Bring to front when restoring
    setDialogs(prev => prev.map(d => 
      d.id === id ? { ...d, isMinimized: false, zIndex: zIndexCounter.current } : d
    ));
  }, []);

  const bringToFront = useCallback((id: string) => {
    // Use functional update to avoid dependency on dialogs array
    setDialogs(prev => {
      const dialog = prev.find(d => d.id === id);
      if (!dialog) {
        return prev; // Dialog not found
      }
      
      // Optimized check: only update if z-index is actually lower than current max
      // Use a more efficient check - find max in single pass
      let currentMaxZ = zIndexCounter.current;
      let needsUpdate = false;
      
      for (const d of prev) {
        const z = d.zIndex || 1000;
        if (z > currentMaxZ) {
          currentMaxZ = z;
        }
        if (d.id === id && z < currentMaxZ) {
          needsUpdate = true;
        }
      }
      
      // If dialog is already at or above the current max, no update needed
      if (!needsUpdate && dialog.zIndex && dialog.zIndex >= currentMaxZ) {
        return prev; // Already at front, no change needed
      }
      
      zIndexCounter.current = currentMaxZ + 1; // Increment z-index counter
      return prev.map(d => 
        d.id === id ? { ...d, zIndex: zIndexCounter.current } : d
      );
    });
  }, []);

  const updateDialog = useCallback((id: string, updates: Partial<DialogItem>) => {
    setDialogs(prev => prev.map(d => 
      d.id === id ? { ...d, ...updates } : d
    ));
  }, []);

  const getDialog = useCallback((id: string) => {
    return dialogs.find(d => d.id === id);
  }, [dialogs]);

  const clearAllDialogs = useCallback(() => {
    // Clear all dialogs from state
    setDialogs([]);
    dialogIdCounter.current = 0;
    
    // Clear all dialog-related data from sessionStorage
    try {
      // Clear dialog list
      sessionStorage.removeItem('dialog-manager-dialogs');
      
      // Clear all cached dialog content - iterate through all sessionStorage keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith('dialog-cache-') || key.startsWith('dialog-data-'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => {
        try {
          sessionStorage.removeItem(key);
        } catch (e) {
          // Ignore individual removal errors
        }
      });
    } catch (e) {
      console.warn('Failed to clear dialogs from sessionStorage:', e);
    }
  }, []);

  return (
    <DialogManagerContext.Provider
      value={{
        dialogs,
        openDialog,
        closeDialog,
        minimizeDialog,
        restoreDialog,
        updateDialog,
        getDialog,
        clearAllDialogs,
        bringToFront,
      }}
    >
      {children}
    </DialogManagerContext.Provider>
  );
};

