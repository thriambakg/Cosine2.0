import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export interface ContextItem {
  id: string;
  type: 'tile' | 'article' | 'chart' | 'congress_bill' | 'custom';
  title: string;
  subtitle?: string;
  data: any;
  timestamp: number;
}

interface ContextWindowContextType {
  contextItems: ContextItem[];
  addContextItem: (item: ContextItem) => void;
  removeContextItem: (id: string) => void;
  clearContext: () => void;
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
}

const ContextWindowContext = createContext<ContextWindowContextType | undefined>(undefined);

interface ContextWindowProviderProps {
  children: ReactNode;
}

export const ContextWindowProvider: React.FC<ContextWindowProviderProps> = ({ children }) => {
  // Load initial context items from sessionStorage
  const [contextItems, setContextItems] = useState<ContextItem[]>(() => {
    const saved = sessionStorage.getItem('context-window-items');
    return saved ? JSON.parse(saved) : [];
  });

  // Load visibility state from localStorage
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem('context-window-visible');
    return saved ? JSON.parse(saved) : false;
  });

  // Save context items to sessionStorage whenever they change
  useEffect(() => {
    sessionStorage.setItem('context-window-items', JSON.stringify(contextItems));
  }, [contextItems]);

  // Save visibility to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('context-window-visible', JSON.stringify(isVisible));
  }, [isVisible]);

  // Listen for external visibility changes (from toolbar)
  useEffect(() => {
    const handleVisibilityChange = (event: CustomEvent) => {
      setIsVisible(event.detail.isVisible);
    };

    window.addEventListener('context-window-visibility-changed', handleVisibilityChange as EventListener);
    return () => {
      window.removeEventListener('context-window-visibility-changed', handleVisibilityChange as EventListener);
    };
  }, []);

  // Listen for items being added from external sources
  useEffect(() => {
    const handleAddContext = (event: CustomEvent) => {
      console.log('🎯 ContextWindowContext received add-to-context event:', event.detail);
      const newItem: ContextItem = event.detail;
      setContextItems((prev) => {
        // Check if item already exists (by id prefix to avoid duplicates)
        const baseId = newItem.id.split('_').slice(0, -1).join('_');
        const exists = prev.some(item => item.id.startsWith(baseId));
        if (exists) {
          console.log('⚠️ Item already in context, skipping:', newItem.id);
          return prev;
        }
        console.log('✅ Adding item to context:', newItem);
        
        // Show the context window when item is added
        setIsVisible(true);
        console.log('🔼 Context window opened automatically');
        
        // Dispatch event to ensure visibility is updated everywhere
        window.dispatchEvent(new CustomEvent('context-window-visibility-changed', {
          detail: { isVisible: true }
        }));
        
        return [...prev, newItem];
      });
    };

    console.log('🎧 ContextWindowContext: Setting up event listener for add-to-context');
    window.addEventListener('add-to-context', handleAddContext as EventListener);
    return () => {
      console.log('🎧 ContextWindowContext: Removing event listener for add-to-context');
      window.removeEventListener('add-to-context', handleAddContext as EventListener);
    };
  }, []);

  const addContextItem = useCallback((item: ContextItem) => {
    setContextItems((prev) => {
      // Check if item already exists
      const baseId = item.id.split('_').slice(0, -1).join('_');
      const exists = prev.some(existingItem => existingItem.id.startsWith(baseId));
      if (exists) {
        console.log('Item already in context, skipping:', item.id);
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  const removeContextItem = useCallback((id: string) => {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearContext = useCallback(() => {
    setContextItems([]);
  }, []);

  const value: ContextWindowContextType = {
    contextItems,
    addContextItem,
    removeContextItem,
    clearContext,
    isVisible,
    setIsVisible,
  };

  return (
    <ContextWindowContext.Provider value={value}>
      {children}
    </ContextWindowContext.Provider>
  );
};

export const useContextWindow = (): ContextWindowContextType => {
  const context = useContext(ContextWindowContext);
  if (context === undefined) {
    throw new Error('useContextWindow must be used within a ContextWindowProvider');
  }
  return context;
};

