/**
 * React hook for unified messaging system
 * Provides easy integration with the centralized message handler
 */

import { useEffect, useState, useCallback } from 'react';
import { unifiedMessageHandler, UnifiedMessageData, SharedMessage } from '../services/unifiedMessageHandler';

export interface UseUnifiedMessagingOptions {
  sessionId?: string | null;
  userId?: string;
  source: 'chatpage' | 'sidebar';
  onMessageUpdate?: (update: any) => void;
}

export const useUnifiedMessaging = (options: UseUnifiedMessagingOptions) => {
  const { sessionId, userId, source } = options;
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crossInterfaceLoading, setCrossInterfaceLoading] = useState<Record<string, boolean>>({}); // sessionId -> loading state

  // Get messages for current session and subscribe to updates
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    // Clear messages when session changes to prevent cross-session contamination
    setMessages([]);

    // Get initial messages from local cache for this specific session
    const initialMessages = unifiedMessageHandler.getMessagesForSession(sessionId);
    setMessages(initialMessages);

    console.log(`📨 ${source}: Loaded messages for session ${sessionId}:`, initialMessages.length);

    // Subscribe to message updates for this session
    const unsubscribe = unifiedMessageHandler.subscribeToMessages((updatedSessionId, updatedMessages) => {
      // Only update if it's for the current session
      if (updatedSessionId === sessionId) {
        console.log(`📨 ${source}: Received message update for session ${sessionId}:`, updatedMessages.length);
        setMessages([...updatedMessages]);
      }
    });
    
    return unsubscribe;
  }, [sessionId, source]); // Removed onMessageUpdate from dependencies to prevent infinite re-renders

  // Subscribe to cross-interface loading state changes
  useEffect(() => {
    const unsubscribe = unifiedMessageHandler.subscribeToLoadingState((sessionId, isLoading, loadingSource) => {
      // Only update if it's for the current session and from a different interface
      if (sessionId === options.sessionId && loadingSource !== source) {
        console.log(`🔄 ${source}: Received loading state from ${loadingSource} for session ${sessionId}: ${isLoading}`);
        setCrossInterfaceLoading(prev => ({
          ...prev,
          [sessionId]: isLoading
        }));
      }
    });
    
    return unsubscribe;
  }, [options.sessionId, source]);

  // Send new message
  const sendMessage = useCallback(async (messageData: Omit<UnifiedMessageData, 'messageId' | 'userId' | 'source'>) => {
    if (!userId) {
      setError('User ID is required');
      return { success: false, error: 'User ID is required' };
    }

    setIsProcessing(true);
    setError(null);

    try {
      const fullMessageData: UnifiedMessageData = {
        ...messageData,
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        source,
        sessionId: messageData.sessionId || sessionId || undefined
      };

      console.log(`📤 ${source}: Sending message via unified handler:`, fullMessageData.messageId);
      console.log('🔍 DEBUG: sendMessage - fullMessageData being passed to processMessage:', fullMessageData);
      console.log('🔍 DEBUG: sendMessage - contextItems in fullMessageData:', fullMessageData.contextItems);
      console.log('🔍 DEBUG: sendMessage - contextItems length:', fullMessageData.contextItems?.length || 0);
      
      const result = await unifiedMessageHandler.processMessage(fullMessageData);
      
      if (result.success) {
        console.log(`✅ ${source}: Message sent successfully:`, fullMessageData.messageId);
        return { success: true, sessionId: result.sessionId };
      } else {
        console.error(`❌ ${source}: Failed to send message:`, result.error);
        setError(result.error || 'Failed to send message');
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error(`❌ ${source}: Error sending message:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsProcessing(false);
    }
  }, [userId, source, sessionId]);

  // Send new message with context
  const sendContextMessage = useCallback(async (
    text: string, 
    contextItems: any[], 
    model: string = 'claude-3-sonnet',
    overrideSessionId?: string
  ) => {
    console.log('🔍 DEBUG: sendContextMessage called with:', { text, contextItems, model, overrideSessionId });
    console.log('🔍 DEBUG: contextItems length:', contextItems.length);
    console.log('🔍 DEBUG: contextItems content:', contextItems);
    
    const targetSessionId = overrideSessionId || sessionId;
    const messageData: Omit<UnifiedMessageData, 'messageId' | 'userId' | 'source'> = {
      text,
      model,
      type: 'context_message',
      sessionId: targetSessionId || undefined,
      contextItems,
      context: {
        currentPage: window.location.pathname,
        sessionId: targetSessionId || '',
        hasContext: true,
        contextCount: contextItems.length
      }
    };
    
    console.log('🔍 DEBUG: sendContextMessage - messageData being passed to sendMessage:', messageData);
    return sendMessage(messageData);
  }, [sendMessage, sessionId]);

  // Send file message
  const sendFileMessage = useCallback(async (
    text: string,
    files: File[],
    model: string = 'claude-3-sonnet'
  ) => {
    return sendMessage({
      text,
      model,
      type: 'file_message',
      files
    });
  }, [sendMessage]);

  // Send followup message (existing session)
  const sendFollowupMessage = useCallback(async (
    text: string,
    model: string = 'claude-3-sonnet'
  ) => {
    return sendMessage({
      text,
      model,
      type: 'followup_message'
    });
  }, [sendMessage]);

  // Send edit message
  const sendEditMessage = useCallback(async (
    text: string,
    messageId: string,
    model: string = 'claude-3-sonnet'
  ) => {
    return unifiedMessageHandler.processMessage({
      text,
      model,
      type: 'edit_message',
      messageId,
      userId: userId!,
      sessionId: sessionId || '',
      source
    });
  }, [userId, sessionId, source]);

  // Clear session messages
  const clearSession = useCallback(() => {
    if (sessionId) {
      unifiedMessageHandler.clearSessionMessages(sessionId);
      setMessages([]);
    }
  }, [sessionId]);

  // Delete session - this should be handled by useChatPersistence in the component
  // This is kept for API compatibility but components should use their own deleteSession
  const deleteSession = useCallback(async (sessionIdToDelete: string) => {
    console.warn(`⚠️ ${source}: deleteSession called on useUnifiedMessaging. This should be handled by useChatPersistence in the component.`);
    
    if (!userId) {
      setError('User ID is required');
      return { success: false, error: 'User ID is required' };
    }

    setIsProcessing(true);
    setError(null);

    try {
      const result = await unifiedMessageHandler.deleteSession(sessionIdToDelete, userId);
      
      if (result.success) {
        console.log(`✅ ${source}: Session deleted successfully:`, sessionIdToDelete);
        // Clear messages if this was the current session
        if (sessionIdToDelete === sessionId) {
          setMessages([]);
        }
        return { success: true };
      } else {
        console.error(`❌ ${source}: Failed to delete session:`, result.error);
        setError(result.error || 'Failed to delete session');
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error(`❌ ${source}: Error deleting session:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsProcessing(false);
    }
  }, [userId, source, sessionId]);

  // Get active sessions
  const getActiveSessions = useCallback(() => {
    return unifiedMessageHandler.getActiveSessions();
  }, []);

  return {
    messages,
    isProcessing,
    error,
    crossInterfaceLoading,
    sendMessage,
    sendContextMessage,
    sendFileMessage,
    sendFollowupMessage,
    sendEditMessage,
    clearSession,
    deleteSession,
    getActiveSessions
  };
};

export default useUnifiedMessaging;
