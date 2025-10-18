/**
 * Unified Message Handler
 * Central processing hub for all message types from ChatPage and Sidebar
 * Handles session creation, message routing, and local cache management
 */

import { sessionManagementAPI } from './api';

export interface SharedMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  files?: Array<{
    name: string;
    size: number;
    type: string;
  }>;
  file_data?: Array<{
    filename: string;
    file_type: string;
    file_size: number;
    download_url: string;
    created_by?: string;
  }>;
  sessionId: string;
  source: 'chatpage' | 'sidebar' | 'database';
}

export interface UnifiedMessageData {
  // Core message data
  messageId: string;
  text: string;
  userId: string;
  sessionId?: string; // Optional - will create new session if not provided
  model: string;
  
  // Source information
  source: 'chatpage' | 'sidebar';
  
  // Optional data
  files?: any[];
  contextItems?: any[];
  context?: any;
  
  // Message type
  type: 'new_message' | 'context_message' | 'file_message' | 'followup_message' | 'edit_message';
}

export interface SessionCreationResult {
  sessionId: string;
  success: boolean;
  error?: string;
}

class UnifiedMessageHandlerService {
  private static instance: UnifiedMessageHandlerService;
  private processingQueue: Map<string, Promise<void>> = new Map(); // messageId -> processing promise
  private localCache: Map<string, SharedMessage[]> = new Map(); // sessionId -> messages (immediate display)
  private messageListeners: Set<(sessionId: string, messages: SharedMessage[]) => void> = new Set(); // Message update listeners
  private loadingStateListeners: Set<(sessionId: string, isLoading: boolean, source: 'chatpage' | 'sidebar') => void> = new Set(); // Loading state listeners
  private webSocketConnections: Map<string, WebSocket> = new Map(); // sessionId -> WebSocket connection

  private constructor() {
    // Listen for WebSocket responses and update local cache
    this.setupWebSocketListeners();
    console.log('🔧 UnifiedMessageHandler: Singleton instance created');
  }

  static getInstance(): UnifiedMessageHandlerService {
    if (!UnifiedMessageHandlerService.instance) {
      UnifiedMessageHandlerService.instance = new UnifiedMessageHandlerService();
    }
    return UnifiedMessageHandlerService.instance;
  }

  /**
   * Main entry point for processing all message types
   */
  async processMessage(messageData: UnifiedMessageData): Promise<SessionCreationResult> {
    console.log('🎯 UnifiedMessageHandler: Processing message:', messageData.type, 'from:', messageData.source);
    
    // Check if already processing this message
    if (this.processingQueue.has(messageData.messageId)) {
      console.log('⏳ UnifiedMessageHandler: Message already being processed:', messageData.messageId);
      return { sessionId: messageData.sessionId || '', success: false, error: 'Message already being processed' };
    }

    // Add to processing queue to prevent duplicate processing
    const processingPromise = this.handleMessageProcessing(messageData);
    this.processingQueue.set(messageData.messageId, processingPromise as unknown as Promise<void>);

    try {
      const result = await processingPromise;
      return result;
    } finally {
      // Remove from processing queue
      this.processingQueue.delete(messageData.messageId);
    }
  }

