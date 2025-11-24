/**
 * SEC Search WebSocket Service
 * Handles WebSocket connections for SEC search with real-time progress streaming
 */

import { ENV_CONFIG } from '../config/environment';

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
  // Note: connectionId is not currently used but kept for future use
  private _connectionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;
  private messageHandlers: Map<string, Set<(message: SECSearchWebSocketMessage) => void>> = new Map();
  private isConnecting = false;

  /**
   * Get WebSocket URL for SEC search
   * The SEC search WebSocket API is a separate API Gateway with its own endpoint
   * This should be configured via environment variable or runtime config
   */
  private getWebSocketUrl(): string {
    // Priority 1: Check ENV_CONFIG (from environment.ts) - this reads from env vars and runtime config
    if (ENV_CONFIG.secSearchWebSocketUrl) {
      console.log('🔌 Using SEC Search WebSocket URL from ENV_CONFIG:', ENV_CONFIG.secSearchWebSocketUrl);
      return ENV_CONFIG.secSearchWebSocketUrl;
    }
    
    // Priority 2: Check runtime config (from config.js)
    if (typeof window !== 'undefined' && window.COSINE_CONFIG?.secSearchWebSocketUrl) {
      const runtimeUrl = window.COSINE_CONFIG.secSearchWebSocketUrl;
      if (runtimeUrl && !runtimeUrl.includes('{{') && !runtimeUrl.includes('your-')) {
        console.log('🔌 Using SEC Search WebSocket URL from runtime config:', runtimeUrl);
        return runtimeUrl;
      }
    }
    
    // Priority 3: Check explicit environment variables (direct access)
    const explicitUrl = process.env.NEXT_PUBLIC_SEC_SEARCH_WEBSOCKET_URL || process.env.VITE_SEC_SEARCH_WEBSOCKET_URL;
    if (explicitUrl && !explicitUrl.includes('{{') && !explicitUrl.includes('your-')) {
      console.log('🔌 Using SEC Search WebSocket URL from environment variable:', explicitUrl);
      return explicitUrl;
    }
    
    // Error: URL not configured
    const apiUrl = ENV_CONFIG.apiGatewayUrl;
    const urlMatch = apiUrl.match(/https:\/\/([^.]+)\.execute-api\.([^.]+)\.amazonaws\.com\/(.+)/);
    const region = urlMatch ? urlMatch[2] : 'us-east-1';
    const stage = urlMatch ? urlMatch[3] : 'production';
    
    console.error('❌ SEC Search WebSocket URL not configured.');
    console.error('   Please set one of the following:');
    console.error('   1. NEXT_PUBLIC_SEC_SEARCH_WEBSOCKET_URL environment variable');
    console.error('   2. secSearchWebSocketUrl in window.COSINE_CONFIG (runtime config)');
    console.error('   3. Add to Terraform build_environment_variables output');
    console.error(`   Expected format: wss://<API-ID>.execute-api.${region}.amazonaws.com/${stage}`);
    console.error('   Get the API ID from: terraform output sec_search_websocket_api');
    
    throw new Error('SEC Search WebSocket URL not configured. Please set NEXT_PUBLIC_SEC_SEARCH_WEBSOCKET_URL or add secSearchWebSocketUrl to runtime config.');
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
          this._connectionId = null;

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
      this._connectionId = null;
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

