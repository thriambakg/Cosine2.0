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
}

interface DialogManagerContextType {
  dialogs: DialogItem[];
  openDialog: (dialog: Omit<DialogItem, 'id' | 'isMinimized'>) => string;
  closeDialog: (id: string) => void;
  minimizeDialog: (id: string) => void;
  restoreDialog: (id: string) => void;
  updateDialog: (id: string, updates: Partial<DialogItem>) => void;
  getDialog: (id: string) => DialogItem | undefined;
}

const DialogManagerContext = createContext<DialogManagerContextType | undefined>(undefined);

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

  // Load dialogs from sessionStorage on mount
  useEffect(() => {
    try {
      const savedDialogs = sessionStorage.getItem('dialog-manager-dialogs');
      if (savedDialogs) {
        const parsed = JSON.parse(savedDialogs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setDialogs(parsed);
          // Restore counter to avoid ID conflicts
          const maxId = Math.max(...parsed.map((d: DialogItem) => {
            const match = d.id.match(/dialog-(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          }), 0);
          dialogIdCounter.current = maxId;
        }
      }
    } catch (e) {
      console.warn('Failed to load dialogs from sessionStorage:', e);
    }
  }, []);

  // Save dialogs to sessionStorage whenever they change
  useEffect(() => {
    try {
      sessionStorage.setItem('dialog-manager-dialogs', JSON.stringify(dialogs));
    } catch (e) {
      console.warn('Failed to save dialogs to sessionStorage:', e);
    }
  }, [dialogs]);

  const openDialog = useCallback((dialog: Omit<DialogItem, 'id' | 'isMinimized'>): string => {
    dialogIdCounter.current += 1;
    const id = `dialog-${dialogIdCounter.current}`;
    
    const newDialog: DialogItem = {
      ...dialog,
      id,
      isMinimized: false,
      position: dialog.position || { x: 100 + (dialogs.length * 30), y: 100 + (dialogs.length * 30) },
      size: dialog.size || { width: 900, height: 600 },
    };

    setDialogs(prev => [...prev, newDialog]);
    return id;
  }, [dialogs.length]);

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
    setDialogs(prev => prev.map(d => 
      d.id === id ? { ...d, isMinimized: false } : d
    ));
  }, []);

  const updateDialog = useCallback((id: string, updates: Partial<DialogItem>) => {
    setDialogs(prev => prev.map(d => 
      d.id === id ? { ...d, ...updates } : d
    ));
  }, []);

  const getDialog = useCallback((id: string) => {
    return dialogs.find(d => d.id === id);
  }, [dialogs]);

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
      }}
    >
      {children}
    </DialogManagerContext.Provider>
  );
};