  /**
   * Handle the actual message processing based on type
   */
  private async handleMessageProcessing(messageData: UnifiedMessageData): Promise<SessionCreationResult> {
    try {
      // Step 1: Ensure session exists
      const sessionResult = await this.ensureSessionExists(messageData);
      if (!sessionResult.success) {
        return sessionResult;
      }

      const sessionId = sessionResult.sessionId!;

      // Step 2: Add user message to local cache immediately (for instant display)
      this.addUserMessageToLocalCache(sessionId, messageData);

      // Step 3: Broadcast loading state to all interfaces
      this.broadcastLoadingState(sessionId, true, messageData.source);

      // Step 4: Process message based on type
      switch (messageData.type) {
        case 'new_message':
          await this.processNewMessage(sessionId, messageData);
          break;
        
        case 'context_message':
          await this.processContextMessage(sessionId, messageData);
          break;
        
        case 'file_message':
          await this.processFileMessage(sessionId, messageData);
          break;
        
        case 'followup_message':
          await this.processFollowupMessage(sessionId, messageData);
          break;
        
        case 'edit_message':
          await this.processEditMessage(sessionId, messageData);
          break;
      }

      return { sessionId, success: true };
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Error processing message:', error);
      return { 
        sessionId: messageData.sessionId || '', 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Ensure session exists, create if necessary
   */
  private async ensureSessionExists(messageData: UnifiedMessageData): Promise<SessionCreationResult> {
    // If sessionId provided, use it
    if (messageData.sessionId) {
      return { sessionId: messageData.sessionId, success: true };
    }

    // Check if we're already creating a session for this user
    const sessionCreationKey = `creating_${messageData.userId}`;
    if (this.processingQueue.has(sessionCreationKey)) {
      console.log('⏳ UnifiedMessageHandler: Session creation already in progress for user:', messageData.userId);
      // Wait for the existing session creation to complete
      const existingPromise = this.processingQueue.get(sessionCreationKey) as unknown as Promise<SessionCreationResult>;
      if (existingPromise) {
        try {
          const result = await existingPromise;
          return result;
        } catch (error) {
          console.error('❌ UnifiedMessageHandler: Error waiting for session creation:', error);
          // Fall through to create a new session
        }
      }
    }

    // Create new session
    const sessionCreationPromise = this.createNewSession(messageData);
    this.processingQueue.set(sessionCreationKey, sessionCreationPromise as unknown as Promise<void>);

    try {
      const result = await sessionCreationPromise;
      return result;
    } finally {
      this.processingQueue.delete(sessionCreationKey);
    }
  }

  /**
   * Create a new session
   */
  private async createNewSession(messageData: UnifiedMessageData): Promise<SessionCreationResult> {
    try {
      console.log('🆕 UnifiedMessageHandler: Creating new session for user:', messageData.userId);
      
      const response = await sessionManagementAPI.createSession(messageData.userId, {
        title: new Date().toLocaleString(),
        model: messageData.model,
        create_welcome_message: false
      });

      if (response.session_id) {
        console.log('✅ UnifiedMessageHandler: Created session:', response.session_id);
        return { sessionId: response.session_id, success: true };
      } else {
        throw new Error('Failed to create session');
      }
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Failed to create session:', error);
      return { sessionId: '', success: false, error: 'Failed to create session' };
    }
  }

  /**
   * Process new message (no context, no files)
   */
  private async processNewMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    console.log('📝 UnifiedMessageHandler: Processing new message for session:', sessionId);
    
    // Ensure WebSocket connection
    await this.ensureWebSocketConnection(sessionId, messageData.userId);
    
    // Send message via WebSocket
    await this.sendWebSocketMessage(sessionId, messageData);
    console.log('✅ UnifiedMessageHandler: New message sent for session:', sessionId);
  }

  /**
   * Process context message (with context items)
   */
  private async processContextMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    console.log('📋 UnifiedMessageHandler: Processing context message for session:', sessionId);
    
    // Ensure WebSocket connection
    await this.ensureWebSocketConnection(sessionId, messageData.userId);
    
    // Send message via WebSocket
    await this.sendWebSocketMessage(sessionId, messageData);
    console.log('✅ UnifiedMessageHandler: Context message sent for session:', sessionId);
  }

  /**
   * Process file message (with file uploads)
   */
  private async processFileMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    console.log('📁 UnifiedMessageHandler: Processing file message for session:', sessionId);
    
    if (!messageData.files || messageData.files.length === 0) {
      throw new Error('No files provided for file message');
    }

    // Files are already processed by FileUploadService in the component
    // No need to process them again
    
    // Send file message via WebSocket
    await this.sendFileMessage(sessionId, messageData);
    console.log('✅ UnifiedMessageHandler: File message sent for session:', sessionId);
  }

  /**
   * Process followup message (existing session with new context)
   */
  private async processFollowupMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    console.log('🔄 UnifiedMessageHandler: Processing followup message for session:', sessionId);
    
    // Ensure WebSocket connection
    await this.ensureWebSocketConnection(sessionId, messageData.userId);
    
