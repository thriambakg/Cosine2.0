import React, { createContext, useContext, useState, useCallback } from 'react';
import { ChatSession } from '../hooks/useChatPersistence';

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
}

interface GlobalChatContextType {
  isVisible: boolean;
  setIsVisible: (visible: boolean) => void;
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  openWithSession: (sessionId: string) => void;
  close: () => void;
  toggle: () => void;
  // Add session state management
  currentSession: ChatSession | null;
  setCurrentSession: (session: ChatSession | null) => void;
  messages: Message[];
  setMessages: (messages: Message[]) => void;
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
    try {
      const saved = sessionStorage.getItem('global-chat-visible');
      return saved && saved !== 'null' && saved !== 'undefined' ? JSON.parse(saved) : false;
    } catch (error) {
      console.warn('Failed to parse visibility from sessionStorage:', error);
      return false;
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    // Restore active session from sessionStorage
    const saved = sessionStorage.getItem('global-chat-active-session');
    return saved || null;
  });
  
  // Session state management - persisted like clock and context window
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(() => {
    // Restore current session from sessionStorage
    try {
      const saved = sessionStorage.getItem('global-chat-current-session');
      return saved && saved !== 'null' && saved !== 'undefined' ? JSON.parse(saved) : null;
    } catch (error) {
      console.warn('Failed to parse current session from sessionStorage:', error);
      return null;
    }
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    // Restore messages from sessionStorage
    try {
      const saved = sessionStorage.getItem('global-chat-messages');
      return saved && saved !== 'null' && saved !== 'undefined' ? JSON.parse(saved) : [];
    } catch (error) {
      console.warn('Failed to parse messages from sessionStorage:', error);
      return [];
    }
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

  // Persistent setters for session state
  const setCurrentSessionPersistent = useCallback((session: ChatSession | null) => {
    setCurrentSession(session);
    sessionStorage.setItem('global-chat-current-session', JSON.stringify(session));
  }, []);

  const setMessagesPersistent = useCallback((newMessages: Message[]) => {
    setMessages(newMessages);
    sessionStorage.setItem('global-chat-messages', JSON.stringify(newMessages));
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
    // Add session state management
    currentSession,
    setCurrentSession: setCurrentSessionPersistent,
    messages,
    setMessages: setMessagesPersistent,
  };

  return (
    <GlobalChatContext.Provider value={value}>
      {children}
    </GlobalChatContext.Provider>
  );
};

