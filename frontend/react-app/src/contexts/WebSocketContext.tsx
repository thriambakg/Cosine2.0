import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

interface WebSocketContextType {
  websocket: WebSocket | null;
  isConnected: boolean;
  connect: (sessionId: string) => void;
  disconnect: () => void;
  sendMessage: (message: any) => boolean;
  activeSessionId: string | null;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const { user } = useAuth();
  const websocketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const disconnect = useCallback(() => {
    if (websocketRef.current) {
      console.log('🔌 Disconnecting WebSocket');
      websocketRef.current.close();
      websocketRef.current = null;
      setIsConnected(false);
      setActiveSessionId(null);
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback((sessionId: string) => {
    if (!user?.id) {
      console.warn('⚠️ Cannot connect WebSocket - no user ID');
      return;
    }

    // Prevent multiple connections
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.CONNECTING) {
      console.log('🔄 WebSocket connection already in progress, skipping');
      return;
    }

    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN && activeSessionId === sessionId) {
      console.log('✅ WebSocket already connected to session, skipping');
      return;
    }

    // Store session ID in sessionStorage for persistence
    sessionStorage.setItem('global-chat-active-session', sessionId);

    try {
      console.log(`🔌 Connecting WebSocket for session ${sessionId}`);

      // Close existing connection if any
      if (websocketRef.current) {
        websocketRef.current.close();
        websocketRef.current = null;
      }

      const wsUrl = `wss://xem3y35uzd.execute-api.us-east-1.amazonaws.com/production?userId=${user.id}&sessionId=${sessionId}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        setIsConnected(true);
        setActiveSessionId(sessionId);
        reconnectAttemptsRef.current = 0;

        // Send connection establishment message
        ws.send(JSON.stringify({
          action: 'chat',
          type: 'connection_establish',
          userId: user.id,
          sessionId: sessionId,
        }));
      };

      ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected', event.code, event.reason);
        setIsConnected(false);
        websocketRef.current = null;

        // Don't auto-reconnect if:
        // 1. Normal closure (code 1000)
        // 2. Going away (code 1001) - likely intentional disconnect
        // 3. Max reconnect attempts reached
        if (event.code === 1000 || event.code === 1001) {
          console.log('🔌 WebSocket closed normally or going away, not reconnecting');
          return;
        }
        
        if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.log('🔌 Max reconnect attempts reached, giving up');
          return;
        }

        // Auto-reconnect for unexpected closures
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          // Use the latest session ID from sessionStorage instead of closure variable
          const latestSessionId = sessionStorage.getItem('global-chat-active-session');
          const reconnectSessionId = latestSessionId || sessionId;
          console.log(`🔄 Reconnecting to session: ${reconnectSessionId} (latest from storage: ${latestSessionId}, closure: ${sessionId})`);
          connect(reconnectSessionId);
        }, delay);
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        // Dispatch custom event so other components can listen
        const messageEvent = new CustomEvent('websocket-message', {
          detail: JSON.parse(event.data)
        });
        window.dispatchEvent(messageEvent);
      };

      websocketRef.current = ws;
    } catch (error) {
      console.error('❌ Failed to create WebSocket:', error);
    }
  }, [user?.id, activeSessionId]);

  const sendMessage = useCallback((message: any): boolean => {
    if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ Cannot send message - WebSocket not connected');
      return false;
    }

    try {
      websocketRef.current.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      return false;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const value: WebSocketContextType = {
    websocket: websocketRef.current,
    isConnected,
    connect,
    disconnect,
    sendMessage,
    activeSessionId,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

