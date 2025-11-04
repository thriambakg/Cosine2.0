/**
 * Unified Message Handler
 * Central processing hub for all message types from ChatPage and Sidebar
 * Handles session creation, message routing, and local cache management
 */

import { sessionManagementAPI } from './api';
import { API_CONFIG } from '../config/api';

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
  private cancelledMessages: Set<string> = new Set(); // messageId -> cancelled messages
  private requestIdCounter: number = 0; // For generating unique request IDs
  private sessionUserIds: Map<string, string> = new Map(); // sessionId -> userId mapping
  private recentSendTimestamps: Map<string, number> = new Map(); // queueKey -> last send timestamp (prevents rapid duplicates)

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
    // Generate unique request ID for tracking
    const requestId = `req_${++this.requestIdCounter}_${Date.now()}`;
    
    console.log(`🎯 UnifiedMessageHandler: Processing message [${requestId}]:`, messageData.type, 'from:', messageData.source);
    console.log(`🔍 DEBUG: processMessage [${requestId}] - messageData.contextItems:`, messageData.contextItems);
    console.log(`🔍 DEBUG: processMessage [${requestId}] - contextItems length:`, messageData.contextItems?.length || 0);
    
    // For edit messages, clear cancelled status since user is explicitly resending
    if (messageData.type === 'edit_message' && this.cancelledMessages.has(messageData.messageId)) {
      console.log('✏️ UnifiedMessageHandler: Clearing cancelled status for edit message:', messageData.messageId);
      this.cancelledMessages.delete(messageData.messageId);
    }
    
    // Check if message was cancelled (after clearing edit messages)
    if (this.cancelledMessages.has(messageData.messageId)) {
      console.log('❌ UnifiedMessageHandler: Message was cancelled:', messageData.messageId);
      return { sessionId: messageData.sessionId || '', success: false, error: 'Message was cancelled' };
    }
    
    // For edit messages, use a composite key (messageId + sessionId + source) to prevent duplicates across interfaces
    // For other messages, just use messageId
    const queueKey = messageData.type === 'edit_message' 
      ? `edit_${messageData.messageId}_${messageData.sessionId}_${messageData.source}`
      : messageData.messageId;
    
    // Check if already processing this message
    if (this.processingQueue.has(queueKey)) {
      console.log('⏳ UnifiedMessageHandler: Message already being processed:', queueKey);
      return { sessionId: messageData.sessionId || '', success: false, error: 'Message already being processed' };
    }
    
    // Prevent rapid duplicate sends (within 500ms) - helps catch double-clicks or rapid retries
    const lastSendTime = this.recentSendTimestamps.get(queueKey);
    const now = Date.now();
    if (lastSendTime && (now - lastSendTime) < 500) {
      console.log('⏳ UnifiedMessageHandler: Duplicate send detected (too soon after previous send):', queueKey, 'ms since last:', now - lastSendTime);
      return { sessionId: messageData.sessionId || '', success: false, error: 'Duplicate send detected' };
    }
    this.recentSendTimestamps.set(queueKey, now);

    // Add to processing queue to prevent duplicate processing
    const processingPromise = this.handleMessageProcessing(messageData);
    this.processingQueue.set(queueKey, processingPromise as unknown as Promise<void>);

    try {
      const result = await processingPromise;
      return result;
    } finally {
      // Remove from processing queue and cancelled messages using the same key
      const queueKey = messageData.type === 'edit_message' 
        ? `edit_${messageData.messageId}_${messageData.sessionId}_${messageData.source}`
        : messageData.messageId;
      this.processingQueue.delete(queueKey);
      this.cancelledMessages.delete(messageData.messageId);
      // Clean up timestamp after a delay to prevent memory leaks (but allow rapid prevention)
      setTimeout(() => {
        this.recentSendTimestamps.delete(queueKey);
      }, 1000);
    }
  }

  /**
   * Cancel a message that's currently being processed
   */
  cancelMessage(messageId: string): void {
    const requestId = `cancel_${++this.requestIdCounter}_${Date.now()}`;
    console.log(`🚫 UnifiedMessageHandler: Cancelling message [${requestId}]:`, messageId);
    this.cancelledMessages.add(messageId);
    
    // Also remove from processing queue if it exists
    if (this.processingQueue.has(messageId)) {
      this.processingQueue.delete(messageId);
    }
  }

  /**
   * Cancel all messages for a session (useful for page refresh)
   */
  cancelAllMessagesForSession(sessionId: string): void {
    const requestId = `cancel_all_${++this.requestIdCounter}_${Date.now()}`;
    console.log(`🚫 UnifiedMessageHandler: Cancelling all messages for session [${requestId}]:`, sessionId);
    
    // Get all message IDs for this session from the cache
    const sessionMessages = this.localCache.get(sessionId) || [];
    console.log(`🚫 UnifiedMessageHandler: Found ${sessionMessages.length} messages to cancel for session ${sessionId}`);
    
    sessionMessages.forEach(message => {
      this.cancelledMessages.add(message.id);
    });
    
    // Clear the processing queue for this session
    const sessionKeys = Array.from(this.processingQueue.keys()).filter(key => 
      key.includes(sessionId) || key.startsWith('creating_')
    );
    console.log(`🚫 UnifiedMessageHandler: Found ${sessionKeys.length} processing queue items to cancel for session ${sessionId}`);
    sessionKeys.forEach(key => this.processingQueue.delete(key));
    
    // Send kill signal to backend to stop agent processing
    this.sendKillSignal(sessionId, 'timeout_cancellation');
  }

  /**
   * Send kill signal to backend to stop agent processing
   */
  private async sendKillSignal(sessionId: string, reason: string): Promise<void> {
    try {
      console.log(`🚫 UnifiedMessageHandler: Sending kill signal for session ${sessionId}, reason: ${reason}`);
      
      // Send kill signal via WebSocket if connection exists
      const ws = this.webSocketConnections.get(sessionId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        const killMessage = {
          action: 'kill_session',
          type: 'kill_signal',
          sessionId: sessionId,
          reason: reason,
          timestamp: new Date().toISOString()
        };
        
        ws.send(JSON.stringify(killMessage));
        console.log(`🚫 UnifiedMessageHandler: Sent kill signal via WebSocket for session ${sessionId}`);
      } else {
        // Fallback: Send via API if WebSocket not available
        console.log(`🚫 UnifiedMessageHandler: WebSocket not available, sending kill signal via API for session ${sessionId}`);
        await this.sendKillSignalViaAPI(sessionId, reason);
      }
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Error sending kill signal:', error);
    }
  }

  /**
   * Get current user ID from active sessions
   */
  private getCurrentUserId(): string | null {
    // Try to get user ID from any active session
    for (const [, userId] of this.sessionUserIds.entries()) {
      if (userId) {
        return userId;
      }
    }
    return null;
  }

  /**
   * Send kill signal via API as fallback
   */
  private async sendKillSignalViaAPI(sessionId: string, reason: string): Promise<void> {
    try {
      // Get user ID from the current session or use a default
      const userId = this.getCurrentUserId();
      if (!userId) {
        console.error('❌ UnifiedMessageHandler: No user ID available for kill signal');
        return;
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/sessions?user_id=${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'kill_session',
          session_id: sessionId,
          reason: reason
        })
      });
      
      if (response.ok) {
        console.log(`✅ UnifiedMessageHandler: Successfully sent kill signal via API for session ${sessionId}`);
      } else {
        console.error(`❌ UnifiedMessageHandler: Failed to send kill signal via API for session ${sessionId}:`, response.status);
      }
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Error sending kill signal via API:', error);
    }
  }

  /**
   * Handle the actual message processing based on type
   */
  private async handleMessageProcessing(messageData: UnifiedMessageData): Promise<SessionCreationResult> {
    try {
      console.log('🔍 DEBUG: handleMessageProcessing - messageData.contextItems:', messageData.contextItems);
      console.log('🔍 DEBUG: handleMessageProcessing - contextItems length:', messageData.contextItems?.length || 0);
      
      // Step 1: Ensure session exists
      const sessionResult = await this.ensureSessionExists(messageData);
      if (!sessionResult.success) {
        return sessionResult;
      }

      const sessionId = sessionResult.sessionId!;

      // Store user ID for this session
      this.sessionUserIds.set(sessionId, messageData.userId);

      // Step 2-4: Process message types with correct local UI handling
      switch (messageData.type) {
        case 'new_message':
          // Add user message locally and start loading
          this.addUserMessageToLocalCache(sessionId, messageData);
          this.broadcastLoadingState(sessionId, true, messageData.source);
          await this.processNewMessage(sessionId, messageData);
          break;
        
        case 'context_message':
          // Add user message locally and start loading
          this.addUserMessageToLocalCache(sessionId, messageData);
          this.broadcastLoadingState(sessionId, true, messageData.source);
          await this.processContextMessage(sessionId, messageData);
          break;
        
        case 'file_message':
          // Start loading during file processing
          this.broadcastLoadingState(sessionId, true, messageData.source);
          await this.processFileMessage(sessionId, messageData);
          break;
        
        case 'followup_message':
          // Add user message locally and start loading
          this.addUserMessageToLocalCache(sessionId, messageData);
          this.broadcastLoadingState(sessionId, true, messageData.source);
          await this.processFollowupMessage(sessionId, messageData);
          break;
        
        case 'edit_message':
          // Edit flow: update existing user message in-place and truncate UI immediately
          this.applyLocalEditAndTruncate(sessionId, messageData);
          // Start loading while waiting for new AI response
          this.broadcastLoadingState(sessionId, true, messageData.source);
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
      // Store user ID for this session
      this.sessionUserIds.set(messageData.sessionId, messageData.userId);
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
        // Store user ID for this session
        this.sessionUserIds.set(response.session_id, messageData.userId);
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
    console.log('🔍 DEBUG: processContextMessage - messageData.contextItems:', messageData.contextItems);
    console.log('🔍 DEBUG: processContextMessage - contextItems length:', messageData.contextItems?.length || 0);
    
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

    // Broadcast loading state for file upload
    this.broadcastLoadingState(sessionId, true, messageData.source);

    try {
      // Ensure WebSocket connection exists (creates new session if needed)
      await this.ensureWebSocketConnection(sessionId, messageData.userId);

      // Files are already processed by FileUploadService in the component
      // No need to process them again
      
      // Send file message via WebSocket
      await this.sendFileMessage(sessionId, messageData);
      console.log('✅ UnifiedMessageHandler: File message sent for session:', sessionId);
    } finally {
      // Clear loading state
      this.broadcastLoadingState(sessionId, false, messageData.source);
    }
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
   * Apply edit locally: replace text and truncate messages after the edited one
   */
  private applyLocalEditAndTruncate(sessionId: string, messageData: UnifiedMessageData): void {
    const messages = this.localCache.get(sessionId) || [];
    const idx = messages.findIndex(m => m.id === messageData.messageId && m.sender === 'user');
    if (idx === -1) {
      console.warn('⚠️ UnifiedMessageHandler: Edited message not found locally; skipping local truncate');
      return;
    }
    // Replace text
    messages[idx] = { ...messages[idx], text: messageData.text, timestamp: Date.now() };
    // Truncate after edited message
    const truncated = messages.slice(0, idx + 1);
    this.localCache.set(sessionId, truncated);
    this.notifyMessageUpdate(sessionId, truncated);
    console.log('✏️ UnifiedMessageHandler: Applied local edit and truncated messages at index:', idx);
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
          
          // Note: Removed connection establishment message to prevent duplicate processing
          console.log('📤 UnifiedMessageHandler: WebSocket connected, ready for messages');
          
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

    const isEdit = messageData.type === 'edit_message';
    const messageRequest = isEdit
      ? {
          action: 'chat',
          type: 'edit_message',
          // Backend expects newText for edits
          newText: messageData.text,
          messageId: messageData.messageId,
          userId: messageData.userId,
          sessionId: sessionId,
          model: messageData.model
        }
      : {
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

    console.log('🔍 DEBUG: sendWebSocketMessage - messageRequest being sent to WebSocket:', messageRequest);
    if (!isEdit) {
      console.log('🔍 DEBUG: sendWebSocketMessage - contextItems in messageRequest:', (messageRequest as any).contextItems);
      console.log('🔍 DEBUG: sendWebSocketMessage - contextItems length:', ((messageRequest as any).contextItems || []).length);
    }

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
          context_items: messageData.contextItems || [],
          model: messageData.model || 'claude-sonnet-4'  // Include selected model
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
      case 'edit_acknowledged':
        this.handleEditAcknowledged(sessionId, data);
        break;
      case 'session_updated':
        this.handleSessionUpdate(sessionId, data);
        break;
      case 'connection_established':
        console.log('✅ UnifiedMessageHandler: Connection established for session:', sessionId);
        break;
      case 'message_received':
        console.log('📨 UnifiedMessageHandler: Message received confirmation for session:', sessionId);
        break;
      case 'kill_signal_acknowledged':
        this.handleKillSignalAcknowledgment(sessionId, data);
        break;
      case 'error':
        this.handleErrorMessage(sessionId, data);
        break;
      default:
        console.log('📨 UnifiedMessageHandler: Unknown message type:', data.type);
    }
  }

  /**
   * Handle kill signal acknowledgment from backend
   */
  private handleKillSignalAcknowledgment(sessionId: string, data: any): void {
    console.log('✅ UnifiedMessageHandler: Kill signal acknowledged for session:', sessionId, 'reason:', data.reason);
    console.log('🛑 Processing Cancelled: Processing cancelled successfully');
    
    // Clear loading state for all interfaces since processing was cancelled
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    this.broadcastLoadingState(sessionId, false, 'sidebar');
    
    // Note: Removed cancellation message from chat - now only logs the cancellation
  }


  /**
   * Handle AI response
   */
  private handleAIResponse(sessionId: string, data: any): void {
    const { message_id, content, timestamp } = data;
    
    console.log('🤖 UnifiedMessageHandler: Received AI response for session:', sessionId);
    
    // Clear loading state for all interfaces
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    
    // Validate content before creating message
    const validContent = content && content.trim() && content !== 'Processing your request...';
    
    if (!validContent) {
      console.log('⚠️ UnifiedMessageHandler: Skipping AI response with invalid content:', content);
      return;
    }
    
    const aiMessage: SharedMessage = {
      id: message_id || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender: 'ai',
      text: content,
      timestamp: timestamp || Date.now(),
      sessionId: sessionId,
      source: 'chatpage'
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
   * Handle edit acknowledged from backend
   */
  private handleEditAcknowledged(sessionId: string, data: any): void {
    console.log('✏️ UnifiedMessageHandler: Edit acknowledged for session:', sessionId, 'unchanged:', data.unchanged);
    if (data.unchanged) {
      // Nothing to wait for
      this.broadcastLoadingState(sessionId, false, 'chatpage');
      this.broadcastLoadingState(sessionId, false, 'sidebar');
    } else {
      // Keep loading until ai_response arrives
      this.broadcastLoadingState(sessionId, true, 'chatpage');
    }
  }

  /**
   * Handle error message from WebSocket
   */
  private handleErrorMessage(sessionId: string, data: any): void {
    const errorMessage = data.message || data.error || 'An error occurred';
    console.error('❌ UnifiedMessageHandler: Received error from WebSocket:', errorMessage, 'for session:', sessionId);
    
    // Clear loading state for all interfaces since there was an error
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    this.broadcastLoadingState(sessionId, false, 'sidebar');
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
   * Convert DynamoDB format to JavaScript objects
   */
  private convertDynamoDBFormat(data: any): any {
    if (!data) return undefined;
    
    // If it's already a JavaScript object, return as-is
    if (typeof data === 'object' && !data.L && !data.S && !data.N && !data.M) {
      return data;
    }
    
    // Handle DynamoDB List (L)
    if (data.L) {
      return data.L.map((item: any) => this.convertDynamoDBFormat(item));
    }
    
    // Handle DynamoDB Map (M)
    if (data.M) {
      const result: any = {};
      for (const [key, value] of Object.entries(data.M)) {
        result[key] = this.convertDynamoDBFormat(value);
      }
      return result;
    }
    
    // Handle DynamoDB String (S)
    if (data.S !== undefined) {
      return data.S;
    }
    
    // Handle DynamoDB Number (N)
    if (data.N !== undefined) {
      return parseFloat(data.N);
    }
    
    // Handle DynamoDB Boolean (BOOL)
    if (data.BOOL !== undefined) {
      return data.BOOL;
    }
    
    return data;
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
      source: 'database' as 'chatpage' | 'sidebar',
      files: this.convertDynamoDBFormat(msg.files)
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

// Create singleton instance
const unifiedMessageHandlerInstance = UnifiedMessageHandlerService.getInstance();

// Export the instance directly (it already has all methods including cancellation)
export const unifiedMessageHandler = unifiedMessageHandlerInstance;
export default unifiedMessageHandler;
