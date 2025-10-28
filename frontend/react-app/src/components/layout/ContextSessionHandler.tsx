import { useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { sessionManagementAPI } from '../../services/api';

/**
 * Global Context Session Handler
 * 
 * This component handles contextualized chat sessions globally, regardless of which page is active.
 * It listens for context session events from the ContextWindow and processes them immediately.
 */
const ContextSessionHandler: React.FC = () => {
  const { user } = useAuth();
  const processingRef = useRef(false);

  useEffect(() => {
    const handleContextSession = async (event: CustomEvent) => {
      const contextData = event.detail;
      const { userId, userMessage, contextItems, timestamp } = contextData;

      console.log('🌐 Global Context Handler: Processing context session:', {
        userId,
        messageLength: userMessage?.length,
        contextItemsCount: contextItems?.length,
        timestamp,
      });

      // Validate user
      if (!user?.id || userId !== user.id) {
        console.log('⚠️ Global Context Handler: User mismatch or no user, skipping');
        return;
      }

      // Prevent duplicate processing
      if (processingRef.current) {
        console.log('⚠️ Global Context Handler: Already processing, skipping');
        return;
      }

      const lastProcessed = sessionStorage.getItem('last-processed-context-session');
      if (lastProcessed && lastProcessed === String(timestamp)) {
        console.log('⚠️ Global Context Handler: Already processed this timestamp, skipping');
        return;
      }

      processingRef.current = true;

      try {
        console.log('🌐 Global Context Handler: Creating new session...');
        
        // Create new session via API
        const response = await sessionManagementAPI.createSession(user.id, {
          title: new Date().toLocaleString(),
          model: 'claude-sonnet-4',
          create_welcome_message: false
        });

        const sessionId = response.session_id;
        console.log('✅ Global Context Handler: Created session:', sessionId);

        // Mark as processed immediately
        sessionStorage.setItem('last-processed-context-session', String(timestamp));
        sessionStorage.removeItem('pending-context-session');

        // Dispatch event to notify GlobalChatSidebar about the new session
        // The sidebar will handle opening, connecting WebSocket, and sending the message
        const sessionReadyEvent = new CustomEvent('context-session-ready', {
          detail: {
            sessionId: sessionId,
            userId: user.id,
            contextItems: contextItems,
            userMessage: userMessage,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(sessionReadyEvent);
        console.log('✅ Global Context Handler: Dispatched session ready event to sidebar');

        processingRef.current = false;
      } catch (error) {
        console.error('❌ Global Context Handler: Error processing context session:', error);
        processingRef.current = false;
      }
    };

    // Listen for context session events from ContextWindow
    window.addEventListener('create-context-session', handleContextSession as any);

    return () => {
      window.removeEventListener('create-context-session', handleContextSession as any);
    };
  }, [user?.id]);

  // This component doesn't render anything - it's just a global event handler
  return null;
};

export default ContextSessionHandler;