    // Send message via WebSocket
    await this.sendWebSocketMessage(sessionId, messageData);
    console.log('✅ UnifiedMessageHandler: Followup message sent for session:', sessionId);
  }

  /**
   * Process edit message
   */
  private async processEditMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    console.log('✏️ UnifiedMessageHandler: Processing edit message for session:', sessionId);
    
    // Ensure WebSocket connection
    await this.ensureWebSocketConnection(sessionId, messageData.userId);
    
    // Send message via WebSocket
    await this.sendWebSocketMessage(sessionId, messageData);
    console.log('✅ UnifiedMessageHandler: Edit message sent for session:', sessionId);
  }

  /**
   * Ensure WebSocket connection exists for session
   */
  private async ensureWebSocketConnection(sessionId: string, userId: string): Promise<void> {
    console.log('🔌 UnifiedMessageHandler: Establishing WebSocket connection for session:', sessionId);
    
    // Check if we already have a connection for this session
    if (this.hasWebSocketConnection(sessionId)) {
      console.log('✅ UnifiedMessageHandler: WebSocket connection already exists for session:', sessionId);
      return;
    }
    
    try {
      // Create WebSocket connection
      const wsUrl = `${process.env.REACT_APP_WEBSOCKET_URL || 'wss://xem3y35uzd.execute-api.us-east-1.amazonaws.com/production'}?userId=${userId}`;
      console.log('🔌 UnifiedMessageHandler: WebSocket URL:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);
        
        ws.onopen = () => {
          console.log('✅ UnifiedMessageHandler: WebSocket connected for session:', sessionId);
          clearTimeout(timeout);
          
          // Send connection establishment message
          const connectionMessage = {
            type: 'connection_establish',
            userId: userId,
            timestamp: new Date().toISOString()
          };
          
          try {
            ws.send(JSON.stringify(connectionMessage));
            console.log('📤 UnifiedMessageHandler: Sent connection establishment message');
          } catch (error) {
            console.error('❌ UnifiedMessageHandler: Error sending connection message:', error);
          }
          
          // Store the connection
          this.setWebSocketConnection(sessionId, ws);
          resolve();
        };
        
        ws.onerror = (error) => {
          console.error('❌ UnifiedMessageHandler: WebSocket error:', error);
          clearTimeout(timeout);
          reject(error);
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('📨 UnifiedMessageHandler: Received WebSocket message:', data.type, 'for session:', sessionId);
            this.handleWebSocketMessage(sessionId, data);
          } catch (error) {
            console.error('❌ UnifiedMessageHandler: Error parsing WebSocket message:', error);
          }
        };
        
        ws.onclose = (event) => {
          console.log('❌ UnifiedMessageHandler: WebSocket disconnected for session:', sessionId, event.code);
          this.removeWebSocketConnection(sessionId);
        };
      });
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Failed to establish WebSocket connection:', error);
      throw error;
    }
  }

  /**
   * Add user message to local cache for immediate display
   */
  private addUserMessageToLocalCache(sessionId: string, messageData: UnifiedMessageData): void {
    const userMessage: SharedMessage = {
      id: messageData.messageId,
      sender: 'user',
      text: messageData.text,
      timestamp: Date.now(),
      status: 'sending',
      files: messageData.files?.map(file => ({
        name: file.name,
        size: file.size,
        type: file.type
      })),
      sessionId: sessionId,
      source: messageData.source
    };

    // Add to local cache
    if (!this.localCache.has(sessionId)) {
      this.localCache.set(sessionId, []);
    }
    this.localCache.get(sessionId)!.push(userMessage);

    // Notify listeners of message update
    this.notifyMessageUpdate(sessionId, this.localCache.get(sessionId)!);

    // Note: Removed sharedMessageCache integration to prevent double syncing
    // The unified system handles message distribution directly
    
    console.log('📨 UnifiedMessageHandler: Added user message to local cache:', messageData.messageId);
  }

  /**
   * Setup WebSocket listeners for AI responses
   */
  private setupWebSocketListeners(): void {
    // WebSocket listeners are now handled by the unified messaging system
    console.log('🔧 UnifiedMessageHandler: WebSocket listeners managed by unified system');
  }

  /**
   * Check if WebSocket connection exists for session
   */
  private hasWebSocketConnection(sessionId: string): boolean {
    const ws = this.webSocketConnections.get(sessionId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Set WebSocket connection for session
   */
  private setWebSocketConnection(sessionId: string, ws: WebSocket): void {
    this.webSocketConnections.set(sessionId, ws);
  }

  /**
   * Remove WebSocket connection for session
   */
  private removeWebSocketConnection(sessionId: string): void {
    this.webSocketConnections.delete(sessionId);
  }

  /**
   * Send message via WebSocket
   */
  private async sendWebSocketMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    const ws = this.webSocketConnections.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`No WebSocket connection for session: ${sessionId}`);
    }

    const messageRequest = {
      action: 'chat',
      type: 'chat_message',
      message: messageData.text,
      userId: messageData.userId,
      sessionId: sessionId,
      model: messageData.model,
      files: messageData.files || [],
      messageId: messageData.messageId,
      contextItems: messageData.contextItems || [],
      context: messageData.context
    };

    try {
      ws.send(JSON.stringify(messageRequest));
      console.log('📤 UnifiedMessageHandler: Sent message via WebSocket for session:', sessionId);
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Error sending WebSocket message:', error);
      throw error;
    }
  }

  /**
   * Send file message via WebSocket
   */
  private async sendFileMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    const ws = this.webSocketConnections.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`No WebSocket connection for session: ${sessionId}`);
    }

    // For file messages, we need to send the files to the file handler endpoint first
    if (messageData.files && messageData.files.length > 0) {
      try {
        // Send files to file handler endpoint
        const filesData = messageData.files.map(file => ({
          filename: file.name,
          content_type: file.type,
          data: file.compressedData
        }));

        const fileMessageRequest = {
          user_id: messageData.userId,
          session_id: sessionId,
          message: {
            id: messageData.messageId,
            text: messageData.text,
            timestamp: Date.now()
          },
          files: filesData,
          context_items: messageData.contextItems || []
        };

        const response = await fetch(`${process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production'}/files`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fileMessageRequest)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('📁 UnifiedMessageHandler: Files sent to file handler:', result);
      } catch (error) {
        console.error('❌ UnifiedMessageHandler: Error sending files to file handler:', error);
        throw error;
      }
    } else {
      // Regular message without files
      await this.sendWebSocketMessage(sessionId, messageData);
    }
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(sessionId: string, data: any): void {
    console.log('📨 UnifiedMessageHandler: Handling WebSocket message:', data.type, 'for session:', sessionId);
    
    switch (data.type) {
      case 'ai_response':
        this.handleAIResponse(sessionId, data);
        break;
      case 'session_updated':
        this.handleSessionUpdate(sessionId, data);
        break;
      case 'connection_established':
        console.log('✅ UnifiedMessageHandler: Connection established for session:', sessionId);
        break;
      default:
        console.log('📨 UnifiedMessageHandler: Unknown message type:', data.type);
    }
  }

  /**
   * Handle AI response
   */
  private handleAIResponse(sessionId: string, data: any): void {
    const { message_id, content, timestamp, file_data } = data;
    
    console.log('🤖 UnifiedMessageHandler: Received AI response for session:', sessionId);
    if (file_data) {
      console.log('📁 UnifiedMessageHandler: Response includes file data:', file_data.length, 'files');
    }
    
    // Clear loading state for all interfaces
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    
    const aiMessage: SharedMessage = {
      id: message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender: 'ai',
      text: content || 'No response content',
      timestamp: timestamp || Date.now(),
      sessionId: sessionId,
      source: 'chatpage',
      file_data: file_data || undefined
    };

    // Add to local cache
    if (!this.localCache.has(sessionId)) {
      this.localCache.set(sessionId, []);
    }
    this.localCache.get(sessionId)!.push(aiMessage);

    // Notify listeners of message update
    this.notifyMessageUpdate(sessionId, this.localCache.get(sessionId)!);

    // Dispatch typing animation event for streaming
    const typingEvent = new CustomEvent('ai-response-typing', {
      detail: {
        sessionId: sessionId,
        messageId: aiMessage.id,
        content: content,
        timestamp: timestamp
      }
    });
    window.dispatchEvent(typingEvent);
    
    console.log('✅ UnifiedMessageHandler: Added AI response to local cache:', aiMessage.id);
  }

  /**
   * Handle session update
   */
  private handleSessionUpdate(sessionId: string, data: any): void {
    const { session_variables } = data;
    
    console.log('📁 UnifiedMessageHandler: Received session update for session:', sessionId);
    
    // Dispatch session variables update event
    const updateEvent = new CustomEvent('session-variables-updated', {
      detail: {
        sessionId: sessionId,
        sessionVariables: session_variables
      }
    });
    window.dispatchEvent(updateEvent);
    
    console.log('✅ UnifiedMessageHandler: Dispatched session variables update');
  }


  /**
   * Get messages for a session from local cache
   */
  getMessagesForSession(sessionId: string): SharedMessage[] {
    return this.localCache.get(sessionId) || [];
  }

  /**
   * Load existing messages from database into unified system
   */
  loadExistingMessages(sessionId: string, messages: any[]): void {
    console.log(`📨 UnifiedMessageHandler: Loading ${messages.length} existing messages for session ${sessionId}`);
    
    // Clear existing messages for this session
    this.localCache.delete(sessionId);
    
    // Convert database messages to SharedMessage format
    const sharedMessages: SharedMessage[] = messages.map((msg: any) => ({
      id: msg.message_id || msg.id || `msg_${Date.now()}_${Math.random()}`,
      sender: msg.sender,
      text: msg.text || msg.content,
      timestamp: msg.timestamp || Date.now(),
      sessionId: sessionId,
      source: 'database' as 'chatpage' | 'sidebar'
    }));
    
    // Add to local cache
    this.localCache.set(sessionId, sharedMessages);
    
    // Notify listeners of the loaded messages
    this.notifyMessageUpdate(sessionId, sharedMessages);
    
    console.log(`✅ UnifiedMessageHandler: Loaded ${sharedMessages.length} existing messages for session ${sessionId}`);
  }

  /**
   * Clear messages for a session
   */
  clearSessionMessages(sessionId: string): void {
    this.localCache.delete(sessionId);
    // Note: Removed sharedMessageCache integration to prevent double syncing
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.localCache.keys());
  }

  /**
   * Subscribe to message updates for a specific session
   */
  subscribeToMessages(callback: (sessionId: string, messages: SharedMessage[]) => void): () => void {
    this.messageListeners.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.messageListeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of message updates
   */
  private notifyMessageUpdate(sessionId: string, messages: SharedMessage[]): void {
    this.messageListeners.forEach(callback => {
      try {
        callback(sessionId, messages);
      } catch (error) {
        console.error('Error in message listener:', error);
      }
    });
  }

  /**
   * Delete a session - delegates to useChatPersistence
   * This method is kept for API compatibility but the actual deletion
   * should be handled by the useChatPersistence hook in the components
   */
  async deleteSession(sessionId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('🗑️ UnifiedMessageHandler: Deleting session:', sessionId);
      
      // WebSocket disconnection is now handled by the unified messaging system
      
      // Clear local cache
      this.clearSessionMessages(sessionId);
      
      // Call API to delete session
      const response = await sessionManagementAPI.deleteSession(sessionId, userId);
      
      if (response.message) {
        console.log('✅ UnifiedMessageHandler: Session deleted successfully:', sessionId);
        return { success: true };
      } else {
        console.error('❌ UnifiedMessageHandler: Failed to delete session');
        return { success: false, error: 'Failed to delete session' };
      }
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Error deleting session:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Subscribe to loading state changes
   */
  subscribeToLoadingState(callback: (sessionId: string, isLoading: boolean, source: 'chatpage' | 'sidebar') => void): () => void {
    this.loadingStateListeners.add(callback);
    return () => {
      this.loadingStateListeners.delete(callback);
    };
  }

  /**
   * Broadcast loading state change to all listeners
   */
  broadcastLoadingState(sessionId: string, isLoading: boolean, source: 'chatpage' | 'sidebar'): void {
    console.log(`🔄 UnifiedMessageHandler: Broadcasting loading state - Session: ${sessionId}, Loading: ${isLoading}, Source: ${source}`);
    this.loadingStateListeners.forEach(callback => {
      try {
        callback(sessionId, isLoading, source);
      } catch (error) {
        console.error('Error in loading state listener:', error);
      }
    });
  }
}

export const unifiedMessageHandler = UnifiedMessageHandlerService.getInstance();
export default unifiedMessageHandler;
