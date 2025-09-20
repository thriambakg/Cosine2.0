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
  truncateMessagesAfter: (messageId: string, newText?: string) => void;
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
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export const useChatPersistence = (userId: string): UseChatPersistenceReturn => {
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSave, setAutoSave] = useState(true);
  const [sessionTTLDays, setSessionTTLDays] = useState(30);
  const [pendingMessageCounts, setPendingMessageCounts] = useState<Record<string, number>>({});
  
  const pendingMessagesRef = useRef<Record<string, ChatMessage[]>>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);

  // Load cached data on mount
  useEffect(() => {
    if (userId) {
      loadCachedData();
      loadSessionsFromBackend();
    }
  }, [userId]);

  // Auto-save messages when they change (session-specific)
  useEffect(() => {
    const sessionId = currentSession?.session_id;
    const pendingCount = sessionId ? (pendingMessageCounts[sessionId] || 0) : 0;
    
    if (autoSave && pendingCount > 0) {
      debouncedSave();
    }
  }, [currentSession?.session_id, pendingMessageCounts, autoSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      // Save any pending messages before unmounting
      const hasPendingMessages = Object.values(pendingMessagesRef.current).some(messages => messages.length > 0);
      if (hasPendingMessages) {
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
            const session = cachedSessions.find((s: ChatSession) => s.session_id === currentSessionId);
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
        messages: (session.messages || []).map((msg: any) => ({
          ...msg,
          timestamp: new Date((msg.timestamp || Date.now()) * 1000) // Convert seconds to milliseconds
        }))
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
        title: title || new Date().toLocaleString(),
        model: model || 'claude-3-sonnet',
        create_welcome_message: false
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
      const errorObj = error as any;
      if (errorObj.code === 'ERR_NETWORK' || errorObj.message?.includes('Network Error')) {
        console.log('📋 Backend unavailable, creating local session...');
        const localSessionId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const sessionTitle = title || new Date().toLocaleString();
        const localSession: ChatSession = {
          session_id: localSessionId,
          title: sessionTitle,
          model: model || 'claude-3-sonnet',
          created_at: now,
          last_updated: now,
          message_count: 0,
          messages: []
        };
        
        setSessions(prev => [localSession, ...prev]);
        setCurrentSession(localSession);
        saveCachedData();
        
        console.log('📋 Created local session:', {
          sessionId: localSessionId,
          title: sessionTitle,
          created_at: now,
          last_updated: now,
          dateString: new Date(now).toLocaleString()
        });
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
      
      // First check if we have it cached - always use cache if available to preserve local state
      const cachedSession = sessions.find(s => s.session_id === sessionId);
      if (cachedSession) {
        console.log('📋 Using cached session (preserving local state):', {
          sessionId,
          messageCount: cachedSession.messages.length,
          messages: cachedSession.messages.map(m => ({ id: m.id, sender: m.sender, text: m.text.substring(0, 30) + '...' })),
          lastUpdated: new Date(cachedSession.last_updated).toLocaleTimeString()
        });
        setCurrentSession(cachedSession);
        setIsLoading(false);
        
        // Only load from backend in the background if the session is old enough
        const sessionAge = Date.now() - cachedSession.last_updated;
        if (sessionAge > 30000) { // 30 seconds
          console.log('📋 Session is old, will sync with backend in background');
          // Load from backend in background without changing current session
          setTimeout(async () => {
            try {
              const response = await api.sessions.getSession(sessionId, userId);
              const backendSession: ChatSession = {
                session_id: response.session_id,
                title: response.title,
                model: response.model,
                created_at: response.created_at,
                last_updated: response.last_updated,
                message_count: response.message_count,
                messages: (response.messages || []).map((msg: any) => ({
                  ...msg,
                  timestamp: new Date((msg.timestamp || Date.now()) * 1000)
                }))
              };
              
              // Only update sessions list if backend has more messages than local cache
              setSessions(prev => prev.map(s => {
                if (s.session_id === sessionId) {
                  // Use currentSession message count if it's the same session, otherwise use sessions list
                  const localMessageCount = (currentSession?.session_id === sessionId) 
                    ? currentSession.messages.length 
                    : s.messages.length;
                  const backendMessageCount = backendSession.messages.length;
                  
                  console.log('📋 Background sync comparison:', {
                    sessionId,
                    localMessages: localMessageCount,
                    backendMessages: backendMessageCount,
                    usingCurrentSession: currentSession?.session_id === sessionId
                  });
                  
                  // Only use backend data if it has more messages (meaning new messages were saved)
                  if (backendMessageCount > localMessageCount) {
                    console.log('📋 Using backend data (has more messages)');
                    
                    // Also update currentSession if it's the same session
                    if (currentSession?.session_id === sessionId) {
                      console.log('📋 Updating current session with backend data');
                      setCurrentSession(backendSession);
                    }
                    
                    return backendSession;
                  } else {
                    console.log('📋 Keeping local cache (backend has same or fewer messages)');
                    return s;
                  }
                }
                return s;
              }));
              
              console.log('📋 Background sync completed for session:', sessionId);
            } catch (error) {
              console.log('📋 Background sync failed (this is ok):', error);
            }
          }, 1000);
        }
        
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
        messages: (response.messages || []).map((msg: any) => ({
          ...msg,
          timestamp: new Date((msg.timestamp || Date.now()) * 1000) // Convert seconds to milliseconds
        }))
      };
      
      console.log('📋 Loaded session from backend:', {
        sessionId,
        messageCount: loadedSession.messages.length,
        messages: loadedSession.messages.map(m => ({ id: m.id, sender: m.sender, text: m.text.substring(0, 30) + '...' }))
      });
      
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
      console.log('🔴 DELETE: Starting session deletion:', sessionId);
      
      // Clear current session immediately to stop any ongoing UI updates
      if (currentSession?.session_id === sessionId) {
        console.log('🔴 DELETE: Clearing current session immediately');
        setCurrentSession(null);
      }
      
      // Clear any pending messages for this session (session-specific)
      if (pendingMessagesRef.current[sessionId]) {
        delete pendingMessagesRef.current[sessionId];
        setPendingMessageCounts(prev => {
          const updated = { ...prev };
          delete updated[sessionId];
          return updated;
        });
        console.log('🔴 DELETE: Cleared pending messages for session:', sessionId);
      }
      
      // Check if this is a local session (starts with 'local_')
      if (sessionId.startsWith('local_')) {
        // For local sessions, just remove from local cache
        console.log('🔴 DELETE: Deleting local session from cache only');
      } else {
        // For backend sessions, make API call
        console.log('🔴 DELETE: Calling backend to delete session');
        await api.sessions.deleteSession(sessionId, userId);
        console.log('🔴 DELETE: Backend deletion successful');
      }
      
      // Remove from local state regardless of session type
      setSessions(prev => {
        const filtered = prev.filter(s => s.session_id !== sessionId);
        console.log(`🔴 DELETE: Removed session from local state. Remaining: ${filtered.length}`);
        return filtered;
      });
      
      // Force clear all cached data for this session
      const cacheKey = `chat_sessions_${userId}`;
      const cachedSessions = JSON.parse(localStorage.getItem(cacheKey) || '[]');
      const filteredCached = cachedSessions.filter((s: any) => s.session_id !== sessionId);
      localStorage.setItem(cacheKey, JSON.stringify(filteredCached));
      console.log('🔴 DELETE: Cleared session from localStorage cache');
      
      // Clear any pending messages cache
      const pendingKey = `pending_messages_${sessionId}`;
      localStorage.removeItem(pendingKey);
      console.log('🔴 DELETE: Cleared pending messages cache');
      
      // Save updated cached data
      saveCachedData();
      console.log('✅ DELETE: Session deletion completed successfully');
    } catch (error) {
      console.error('❌ DELETE: Error deleting session:', error);
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
    console.log('📋 Adding message to persistence:', {
      messageId: message.id,
      sender: message.sender,
      text: message.text.substring(0, 50) + '...',
      currentSessionId: currentSession?.session_id,
      currentMessageCount: currentSession?.messages?.length || 0
    });
    
    // Add to current session
    setCurrentSession(prev => {
      if (!prev) {
        console.log('📋 No current session to add message to');
        return prev;
      }
      const updatedSession = {
        ...prev,
        messages: [...prev.messages, message],
        message_count: prev.message_count + 1,
        last_updated: Date.now()
      };
      console.log('📋 Updated current session:', {
        sessionId: updatedSession.session_id,
        newMessageCount: updatedSession.message_count,
        totalMessages: updatedSession.messages.length
      });
      return updatedSession;
    });
    
    // Add to pending messages for backend save (session-specific)
    const sessionId = currentSession?.session_id;
    if (sessionId) {
      if (!pendingMessagesRef.current[sessionId]) {
        pendingMessagesRef.current[sessionId] = [];
      }
      pendingMessagesRef.current[sessionId].push(message);
      console.log('📋 Pending messages count for session', sessionId + ':', pendingMessagesRef.current[sessionId].length);
      
      // Update reactive state for useEffect dependency
      setPendingMessageCounts(prev => ({
        ...prev,
        [sessionId]: pendingMessagesRef.current[sessionId].length
      }));
    }
    
    // Update sessions list - only if we have a current session
    if (currentSession?.session_id) {
      setSessions(prev => {
        const updated = prev.map(s => 
          s.session_id === currentSession.session_id 
            ? { ...s, messages: [...s.messages, message], message_count: s.message_count + 1 }
            : s
        );
        
        console.log('📋 Updated sessions list:', {
          sessionId: currentSession.session_id,
          totalSessions: updated.length,
          targetSession: updated.find(s => s.session_id === currentSession.session_id)?.messages.length || 0
        });
        
        return updated;
      });
    } else {
      console.log('📋 Skipping sessions list update - no current session ID');
    }
    
    saveCachedData();
  }, [currentSession, saveCachedData]);

  // Update sessions list when currentSession changes and we have pending messages
  useEffect(() => {
    const sessionId = currentSession?.session_id;
    if (sessionId && pendingMessagesRef.current[sessionId]?.length > 0) {
      console.log('📋 Current session set, updating sessions list with pending messages:', {
        sessionId: sessionId,
        pendingMessages: pendingMessagesRef.current[sessionId].length
      });
      
      setSessions(prev => {
        const updated = prev.map(s => {
          if (s.session_id === sessionId) {
            // Add all pending messages that aren't already in the session
            const existingMessageIds = new Set(s.messages.map(m => m.id));
            const newMessages = pendingMessagesRef.current[sessionId].filter(m => !existingMessageIds.has(m.id));
            
            if (newMessages.length > 0) {
              console.log('📋 Adding pending messages to session:', {
                sessionId: s.session_id,
                newMessages: newMessages.length,
                totalMessages: s.messages.length + newMessages.length
              });
              
              // Clear pending messages after adding them to the session
              pendingMessagesRef.current[sessionId] = [];
              setPendingMessageCounts(prev => ({
                ...prev,
                [sessionId]: 0
              }));
              
              return {
                ...s,
                messages: [...s.messages, ...newMessages],
                message_count: s.message_count + newMessages.length,
                last_updated: Date.now()
              };
            }
          }
          return s;
        });
        
        return updated;
      });
    }
  }, [currentSession?.session_id]);

  // Also update sessions list when currentSession messages change (for immediate updates)
  useEffect(() => {
    const sessionId = currentSession?.session_id;
    if (sessionId && currentSession?.messages) {
      setSessions(prev => {
        const updated = prev.map(s => {
          if (s.session_id === sessionId) {
            // Update the session in the list to match currentSession
            if (s.messages.length !== currentSession.messages.length) {
              console.log('📋 Syncing current session to sessions list:', {
                sessionId,
                sessionsListMessages: s.messages.length,
                currentSessionMessages: currentSession.messages.length
              });
              return {
                ...s,
                messages: currentSession.messages,
                message_count: currentSession.message_count,
                last_updated: currentSession.last_updated
              };
            }
          }
          return s;
        });
        
        return updated;
      });
    }
  }, [currentSession?.messages, currentSession?.session_id]);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      saveMessagesToBackend();
    }, 2000); // Save after 2 seconds of inactivity
  }, []);

  const saveMessagesToBackend = useCallback(async (): Promise<void> => {
    if (!userId || !currentSession) {
      return;
    }
    
    const sessionId = currentSession.session_id;
    const pendingMessages = pendingMessagesRef.current[sessionId];
    
    if (!pendingMessages || pendingMessages.length === 0) {
      return;
    }
    
    // Prevent multiple simultaneous save operations
    if (isSavingRef.current) {
      console.log('📋 Save already in progress, skipping duplicate call');
      return;
    }
    
    isSavingRef.current = true;
    
    try {
      console.log('📋 Saving messages to backend for session', sessionId + ':', pendingMessages.length);
      
      const messagesToSave = pendingMessages.map(msg => ({
        content: msg.text,
        sender: msg.sender,
        message_type: 'text',
        metadata: { timestamp: msg.timestamp.getTime() }
      }));
      
      await api.sessions.updateSession(sessionId, userId, {
        messages: messagesToSave
      });
      
      // Clear pending messages and reset flags (session-specific)
      pendingMessagesRef.current[sessionId] = [];
      setPendingMessageCounts(prev => ({
        ...prev,
        [sessionId]: 0
      }));
      lastSaveTimeRef.current = Date.now();
      
      // Clear any pending retry timeouts since we succeeded
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      
      console.log('📋 Successfully saved messages to backend');
    } catch (error: any) {
      console.error('📋 Error saving messages to backend:', error);
      
      // Handle 404 errors (session not found) gracefully
      if (error?.response?.status === 404) {
        console.log('📋 Session not found in backend yet, will retry later');
        // Don't set error state for 404s - this is expected during session creation
        
        // Only schedule retry if one isn't already scheduled
        if (!retryTimeoutRef.current) {
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            const hasPendingMessages = Object.values(pendingMessagesRef.current).some(messages => messages.length > 0);
            if (hasPendingMessages && !isSavingRef.current) {
              console.log('📋 Retrying to save messages after session creation delay');
              saveMessagesToBackend();
            }
          }, 5000); // Retry after 5 seconds
        }
        
        return;
      }
      
      // For other errors, set error state
      setError('Failed to save messages');
    } finally {
      isSavingRef.current = false;
    }
  }, [userId, currentSession]);

  const clearLocalCache = useCallback(() => {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_EXPIRY_KEY);
    setSessions([]);
    setCurrentSession(null);
    pendingMessagesRef.current = {};
    console.log('📋 Cleared local chat cache');
  }, []);

  const truncateMessagesAfter = useCallback((messageId: string, newText?: string) => {
    if (!currentSession) return;
    
    // Find the message to truncate after
    const messageIndex = currentSession.messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) return;
    
    // Create truncated messages array
    const truncatedMessages = currentSession.messages.slice(0, messageIndex + 1);
    
    // Update the message text if provided
    if (newText !== undefined) {
      truncatedMessages[messageIndex] = {
        ...truncatedMessages[messageIndex],
        text: newText
      };
    }
    
    // Update current session with truncated messages
    const updatedSession = {
      ...currentSession,
      messages: truncatedMessages,
      message_count: truncatedMessages.length,
      last_updated: Date.now()
    };
    
    setCurrentSession(updatedSession);
    
    // Update sessions array
    setSessions(prev => prev.map(session => 
      session.session_id === currentSession.session_id ? updatedSession : session
    ));
    
    // Clear pending messages since we're truncating
    pendingMessagesRef.current = {};
    
    console.log(`📋 Truncated messages after ${messageId}: ${truncatedMessages.length} messages remaining`);
  }, [currentSession]);

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
    truncateMessagesAfter,
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
