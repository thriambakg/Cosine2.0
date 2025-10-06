import React, { createContext, useContext, useState, useCallback } from 'react';

interface GlobalChatContextType {
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  openWithSession: (sessionId: string) => void;
  close: () => void;
  toggle: () => void;
}

const GlobalChatContext = createContext<GlobalChatContextType | undefined>(undefined);

export const useGlobalChat = () => {
  const context = useContext(GlobalChatContext);
  if (!context) {
    throw new Error('useGlobalChat must be used within a GlobalChatProvider');
  }
  return context;
};

interface GlobalChatProviderProps {
  children: React.ReactNode;
}

export const GlobalChatProvider: React.FC<GlobalChatProviderProps> = ({ children }) => {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    // Restore visibility state from sessionStorage
    const saved = sessionStorage.getItem('global-chat-visible');
    return saved ? JSON.parse(saved) : false;
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    // Restore active session from sessionStorage
    const saved = sessionStorage.getItem('global-chat-active-session');
    return saved || null;
  });

  const openWithSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    sessionStorage.setItem('global-chat-active-session', sessionId);
    setIsVisible(true);
    sessionStorage.setItem('global-chat-visible', 'true');
  }, []);

  const close = useCallback(() => {
    setIsVisible(false);
    sessionStorage.setItem('global-chat-visible', 'false');
  }, []);

  const toggle = useCallback(() => {
    setIsVisible(prev => {
      const newValue = !prev;
      sessionStorage.setItem('global-chat-visible', JSON.stringify(newValue));
      return newValue;
    });
  }, []);

  // Custom setIsVisible that persists to sessionStorage
  const setIsVisiblePersistent = useCallback((visible: boolean) => {
    setIsVisible(visible);
    sessionStorage.setItem('global-chat-visible', JSON.stringify(visible));
  }, []);

  const value: GlobalChatContextType = {
    isVisible,
    setIsVisible: setIsVisiblePersistent,
    activeSessionId,
    setActiveSessionId,
    openWithSession,
    close,
    toggle,
  };

  return (
    <GlobalChatContext.Provider value={value}>
      {children}
    </GlobalChatContext.Provider>
  );
};

