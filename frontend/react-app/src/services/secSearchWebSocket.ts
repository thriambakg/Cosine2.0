/**
 * SEC Search WebSocket Service
 * Handles WebSocket connections for SEC search with real-time progress streaming
 */

import { ENV_CONFIG } from '../config/environment';
import { useAuth } from '../contexts/AuthContext';

export interface SECSearchWebSocketMessage {
  type: 'connected' | 'progress' | 'results' | 'error' | 'cancelled';
  message?: string;
  current_page?: number;
  total_pages?: number | null;
  results_count?: number;
  total_found?: number;
  success?: boolean;
  results?: any[];
  form_filters?: any[];
  entity_filters?: any[];
  location_filters?: any[];
  incorporation_filters?: any[];
  error?: string;
}

export class SECSearchWebSocketService {
  private ws: WebSocket | null = null;
  private connectionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;
  private messageHandlers: Map<string, Set<(message: SECSearchWebSocketMessage) => void>> = new Map();
  private isConnecting = false;

  /**
   * Get WebSocket URL for SEC search
   * TODO: This should be configured in environment config as secSearchWebSocketUrl
   * For now, we construct it from the API Gateway URL pattern
   * The actual SEC search WebSocket API will have a different API Gateway ID
   */
  private getWebSocketUrl(): string {
    // Check for explicit SEC search WebSocket URL in environment
    const explicitUrl = process.env.NEXT_PUBLIC_SEC_SEARCH_WEBSOCKET_URL || process.env.VITE_SEC_SEARCH_WEBSOCKET_URL;
    if (explicitUrl) {
      return explicitUrl;
    }
    
    // For now, construct from API Gateway URL pattern
    // The SEC search WebSocket API is separate and will have its own endpoint
    // This is a temporary solution - should be configured via environment variable
    const apiUrl = ENV_CONFIG.apiGatewayUrl;
    // Extract the base domain pattern and construct WebSocket URL
    // Pattern: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
    // SEC search WebSocket: wss://{sec-search-api-id}.execute-api.{region}.amazonaws.com/{stage}
    // TODO: Get actual SEC search WebSocket API ID from Terraform outputs or environment config
    const wsUrl = apiUrl.replace('https://', 'wss://');
    
    // Note: The actual API ID will be different - this needs to be configured
    // For now, return a placeholder that will need to be updated
    console.warn('⚠️ SEC Search WebSocket URL not configured - using placeholder. Please set NEXT_PUBLIC_SEC_SEARCH_WEBSOCKET_URL');
    return wsUrl; // This will need to be updated with the actual SEC search WebSocket API endpoint
  }

  /**
   * Connect to SEC search WebSocket
   */
  async connect(userId: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🔌 SEC Search WebSocket already connected');
      return;
    }

    if (this.isConnecting) {
      console.log('🔌 SEC Search WebSocket connection in progress...');
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.getWebSocketUrl()}?userId=${encodeURIComponent(userId)}`;
        console.log('🔌 Connecting to SEC Search WebSocket:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('✅ SEC Search WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: SECSearchWebSocketMessage = JSON.parse(event.data);
            console.log('📨 SEC Search WebSocket message received:', message.type, message);
            this.handleMessage(message);
          } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('❌ SEC Search WebSocket error:', error);
          this.isConnecting = false;
          reject(error);
        };

        this.ws.onclose = (event) => {
          console.log('🔌 SEC Search WebSocket closed:', event.code, event.reason);
          this.isConnecting = false;
          this.ws = null;
          this.connectionId = null;

          // Attempt to reconnect if not a normal closure
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => {
              this.connect(userId).catch(console.error);
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      console.log('🔌 Disconnecting SEC Search WebSocket');
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
      this.connectionId = null;
    }
    this.messageHandlers.clear();
  }

  /**
   * Send search request
   */
  sendSearch(params: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ WebSocket not connected');
      return;
    }

    const message = {
      action: 'search',
      params: params
    };

    console.log('📤 Sending search request:', message);
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send cancel request
   */
  sendCancel(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ WebSocket not connected');
      return;
    }

    const message = {
      action: 'cancel'
    };

    console.log('🛑 Sending cancel request');
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Register message handler
   */
  onMessage(type: string, handler: (message: SECSearchWebSocketMessage) => void): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(type);
        }
      }
    };
  }

  /**
   * Handle incoming message and dispatch to handlers
   */
  private handleMessage(message: SECSearchWebSocketMessage): void {
    // Call handlers for specific message type
    const typeHandlers = this.messageHandlers.get(message.type);
    if (typeHandlers) {
      typeHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('❌ Error in message handler:', error);
        }
      });
    }

    // Also call 'all' handlers
    const allHandlers = this.messageHandlers.get('all');
    if (allHandlers) {
      allHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('❌ Error in message handler:', error);
        }
      });
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let secSearchWebSocketInstance: SECSearchWebSocketService | null = null;

export const getSecSearchWebSocket = (): SECSearchWebSocketService => {
  if (!secSearchWebSocketInstance) {
    secSearchWebSocketInstance = new SECSearchWebSocketService();
  }
  return secSearchWebSocketInstance;
};

