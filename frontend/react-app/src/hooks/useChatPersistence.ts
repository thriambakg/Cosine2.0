import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

export interface ChatSession {
  session_id: string;
  title: string;
  model: string;
  created_at: number;
  last_updated: number;
  message_count: number;
  messages: ChatMessage[];
}

interface UseChatPersistenceReturn {
  // Current session state
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  isLoading: boolean;
  error: string | null;
  
  // Session management
  createNewSession: (title?: string, model?: string) => Promise<string>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, newTitle: string) => Promise<void>;
  
  // Message management
  addMessage: (message: ChatMessage) => void;
  saveMessagesToBackend: () => Promise<void>;
  
  // Local cache management
  loadSessionsFromBackend: () => Promise<void>;
  clearLocalCache: () => void;
  
  // Persistence settings
  autoSave: boolean;
  setAutoSave: (enabled: boolean) => void;
  sessionTTLDays: number;
  setSessionTTLDays: (days: number) => void;
}

const CACHE_KEY = 'cosine_chat_sessions';
const CACHE_EXPIRY_KEY = 'cosine_chat_cache_expiry';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const useChatPersistence = (userId: string): UseChatPersistenceReturn => {
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSave, setAutoSave] = useState(true);
  const [sessionTTLDays, setSessionTTLDays] = useState(30);
  
  const pendingMessagesRef = useRef<ChatMessage[]>([]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  // Load cached data on mount
  useEffect(() => {
    if (userId) {
      loadCachedData();
      loadSessionsFromBackend();
    }
  }, [userId]);

  // Auto-save messages when they change
  useEffect(() => {
    if (autoSave && pendingMessagesRef.current.length > 0) {
      debouncedSave();
    }
  }, [pendingMessagesRef.current.length, autoSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Save any pending messages before unmounting
      if (pendingMessagesRef.current.length > 0) {
        saveMessagesToBackend();
      }
    };
  }, []);

  const loadCachedData = useCallback(() => {
    try {
      const cachedData = localStorage.getItem(CACHE_KEY);
      const cacheExpiry = localStorage.getItem(CACHE_EXPIRY_KEY);
      
      if (cachedData && cacheExpiry) {
        const expiryTime = parseInt(cacheExpiry);
        if (Date.now() < expiryTime) {
          const { sessions: cachedSessions, currentSessionId } = JSON.parse(cachedData);
          setSessions(cachedSessions || []);
          
          // Restore current session if it exists
          if (currentSessionId && cachedSessions) {
            const session = cachedSessions.find(s => s.session_id === currentSessionId);
            if (session) {
              setCurrentSession(session);
            }
          }
          console.log('📋 Loaded cached chat data:', { sessionsCount: cachedSessions?.length, currentSessionId });
        } else {
          console.log('📋 Cache expired, clearing local data');
          clearLocalCache();
        }
      }
    } catch (error) {
      console.error('📋 Error loading cached data:', error);
      setError('Failed to load cached chat data');
    }
  }, []);

  const saveCachedData = useCallback(() => {
    try {
      const cacheData = {
        sessions,
        currentSessionId: currentSession?.session_id || null,
        timestamp: Date.now()
      };
      
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      localStorage.setItem(CACHE_EXPIRY_KEY, (Date.now() + CACHE_DURATION).toString());
      console.log('📋 Saved chat data to cache');
    } catch (error) {
      console.error('📋 Error saving cached data:', error);
    }
  }, [sessions, currentSession]);

  const loadSessionsFromBackend = useCallback(async () => {
    if (!userId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('📋 Loading sessions from backend...');
      const response = await api.sessions.getSessions(userId);
      
      // Transform backend sessions to frontend format
      const transformedSessions = response.sessions.map(session => ({
        session_id: session.session_id,
        title: session.title || `Chat ${session.session_id.substring(0, 8)}`,
        model: session.model || 'claude-3-sonnet',
        created_at: session.created_at,
        last_updated: session.last_updated,
        message_count: session.message_count || 0,
        messages: session.messages || []
      }));
      
      setSessions(transformedSessions);
      saveCachedData();
      
      console.log(`📋 Loaded ${transformedSessions.length} sessions from backend`);
    } catch (error) {
      console.error('📋 Error loading sessions:', error);
      setError('Failed to load chat sessions');
    } finally {
      setIsLoading(false);
    }
  }, [userId, saveCachedData]);

  const createNewSession = useCallback(async (title?: string, model?: string): Promise<string> => {
    if (!userId) throw new Error('User ID is required');
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('📋 Creating new session...');
      const response = await api.sessions.createSession(userId, {
        title: title || `New Chat ${new Date().toLocaleDateString()}`,
        model: model || 'claude-3-sonnet',
        create_welcome_message: true
      });
      
      const newSession: ChatSession = {
        session_id: response.session_id,
        title: response.title,
        model: response.model,
        created_at: response.created_at,
        last_updated: response.created_at,
        message_count: response.message_count,
        messages: []
      };
      
      setSessions(prev => [newSession, ...prev]);
      setCurrentSession(newSession);
      saveCachedData();
      
      console.log('📋 Created new session:', response.session_id);
      return response.session_id;
    } catch (error) {
      console.error('📋 Error creating session:', error);
      
      // If backend is unavailable, create a local-only session
      if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
        console.log('📋 Backend unavailable, creating local session...');
        const localSessionId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const localSession: ChatSession = {
          session_id: localSessionId,
          title: title || `New Chat ${new Date().toLocaleDateString()}`,
          model: model || 'claude-3-sonnet',
          created_at: Date.now(),
          last_updated: Date.now(),
          message_count: 1,
          messages: [{
            id: `msg_${Date.now()}`,
            text: "Hello! I'm Cosine, your AI financial analyst. How can I help you today?",
            sender: 'bot',
            timestamp: new Date()
          }]
        };
        
        setSessions(prev => [localSession, ...prev]);
        setCurrentSession(localSession);
        saveCachedData();
        
        console.log('📋 Created local session:', localSessionId);
        return localSessionId;
      }
      
      setError('Failed to create new session');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [userId, saveCachedData]);

  const loadSession = useCallback(async (sessionId: string): Promise<void> => {
    if (!userId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('📋 Loading session:', sessionId);
      
      // First check if we have it cached
      const cachedSession = sessions.find(s => s.session_id === sessionId);
      if (cachedSession && cachedSession.messages.length > 0) {
        setCurrentSession(cachedSession);
        setIsLoading(false);
        return;
      }
      
      // Load from backend
      const response = await api.sessions.getSession(sessionId, userId);
      
      const loadedSession: ChatSession = {
        session_id: response.session_id,
        title: response.title,
        model: response.model,
        created_at: response.created_at,
        last_updated: response.last_updated,
        message_count: response.message_count,
        messages: response.messages || []
      };
      
      setCurrentSession(loadedSession);
      
      // Update sessions list
      setSessions(prev => {
        const updated = prev.map(s => 
          s.session_id === sessionId ? loadedSession : s
        );
        // If session not in list, add it
        if (!prev.find(s => s.session_id === sessionId)) {
          updated.unshift(loadedSession);
        }
        return updated;
      });
      
      saveCachedData();
      console.log('📋 Loaded session with', loadedSession.messages.length, 'messages');
    } catch (error) {
      console.error('📋 Error loading session:', error);
      setError('Failed to load session');
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessions, saveCachedData]);

  const deleteSession = useCallback(async (sessionId: string): Promise<void> => {
    if (!userId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('📋 Deleting session:', sessionId);
      
      // Check if this is a local session (starts with 'local_')
      if (sessionId.startsWith('local_')) {
        // For local sessions, just remove from local cache
        console.log('📋 Deleting local session from cache only');
      } else {
        // For backend sessions, make API call
        await api.sessions.deleteSession(sessionId, userId);
      }
      
      // Remove from local state regardless of session type
      setSessions(prev => prev.filter(s => s.session_id !== sessionId));
      
      // Clear current session if it's the one being deleted
      if (currentSession?.session_id === sessionId) {
        setCurrentSession(null);
      }
      
      saveCachedData();
      console.log('📋 Deleted session:', sessionId);
    } catch (error) {
      console.error('📋 Error deleting session:', error);
      setError('Failed to delete session');
    } finally {
      setIsLoading(false);
    }
  }, [userId, currentSession, saveCachedData]);

  const updateSessionTitle = useCallback(async (sessionId: string, newTitle: string): Promise<void> => {
    if (!userId) return;
    
    try {
      console.log('📋 Updating session title:', { sessionId, newTitle });
      await api.sessions.updateSession(sessionId, userId, { title: newTitle });
      
      setSessions(prev => prev.map(s => 
        s.session_id === sessionId ? { ...s, title: newTitle } : s
      ));
      
      if (currentSession?.session_id === sessionId) {
        setCurrentSession(prev => prev ? { ...prev, title: newTitle } : null);
      }
      
      saveCachedData();
    } catch (error) {
      console.error('📋 Error updating session title:', error);
      setError('Failed to update session title');
    }
  }, [userId, currentSession, saveCachedData]);

  const addMessage = useCallback((message: ChatMessage): void => {
    // Add to current session
    setCurrentSession(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: [...prev.messages, message],
        message_count: prev.message_count + 1,
        last_updated: Date.now()
      };
    });
    
    // Add to pending messages for backend save
    pendingMessagesRef.current.push(message);
    
    // Update sessions list
    setSessions(prev => prev.map(s => 
      s.session_id === currentSession?.session_id 
        ? { ...s, messages: [...s.messages, message], message_count: s.message_count + 1 }
        : s
    ));
    
    saveCachedData();
  }, [currentSession, saveCachedData]);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      saveMessagesToBackend();
    }, 2000); // Save after 2 seconds of inactivity
  }, []);

  const saveMessagesToBackend = useCallback(async (): Promise<void> => {
    if (!userId || !currentSession || pendingMessagesRef.current.length === 0) {
      return;
    }
    
    try {
      console.log('📋 Saving messages to backend:', pendingMessagesRef.current.length);
      
      const messagesToSave = pendingMessagesRef.current.map(msg => ({
        content: msg.text,
        sender: msg.sender,
        message_type: 'text',
        metadata: { timestamp: msg.timestamp.getTime() }
      }));
      
      await api.sessions.updateSession(currentSession.session_id, userId, {
        messages: messagesToSave
      });
      
      // Clear pending messages
      pendingMessagesRef.current = [];
      lastSaveTimeRef.current = Date.now();
      
      console.log('📋 Successfully saved messages to backend');
    } catch (error) {
      console.error('📋 Error saving messages to backend:', error);
      setError('Failed to save messages');
    }
  }, [userId, currentSession]);

  const clearLocalCache = useCallback(() => {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_EXPIRY_KEY);
    setSessions([]);
    setCurrentSession(null);
    pendingMessagesRef.current = [];
    console.log('📋 Cleared local chat cache');
  }, []);

  return {
    // Current session state
    currentSession,
    sessions,
    isLoading,
    error,
    
    // Session management
    createNewSession,
    loadSession,
    deleteSession,
    updateSessionTitle,
    
    // Message management
    addMessage,
    saveMessagesToBackend,
    
    // Local cache management
    loadSessionsFromBackend,
    clearLocalCache,
    
    // Persistence settings
    autoSave,
    setAutoSave,
    sessionTTLDays,
    setSessionTTLDays,
  };
};
