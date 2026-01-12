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
  sessionId: string;
  source: 'chatpage' | 'sidebar' | 'database';
  isStreaming?: boolean;  // Flag for streaming messages
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
  
  // Message type (followup_message consolidated into context_message)
  type: 'new_message' | 'context_message' | 'file_message' | 'edit_message';
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
  private cancelledSessions: Set<string> = new Set(); // sessionId -> cancelled sessions (stops all processing)
  private requestIdCounter: number = 0; // For generating unique request IDs
  private sessionUserIds: Map<string, string> = new Map(); // sessionId -> userId mapping
  private recentSendTimestamps: Map<string, number> = new Map(); // queueKey -> last send timestamp (prevents rapid duplicates)
  private agentLogs: Map<string, string> = new Map(); // sessionId -> current agent log message
  private agentLogListeners: Set<(sessionId: string, logMessage: string | null) => void> = new Set(); // Agent log update listeners

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
    if (messageData.type === 'edit_message') {
      if (this.cancelledMessages.has(messageData.messageId)) {
        console.log('✏️ UnifiedMessageHandler: Clearing cancelled status for edit message:', messageData.messageId);
        this.cancelledMessages.delete(messageData.messageId);
      }
      // Also clear session cancellation if this is an edit
      if (messageData.sessionId && this.cancelledSessions.has(messageData.sessionId)) {
        console.log('✏️ UnifiedMessageHandler: Clearing cancelled status for session (edit message):', messageData.sessionId);
        this.cancelledSessions.delete(messageData.sessionId);
      }
    }
    
    // For any new message type (new_message, followup_message, context_message, file_message),
    // clear cancelled session status when user explicitly sends a message
    // This allows users to send messages after cancelling a previous one
    if (messageData.sessionId && this.cancelledSessions.has(messageData.sessionId)) {
      // Clear cancelled status for all message types except edit (which is handled above)
      if (messageData.type !== 'edit_message') {
        console.log(`🔄 UnifiedMessageHandler: Clearing cancelled status for session (${messageData.type}):`, messageData.sessionId);
        this.cancelledSessions.delete(messageData.sessionId);
      }
    }
    
    // Check if session was cancelled (after clearing for new messages)
    // This should now always be false since we cleared it above, but keeping as safety check
    if (messageData.sessionId && this.cancelledSessions.has(messageData.sessionId)) {
      console.log('❌ UnifiedMessageHandler: Session was cancelled:', messageData.sessionId);
      return { sessionId: messageData.sessionId, success: false, error: 'Session was cancelled' };
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
    
    // Find the session for this message and stop streaming immediately
    for (const [sessionId, messages] of this.localCache.entries()) {
      const message = messages.find(m => m.id === messageId);
      if (message) {
        // Stop streaming for this message immediately
        this.stopStreamingForMessage(sessionId, messageId);
        break;
      }
    }
  }

  /**
   * Cancel all messages for a session (useful for page refresh)
   */
  cancelAllMessagesForSession(sessionId: string): void {
    const requestId = `cancel_all_${++this.requestIdCounter}_${Date.now()}`;
    console.log(`🚫 UnifiedMessageHandler: Cancelling all messages for session [${requestId}]:`, sessionId);
    
    // Mark session as cancelled immediately (stops all frontend processing)
    this.cancelledSessions.add(sessionId);
    
    // Get all message IDs for this session from the cache
    const sessionMessages = this.localCache.get(sessionId) || [];
    console.log(`🚫 UnifiedMessageHandler: Found ${sessionMessages.length} messages to cancel for session ${sessionId}`);
    
    sessionMessages.forEach(message => {
      this.cancelledMessages.add(message.id);
    });
    
    // Immediately stop all streaming messages for this session
    this.stopAllStreamingForSession(sessionId);
    
    // Clear loading states immediately
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    this.broadcastLoadingState(sessionId, false, 'sidebar');
    
    // Clear the processing queue for this session
    const sessionKeys = Array.from(this.processingQueue.keys()).filter(key => 
      key.includes(sessionId) || key.startsWith('creating_')
    );
    console.log(`🚫 UnifiedMessageHandler: Found ${sessionKeys.length} processing queue items to cancel for session ${sessionId}`);
    sessionKeys.forEach(key => this.processingQueue.delete(key));
    
    // Send kill signal to backend to stop agent processing
    this.sendKillSignal(sessionId, 'user_cancellation');
  }

  /**
   * Explicitly kill a session (used when deleting a chat or force stopping)
   */
  killSession(sessionId: string, reason: string = 'user_cancellation'): void {
    this.cancelledSessions.add(sessionId);
    this.stopAllStreamingForSession(sessionId);
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    this.broadcastLoadingState(sessionId, false, 'sidebar');
    this.sendKillSignal(sessionId, reason);
  }

  /**
   * Get current user ID from active sessions
   * @private Reserved for future use
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-ignore - Reserved for future use
  private _getCurrentUserId(): string | null {
    // Try to get user ID from any active session
    for (const [, userId] of this.sessionUserIds.entries()) {
      if (userId) {
        return userId;
      }
    }
    return null;
  }

  /**
   * Send kill signal via WebSocket (only if connection is active)
   * Skip if no active connection - session deletion already handles cleanup
   */
  private async sendKillSignal(sessionId: string, reason: string): Promise<void> {
    try {
      console.log(`🚫 UnifiedMessageHandler: Sending kill signal for session ${sessionId}, reason: ${reason}`);
      
      const ws = this.webSocketConnections.get(sessionId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        const killMessage = {
          action: 'kill_session',
          type: 'kill_signal',
          sessionId,
          reason,
          timestamp: new Date().toISOString()
        };
        ws.send(JSON.stringify(killMessage));
        console.log(`🚫 UnifiedMessageHandler: Sent kill signal via WebSocket for session ${sessionId}`);
        return;
      }
      
      // No active WebSocket connection - skip kill signal
      // Session deletion via REST API will handle cleanup
      console.log(`⚠️ UnifiedMessageHandler: No active WebSocket connection for session ${sessionId}, skipping kill signal (session deletion already in progress)`);
    } catch (error) {
      console.error('❌ UnifiedMessageHandler: Error sending kill signal:', error);
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

      const finalSessionId = sessionResult.sessionId!;

      // Store user ID for this session
      this.sessionUserIds.set(finalSessionId, messageData.userId);

      // Step 2: If sessionId changed (new session created), move message from old sessionId to new one
      // This prevents duplicates when a new session is created mid-processing
      if (messageData.sessionId && messageData.sessionId !== finalSessionId) {
        console.log(`🔄 UnifiedMessageHandler: Session ID changed from ${messageData.sessionId} to ${finalSessionId}, moving message`);
        this._moveMessageToNewSession(messageData.messageId, messageData.sessionId, finalSessionId);
      }

      // Step 3: For new WebSocket connections, ensure connection is established BEFORE adding message to cache
      // This prevents messages appearing/disappearing and loading state issues on first message
      const isNewConnection = !this.hasWebSocketConnection(finalSessionId);
      
      if (isNewConnection) {
        console.log('🔄 UnifiedMessageHandler: New WebSocket connection detected, establishing connection before adding message');
        // Establish connection first for new connections to prevent race conditions
        await this.ensureWebSocketConnection(finalSessionId, messageData.userId);
      }
      
      // Step 4: Process message types with correct local UI handling
      // Only add message to cache if it doesn't already exist (prevents duplicates)
      switch (messageData.type) {
        case 'new_message':
          // Add user message locally and start loading
          this.addUserMessageToLocalCache(finalSessionId, messageData);
          this.broadcastLoadingState(finalSessionId, true, messageData.source);
          await this.processNewMessage(finalSessionId, messageData);
          break;
        
        case 'context_message':
          // Add user message locally and start loading
          this.addUserMessageToLocalCache(finalSessionId, messageData);
          this.broadcastLoadingState(finalSessionId, true, messageData.source);
          await this.processContextMessage(finalSessionId, messageData);
          break;
        
        case 'file_message':
          // Add user message locally and start loading (same pattern as regular messages)
          this.addUserMessageToLocalCache(finalSessionId, messageData);
          this.broadcastLoadingState(finalSessionId, true, messageData.source);
          await this.processFileMessage(finalSessionId, messageData);
          break;
        
        case 'edit_message':
          // Edit flow: update existing user message in-place and truncate UI immediately
          this.applyLocalEditAndTruncate(finalSessionId, messageData);
          // Start loading while waiting for new AI response - broadcast to BOTH interfaces for universal updates
          this.broadcastLoadingState(finalSessionId, true, 'chatpage');
          this.broadcastLoadingState(finalSessionId, true, 'sidebar');
          // Send edit via WebSocket (reuse context message process - both just send via WS)
          if (!this.hasWebSocketConnection(finalSessionId)) {
            await this.ensureWebSocketConnection(finalSessionId, messageData.userId);
          }
          await this.sendWebSocketMessage(finalSessionId, messageData);
          console.log('✏️ UnifiedMessageHandler: Edit message sent for session:', finalSessionId);
          break;
      }

      return { sessionId: finalSessionId, success: true };
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
    
    // Connection already established in handleMessageProcessing for new connections
    // For existing connections, ensure it's still valid
    if (!this.hasWebSocketConnection(sessionId)) {
      await this.ensureWebSocketConnection(sessionId, messageData.userId);
    }
    
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
    
    // Connection already established in handleMessageProcessing for new connections
    // For existing connections, ensure it's still valid
    if (!this.hasWebSocketConnection(sessionId)) {
      await this.ensureWebSocketConnection(sessionId, messageData.userId);
    }
    
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

    // Note: User message and loading state are already set in the switch statement above
    // This matches the pattern used by regular messages (new_message, context_message, etc.)

    try {
      // Connection already established in handleMessageProcessing for new connections
      // For existing connections, ensure it's still valid
      if (!this.hasWebSocketConnection(sessionId)) {
        await this.ensureWebSocketConnection(sessionId, messageData.userId);
      }

      // Files are already processed by FileUploadService in the component
      // No need to process them again
      
      // Send file message via WebSocket
      await this.sendFileMessage(sessionId, messageData);
      console.log('✅ UnifiedMessageHandler: File message sent for session:', sessionId);
      
      // Note: Don't clear loading state here - let it stay until AI response arrives
      // The loading state will be cleared when handleAIResponse is called
    } catch (error) {
      // Only clear loading state on error
      console.error('❌ UnifiedMessageHandler: Error processing file message:', error);
      this.broadcastLoadingState(sessionId, false, messageData.source);
      throw error;
    }
  }

  /**
   * Process followup message (existing session with new context)
   * @private Reserved for future use when followup messages need special handling
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-ignore - Reserved for future use
  private async _processFollowupMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    console.log('🔄 UnifiedMessageHandler: Processing followup message for session:', sessionId);
    
    // Connection already established in handleMessageProcessing for new connections
    // For existing connections, ensure it's still valid
    if (!this.hasWebSocketConnection(sessionId)) {
      await this.ensureWebSocketConnection(sessionId, messageData.userId);
    }
    
    // Send message via WebSocket
    await this.sendWebSocketMessage(sessionId, messageData);
    console.log('✅ UnifiedMessageHandler: Message sent for session:', sessionId);
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
        let connectionResolved = false;
        const timeout = setTimeout(() => {
          if (!connectionResolved) {
            connectionResolved = true;
            ws.close();
            reject(new Error('WebSocket connection timeout after 10 seconds'));
          }
        }, 10000);
        
        ws.onopen = () => {
          if (connectionResolved) return;
          connectionResolved = true;
          console.log('✅ UnifiedMessageHandler: WebSocket connected for session:', sessionId);
          clearTimeout(timeout);
          
          // Note: Removed connection establishment message to prevent duplicate processing
          console.log('📤 UnifiedMessageHandler: WebSocket connected, ready for messages');
          
          // Store the connection
          this.setWebSocketConnection(sessionId, ws);
          resolve();
        };
        
        ws.onerror = (error) => {
          console.error('❌ UnifiedMessageHandler: WebSocket error event:', error);
          console.error('❌ UnifiedMessageHandler: WebSocket readyState:', ws.readyState);
          console.error('❌ UnifiedMessageHandler: WebSocket URL:', wsUrl);
          // Don't reject here - let onclose handle it with more details
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Use session_id from message payload if available, otherwise fall back to connection's sessionId
            // This ensures messages are routed to the correct session even if received on a different connection
            const messageSessionId = data.session_id || sessionId;
            // Only log non-streaming messages to reduce noise
            if (data.type !== 'ai_response_chunk') {
              console.log('📨 UnifiedMessageHandler: Received WebSocket message:', data.type, 'for session:', messageSessionId);
            }
            this.handleWebSocketMessage(messageSessionId, data);
          } catch (error) {
            console.error('❌ UnifiedMessageHandler: Error parsing WebSocket message:', error);
          }
        };
        
        ws.onclose = (event) => {
          if (connectionResolved) return;
          connectionResolved = true;
          clearTimeout(timeout);
          
          // Log detailed close information
          const closeReasons: Record<number, string> = {
            1000: 'Normal Closure',
            1001: 'Going Away',
            1002: 'Protocol Error',
            1003: 'Unsupported Data',
            1004: 'Reserved',
            1005: 'No Status Received',
            1006: 'Abnormal Closure (connection lost without close frame)',
            1007: 'Invalid Frame Payload Data',
            1008: 'Policy Violation',
            1009: 'Message Too Big',
            1010: 'Mandatory Extension',
            1011: 'Internal Server Error',
            1012: 'Service Restart',
            1013: 'Try Again Later',
            1014: 'Bad Gateway',
            1015: 'TLS Handshake'
          };
          
          const reason = closeReasons[event.code] || `Unknown (${event.code})`;
          console.error('❌ UnifiedMessageHandler: WebSocket closed for session:', sessionId);
          console.error('❌ UnifiedMessageHandler: Close code:', event.code, '-', reason);
          console.error('❌ UnifiedMessageHandler: Close reason:', event.reason || 'No reason provided');
          console.error('❌ UnifiedMessageHandler: Was clean:', event.wasClean);
          console.error('❌ UnifiedMessageHandler: WebSocket URL:', wsUrl);
          
          this.removeWebSocketConnection(sessionId);
          
          // Reject the promise with detailed error
          reject(new Error(`WebSocket connection failed: ${reason} (code ${event.code})${event.reason ? ` - ${event.reason}` : ''}`));
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
    // Map files correctly - handle both File objects and UploadedFile objects
    const mappedFiles = messageData.files?.map(file => {
      // Handle both File objects and UploadedFile objects (which have name, size, type)
      return {
        name: file.name || (file as any).filename || 'Unknown',
        size: file.size || (file as any).file_size || 0,
        type: file.type || (file as any).content_type || 'application/octet-stream'
      };
    });
    
    console.log('📁 UnifiedMessageHandler: Adding user message with files:', {
      messageId: messageData.messageId,
      fileCount: mappedFiles?.length || 0,
      files: mappedFiles
    });
    
    const userMessage: SharedMessage = {
      id: messageData.messageId,
      sender: 'user',
      text: messageData.text,
      timestamp: Date.now(),
      status: 'sending',
      files: mappedFiles,
      sessionId: sessionId,
      source: messageData.source
    };

    // Add to local cache
    if (!this.localCache.has(sessionId)) {
      this.localCache.set(sessionId, []);
    }
    
    // Check if message already exists - if so, update it instead of adding duplicate
    let messages = this.localCache.get(sessionId)!;
    const existingIndex = messages.findIndex(m => m.id === messageData.messageId && m.sender === 'user');
    
    if (existingIndex !== -1) {
      // Update existing message - create new array to ensure reference changes for React
      messages = [...messages];
      messages[existingIndex] = userMessage;
      this.localCache.set(sessionId, messages);
      console.log('🔄 UnifiedMessageHandler: Updated existing user message in cache:', messageData.messageId);
    } else {
      // Add new message - create new array to ensure reference changes for React
      messages = [...messages, userMessage];
      this.localCache.set(sessionId, messages);
      console.log('📨 UnifiedMessageHandler: Added user message to local cache:', messageData.messageId);
    }

    // Notify listeners of message update
    this.notifyMessageUpdate(sessionId, messages);

    // Note: Removed sharedMessageCache integration to prevent double syncing
    // The unified system handles message distribution directly
  }

  /**
   * Move a message from one session to another (when session ID changes during processing)
   */
  private _moveMessageToNewSession(messageId: string, oldSessionId: string, newSessionId: string): void {
    const oldMessages = this.localCache.get(oldSessionId) || [];
    const messageIndex = oldMessages.findIndex(m => m.id === messageId);
    
    if (messageIndex !== -1) {
      const message = oldMessages[messageIndex];
      // Update message with new sessionId
      message.sessionId = newSessionId;
      
      // Remove from old session
      oldMessages.splice(messageIndex, 1);
      this.localCache.set(oldSessionId, oldMessages);
      if (oldMessages.length > 0) {
        this.notifyMessageUpdate(oldSessionId, oldMessages);
      }
      
      // Add to new session (only if it doesn't already exist)
      if (!this.localCache.has(newSessionId)) {
        this.localCache.set(newSessionId, []);
      }
      const newMessages = this.localCache.get(newSessionId)!;
      if (!newMessages.some(m => m.id === messageId)) {
        newMessages.push(message);
        this.localCache.set(newSessionId, newMessages);
        this.notifyMessageUpdate(newSessionId, newMessages);
        console.log(`✅ UnifiedMessageHandler: Moved message ${messageId} from session ${oldSessionId} to ${newSessionId}`);
      } else {
        console.log(`⚠️ UnifiedMessageHandler: Message ${messageId} already exists in new session ${newSessionId}, skipping move`);
      }
    }
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
   * Send file message: upload files via REST API, then send message via WebSocket
   */
  private async sendFileMessage(sessionId: string, messageData: UnifiedMessageData): Promise<void> {
    const ws = this.webSocketConnections.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`No WebSocket connection for session: ${sessionId}`);
    }

    // For file messages, we need to send the files to the file handler endpoint first
    if (messageData.files && messageData.files.length > 0) {
      try {
        // Step 1: Upload files via REST API
        const filesData = messageData.files.map(file => ({
          filename: file.name,
          content_type: file.type,
          data: file.compressedData
        }));

        const fileUploadRequest = {
          user_id: messageData.userId,
          session_id: sessionId,
          message: {
            id: messageData.messageId,
            text: messageData.text,
            timestamp: Date.now()
          },
          files: filesData,
          context_items: messageData.contextItems || [],
          model: messageData.model || 'claude-sonnet-4'
        };

        const url = `${process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production'}/files`;
        const requestBody = JSON.stringify(fileUploadRequest);
        
        // Get authorization token
        let authHeader: Record<string, string> = {};
        try {
          const { fetchAuthSession } = await import('aws-amplify/auth');
          const session = await fetchAuthSession();
          const idToken = session.tokens?.idToken;
          const accessToken = session.tokens?.accessToken;
          const token = idToken || accessToken;
          
          if (token) {
            authHeader = { Authorization: `Bearer ${token.toString()}` };
            console.log('🔒 UnifiedMessageHandler: Added Authorization header for file upload');
          } else {
            console.warn('⚠️ UnifiedMessageHandler: No auth token found for file upload');
          }
        } catch (authErr) {
          console.warn('⚠️ UnifiedMessageHandler: Failed to get auth token for file upload:', authErr);
        }
        
        console.log('📁 UnifiedMessageHandler: Uploading files via REST API:', {
          url,
          fileCount: filesData.length,
          messageId: messageData.messageId,
          sessionId: sessionId,
          hasAuth: !!authHeader.Authorization
        });
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeader
          },
          body: requestBody
        });

        if (!response.ok) {
          let errorMessage = `HTTP error! status: ${response.status}`;
          try {
            const errorBody = await response.text();
            console.error('📁 UnifiedMessageHandler: Error response body:', errorBody);
            try {
              const errorJson = JSON.parse(errorBody);
              errorMessage = errorJson.error || errorJson.message || errorMessage;
            } catch {
              errorMessage = errorBody || errorMessage;
            }
          } catch (e) {
            console.error('📁 UnifiedMessageHandler: Failed to read error response:', e);
          }
          throw new Error(errorMessage);
        }

        const uploadResult = await response.json();
        console.log('✅ UnifiedMessageHandler: Files uploaded successfully:', uploadResult);

        // Update session variables immediately from API response (if provided)
        if (uploadResult.session_variables) {
          console.log('📁 UnifiedMessageHandler: Updating session variables from file upload response');
          const updateEvent = new CustomEvent('session-variables-updated', {
            detail: {
              sessionId: sessionId,
              sessionVariables: uploadResult.session_variables
            }
          });
          window.dispatchEvent(updateEvent);
          console.log('✅ UnifiedMessageHandler: Dispatched session variables update from file upload response');
        }

        // Step 2: Send message via WebSocket with file attachment flag
        // Include file metadata for frontend display
        const uploadedFilesMetadata = messageData.files.map(file => ({
          name: file.name,
          size: file.size,
          type: file.type
        }));

        const websocketMessage = {
          action: 'chat',
          type: 'chat_message',
          message: messageData.text,
          userId: messageData.userId,
          sessionId: sessionId,
          model: messageData.model,
          messageId: messageData.messageId,
          contextItems: messageData.contextItems || [],
          context: messageData.context,
          // Flag indicating files are attached (already uploaded)
          hasFiles: true,
          uploadedFiles: uploadedFilesMetadata  // File metadata for frontend display
        };

        console.log('📤 UnifiedMessageHandler: Sending message via WebSocket with file attachment flag');
        ws.send(JSON.stringify(websocketMessage));
        console.log('✅ UnifiedMessageHandler: File message sent via WebSocket');
        
        // Dispatch event to reset timeout - file upload is complete, AI processing is starting
        // This ensures the 5-minute timeout only counts from when AI actually starts processing
        const fileMessageSentEvent = new CustomEvent('file-message-sent', {
          detail: {
            sessionId: sessionId,
            messageId: messageData.messageId
          }
        });
        window.dispatchEvent(fileMessageSentEvent);
        console.log('✅ UnifiedMessageHandler: Dispatched file-message-sent event to reset timeout');
      } catch (error: any) {
        console.error('❌ UnifiedMessageHandler: Error in file message flow:', error);
        // Provide more detailed error information
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
          console.error('❌ UnifiedMessageHandler: Network error - possible causes:');
          console.error('   - CORS issue with API Gateway');
          console.error('   - Network connectivity problem');
          console.error('   - API Gateway endpoint not accessible');
          console.error('   - Missing or invalid Authorization header');
          console.error('   - Request blocked by browser security policy');
          throw new Error('Failed to upload files: Network error. Please check your connection and try again.');
        }
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
    // Immediately ignore messages for cancelled sessions
    if (this.cancelledSessions.has(sessionId)) {
      console.log(`🚫 UnifiedMessageHandler: Ignoring WebSocket message for cancelled session: ${sessionId}, type: ${data.type}`);
      return;
    }
    
    // Check if this specific message was cancelled
    if (data.message_id && this.cancelledMessages.has(data.message_id)) {
      console.log(`🚫 UnifiedMessageHandler: Ignoring WebSocket message for cancelled message: ${data.message_id}`);
      return;
    }
    
    // Only log non-streaming messages to reduce noise
    if (data.type !== 'ai_response_chunk') {
      console.log('📨 UnifiedMessageHandler: Handling WebSocket message:', data.type, 'for session:', sessionId);
    }
    
    // Debug: Log full message if type is missing
    if (!data.type) {
      console.warn('⚠️ UnifiedMessageHandler: Received message without type field:', data);
    }
    
    switch (data.type) {
      case 'ai_response':
        this.handleAIResponse(sessionId, data);
        break;
      case 'ai_response_chunk':
        this.handleAIResponseChunk(sessionId, data);
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
        // Update user message status from 'sending' to 'sent'
        // NOTE: Do NOT clear loading state here - keep it until AI response arrives
        // Loading state will be cleared when first AI response chunk arrives (handleAIResponseChunk)
        this.updateUserMessageStatus(sessionId, data.message_id, 'sent');
        break;
      case 'user_message_with_files':
        // Handle user message with files confirmation from backend
        this.handleUserMessageWithFiles(sessionId, data);
        break;
      case 'error':
        this.handleErrorMessage(sessionId, data);
        break;
      case 'agent_log':
        this.handleAgentLog(sessionId, data);
        break;
      default:
        console.log('📨 UnifiedMessageHandler: Unknown message type:', data.type);
    }
  }

  /**
   * Stop streaming for a specific message
   */
  private stopStreamingForMessage(sessionId: string, messageId: string): void {
    const messages = this.localCache.get(sessionId) || [];
    const updatedMessages = messages.map(msg => {
      if (msg.id === messageId && msg.sender === 'ai' && msg.isStreaming) {
        // Remove streaming flag and mark as complete
        const { isStreaming, ...rest } = msg;
        return rest;
      }
      return msg;
    });
    
    if (updatedMessages.length !== messages.length || updatedMessages.some((m, i) => m !== messages[i])) {
      this.localCache.set(sessionId, updatedMessages);
      this.notifyMessageUpdate(sessionId, updatedMessages);
      console.log(`🛑 UnifiedMessageHandler: Stopped streaming for message: ${messageId}`);
    }
  }
  
  /**
   * Stop all streaming messages for a session
   */
  private stopAllStreamingForSession(sessionId: string): void {
    const messages = this.localCache.get(sessionId) || [];
    const updatedMessages = messages.filter(msg => {
      // Remove any incomplete streaming AI messages
      if (msg.sender === 'ai' && msg.isStreaming) {
        return false;
      }
      return true;
    });
    
    if (updatedMessages.length !== messages.length) {
      this.localCache.set(sessionId, updatedMessages);
      this.notifyMessageUpdate(sessionId, updatedMessages);
      console.log(`🛑 UnifiedMessageHandler: Stopped all streaming for session: ${sessionId}`);
    }
  }
  
  /**
   * Handle AI response
   */
  private handleAIResponse(sessionId: string, data: any): void {
    // Immediately ignore if session or message is cancelled
    if (this.cancelledSessions.has(sessionId)) {
      console.log(`🚫 UnifiedMessageHandler: Ignoring AI response for cancelled session: ${sessionId}`);
      return;
    }
    
    const { message_id, content, timestamp } = data;
    
    // Check if this specific message was cancelled
    if (message_id && this.cancelledMessages.has(message_id)) {
      console.log(`🚫 UnifiedMessageHandler: Ignoring AI response for cancelled message: ${message_id}`);
      return;
    }
    
    console.log('🤖 UnifiedMessageHandler: Received AI response for session:', sessionId, 'message_id:', message_id);
    
    // Validate content before creating message
    const validContent = content && content.trim() && content !== 'Processing your request...';
    
    if (!validContent) {
      console.log('⚠️ UnifiedMessageHandler: Skipping AI response with invalid content:', content);
      return;
    }
    
    // Check for duplicate messages (prevent adding the same message twice)
    const messages = this.localCache.get(sessionId) || [];
    const existingMessage = messages.find(m => m.id === message_id && m.sender === 'ai');
    
    if (existingMessage) {
      // If this message was streamed, the complete response is just a confirmation
      // Update the existing streaming message with final content if it differs
      if (existingMessage.isStreaming && content && content.trim()) {
        // Update the message with the final content (in case backend sends cleaned version)
        existingMessage.text = content;
        delete existingMessage.isStreaming;
        this.notifyMessageUpdate(sessionId, messages);
        console.log('✅ UnifiedMessageHandler: Updated streaming message with final content:', message_id);
      } else {
        console.log('⚠️ UnifiedMessageHandler: Duplicate AI response detected, skipping:', message_id);
      }
      // Still clear loading state and agent log even if duplicate
      this.broadcastLoadingState(sessionId, false, 'chatpage');
      this.broadcastLoadingState(sessionId, false, 'sidebar');
      this.clearAgentLog(sessionId);
      return;
    }
    
    // Convert timestamp to milliseconds if it's an ISO string
    let timestampMs: number;
    if (typeof timestamp === 'string') {
      // ISO string - convert to milliseconds
      timestampMs = new Date(timestamp).getTime();
      if (isNaN(timestampMs)) {
        console.warn('⚠️ UnifiedMessageHandler: Invalid timestamp format, using current time');
        timestampMs = Date.now();
      }
    } else if (typeof timestamp === 'number') {
      // Already in milliseconds (or seconds - check if it's seconds)
      timestampMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    } else {
      // No timestamp or invalid - use current time
      timestampMs = Date.now();
    }
    
    // Check if this looks like an error message
    const errorPatterns = [
      /^I apologize, but I encountered an error/i,
      /^An error occurred/i,
      /^Error processing/i
    ];
    
    const isErrorResponse = errorPatterns.some(pattern => pattern.test(content));
    
    // If this is an error response, check if there's already a non-error response
    // If so, skip this error message
    if (isErrorResponse) {
      const hasNonErrorResponse = messages.some(m => 
        m.sender === 'ai' && 
        m.timestamp >= (timestampMs - 5000) && // Within 5 seconds
        !errorPatterns.some(p => p.test(m.text))
      );
      
      if (hasNonErrorResponse) {
        console.log('⚠️ UnifiedMessageHandler: Skipping error response, real response already exists');
        // Still clear loading state
        this.broadcastLoadingState(sessionId, false, 'chatpage');
        this.broadcastLoadingState(sessionId, false, 'sidebar');
        this.clearAgentLog(sessionId);
        return;
      }
    }
    
    // Valid response - add it immediately (use converted timestamp)
    this.addAIResponseToCache(sessionId, message_id, content, timestampMs);
    
    // If we just added a non-error response, remove any recent error responses
    if (!isErrorResponse) {
      const recentErrorMessages = messages.filter(m => 
        m.sender === 'ai' && 
        m.timestamp >= (timestampMs - 5000) && // Within 5 seconds
        errorPatterns.some(p => p.test(m.text))
      );
      
      if (recentErrorMessages.length > 0) {
        console.log(`⚠️ UnifiedMessageHandler: Removing ${recentErrorMessages.length} error message(s) since real response arrived`);
        const updatedMessages = messages.filter(m => !recentErrorMessages.includes(m));
        this.localCache.set(sessionId, updatedMessages);
        this.notifyMessageUpdate(sessionId, updatedMessages);
      }
    }
    
    // Clear loading state for all interfaces
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    this.broadcastLoadingState(sessionId, false, 'sidebar');
    
    // Clear agent log when AI response arrives
    this.clearAgentLog(sessionId);
    
    console.log('✅ UnifiedMessageHandler: Added AI response to local cache:', message_id);
  }

  /**
   * Handle AI response chunk (streaming)
   */
  private handleAIResponseChunk(sessionId: string, data: any): void {
    const { message_id, content, timestamp, is_complete } = data;
    
    // Immediately stop processing if session or message is cancelled
    if (this.cancelledSessions.has(sessionId)) {
      console.log(`🚫 UnifiedMessageHandler: Stopping streaming chunk for cancelled session: ${sessionId}`);
      return;
    }
    
    if (message_id && this.cancelledMessages.has(message_id)) {
      console.log(`🚫 UnifiedMessageHandler: Stopping streaming chunk for cancelled message: ${message_id}`);
      return;
    }
    
    // Get or create the streaming message
    const messages = this.localCache.get(sessionId) || [];
    let streamingMessage = messages.find(m => m.id === message_id && m.sender === 'ai');
    
    if (!streamingMessage) {
      // Log only when streaming starts (first chunk)
      console.log('🌊 UnifiedMessageHandler: Agent streaming response for session:', sessionId);
      // Create new streaming message
      const timestampMs = typeof timestamp === 'number' ? timestamp : (timestamp ? new Date(timestamp).getTime() : Date.now());
      streamingMessage = {
        id: message_id,
        sender: 'ai',
        text: content || '',
        timestamp: timestampMs,
        sessionId: sessionId,
        source: 'database',
        isStreaming: true
      };
      
      // Add to cache
      if (!this.localCache.has(sessionId)) {
        this.localCache.set(sessionId, []);
      }
      this.localCache.get(sessionId)!.push(streamingMessage);
      
      // Clear loading state when first chunk arrives
      this.broadcastLoadingState(sessionId, false, 'chatpage');
      this.broadcastLoadingState(sessionId, false, 'sidebar');
      this.clearAgentLog(sessionId);
    } else {
      // Append chunk to existing message
      streamingMessage.text += (content || '');
    }
    
    // Update the message in cache
    const updatedMessages = this.localCache.get(sessionId)!.map(m => 
      m.id === message_id && m.sender === 'ai' ? streamingMessage! : m
    );
    this.localCache.set(sessionId, updatedMessages);
    
    // Notify listeners immediately for instant UI update
    this.notifyMessageUpdate(sessionId, updatedMessages);
    
    // If this is the final chunk, mark as complete
    if (is_complete) {
      if (streamingMessage.isStreaming !== undefined) {
        delete streamingMessage.isStreaming;
      }
      console.log('✅ UnifiedMessageHandler: Streaming complete for message:', message_id);
      
      // Dispatch streaming complete event for queue processing
      const streamingCompleteEvent = new CustomEvent('streaming-complete', {
        detail: {
          sessionId: sessionId,
          messageId: message_id
        }
      });
      window.dispatchEvent(streamingCompleteEvent);
    }
  }

  /**
   * Add AI response to local cache
   */
  private addAIResponseToCache(sessionId: string, messageId: string, content: string, timestamp: number): void {
    const aiMessage: SharedMessage = {
      id: messageId || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender: 'ai',
      text: content,
      timestamp: timestamp || Date.now(),
      sessionId: sessionId,
      source: 'database' // Use 'database' so both chatpage and sidebar can see it
    };

    // Add to local cache
    if (!this.localCache.has(sessionId)) {
      this.localCache.set(sessionId, []);
    }
    const messages = this.localCache.get(sessionId)!;
    messages.push(aiMessage);

    // Notify listeners IMMEDIATELY (synchronous) for instant UI update
    // This ensures messages appear instantly without waiting for persistence
    this.notifyMessageUpdate(sessionId, messages);

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
  }

  /**
   * Handle edit acknowledged from backend
   */
  private handleEditAcknowledged(sessionId: string, data: any): void {
    console.log('✏️ UnifiedMessageHandler: Edit acknowledged for session:', sessionId, 'unchanged:', data.unchanged);
    if (data.unchanged) {
      // Nothing to wait for - clear loading state for both interfaces
      this.broadcastLoadingState(sessionId, false, 'chatpage');
      this.broadcastLoadingState(sessionId, false, 'sidebar');
    } else {
      // Keep loading until ai_response arrives - broadcast to both interfaces
      this.broadcastLoadingState(sessionId, true, 'chatpage');
      this.broadcastLoadingState(sessionId, true, 'sidebar');
    }
  }

  /**
   * Handle user message with files from WebSocket
   */
  private handleUserMessageWithFiles(sessionId: string, data: any): void {
    const { message_id, content, files, timestamp } = data;
    console.log('📨 UnifiedMessageHandler: Received user message with files for session:', sessionId);
    console.log('📁 UnifiedMessageHandler: Files from backend:', files);
    
    // Map files from backend format to frontend format
    const mappedFiles = files?.map((f: any) => ({
      name: f.name || f.filename || 'Unknown',
      size: f.size || f.file_size || 0,
      type: f.type || f.content_type || 'application/octet-stream'
    }));
    
    // Update existing user message in cache (if it exists) or add new one
    const messages = this.localCache.get(sessionId) || [];
    const messageIndex = messages.findIndex(m => m.id === message_id && m.sender === 'user');
    
    if (messageIndex !== -1) {
      // Update existing message - preserve files from cache if backend doesn't send them
      const existingFiles = messages[messageIndex].files;
      const finalFiles = mappedFiles && mappedFiles.length > 0 ? mappedFiles : existingFiles;
      
      console.log('📁 UnifiedMessageHandler: Updating message with files:', {
        messageId: message_id,
        existingFiles: existingFiles?.length || 0,
        backendFiles: mappedFiles?.length || 0,
        finalFiles: finalFiles?.length || 0
      });
      
      messages[messageIndex] = {
        ...messages[messageIndex],
        text: content || messages[messageIndex].text,
        status: 'sent',
        files: finalFiles, // Use mapped files or preserve existing
        timestamp: timestamp || messages[messageIndex].timestamp
      };
    } else {
      // Add new message if not found (shouldn't happen, but handle gracefully)
      const userMessage: SharedMessage = {
        id: message_id,
        sender: 'user',
        text: content || '',
        timestamp: timestamp || Date.now(),
        status: 'sent',
        files: files?.map((f: any) => ({
          name: f.name || f.filename || 'Unknown',
          size: f.size || 0,
          type: f.type || f.content_type || 'application/octet-stream'
        })),
        sessionId: sessionId,
        source: 'chatpage'
      };
      messages.push(userMessage);
    }
    
    this.localCache.set(sessionId, messages);
    this.notifyMessageUpdate(sessionId, messages);
    
    console.log('✅ UnifiedMessageHandler: Updated user message with files in cache:', message_id);
  }

  /**
   * Update user message status in local cache
   */
  private updateUserMessageStatus(sessionId: string, messageId: string, status: 'sending' | 'sent' | 'error'): void {
    const messages = this.localCache.get(sessionId) || [];
    const messageIndex = messages.findIndex(m => m.id === messageId && m.sender === 'user');
    
    if (messageIndex !== -1) {
      messages[messageIndex] = {
        ...messages[messageIndex],
        status
      };
      this.localCache.set(sessionId, messages);
      this.notifyMessageUpdate(sessionId, messages);
      console.log(`✅ UnifiedMessageHandler: Updated message ${messageId} status to ${status}`);
    }
  }

  /**
   * Handle error message from WebSocket
   */
  private handleErrorMessage(sessionId: string, data: any): void {
    const errorMessage = data.message || data.error || 'An error occurred';
    console.error('❌ UnifiedMessageHandler: Received error from WebSocket:', errorMessage, 'for session:', sessionId);
    
    // Don't show error messages that are just status updates or temporary issues
    // Only show real errors that prevent processing
    const ignorableErrors = [
      'Processing your request',
      'message already being processed',
      'duplicate send detected'
    ];
    
    const isIgnorableError = ignorableErrors.some(ignorable => 
      errorMessage.toLowerCase().includes(ignorable.toLowerCase())
    );
    
    if (isIgnorableError) {
      console.log('⚠️ UnifiedMessageHandler: Ignoring ignorable error message:', errorMessage);
      return;
    }
    
    // Update user message status to error if message_id is provided
    if (data.message_id) {
      this.updateUserMessageStatus(sessionId, data.message_id, 'error');
    }
    
    // Only clear loading state if this is a real error (not a temporary status)
    // For file messages, we want to keep loading until we get an AI response
    if (!errorMessage.toLowerCase().includes('processing')) {
    this.broadcastLoadingState(sessionId, false, 'chatpage');
    this.broadcastLoadingState(sessionId, false, 'sidebar');
    }
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
   * Handle agent log message
   */
  private handleAgentLog(sessionId: string, data: any): void {
    const { payload, session_id } = data;
    
    // Use session_id from message if available, otherwise use passed sessionId
    const targetSessionId = session_id || sessionId;
    
    if (!payload || !payload.message) {
      console.log('⚠️ UnifiedMessageHandler: Received agent log without message:', data);
      return;
    }
    
    const logMessage = payload.message;
    console.log('📊 UnifiedMessageHandler: Received agent log for session:', targetSessionId, 'message:', logMessage);
    
    // Store the current agent log for this session
    this.agentLogs.set(targetSessionId, logMessage);
    
    // Notify listeners
    this.notifyAgentLogUpdate(targetSessionId, logMessage);
    
    // Dispatch event for components that listen to custom events
    const logEvent = new CustomEvent('agent-log-updated', {
      detail: {
        sessionId: targetSessionId,
        logMessage: logMessage,
        level: payload.level || 'INFO',
        timestamp: payload.log_timestamp || Date.now()
      }
    });
    window.dispatchEvent(logEvent);
    
    console.log('✅ UnifiedMessageHandler: Updated agent log for session:', targetSessionId);
  }

  /**
   * Get current agent log for a session
   */
  getCurrentAgentLog(sessionId: string): string | null {
    return this.agentLogs.get(sessionId) || null;
  }

  /**
   * Clear agent log for a session (when AI response arrives)
   */
  clearAgentLog(sessionId: string): void {
    this.agentLogs.delete(sessionId);
    this.notifyAgentLogUpdate(sessionId, null);
  }

  /**
   * Notify agent log listeners
   */
  private notifyAgentLogUpdate(sessionId: string, logMessage: string | null): void {
    this.agentLogListeners.forEach(listener => {
      try {
        listener(sessionId, logMessage);
      } catch (error) {
        console.error('❌ UnifiedMessageHandler: Error in agent log listener:', error);
      }
    });
  }

  /**
   * Subscribe to agent log updates
   */
  onAgentLogUpdate(listener: (sessionId: string, logMessage: string | null) => void): () => void {
    this.agentLogListeners.add(listener);
    return () => {
      this.agentLogListeners.delete(listener);
    };
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
   * Merges with existing cache to preserve messages that haven't been saved yet
   */
  loadExistingMessages(sessionId: string, messages: any[]): void {
    console.log(`📨 UnifiedMessageHandler: Loading ${messages.length} existing messages for session ${sessionId}`);
    
    // Get existing messages from cache (may contain unsaved messages)
    const existingCacheMessages = this.localCache.get(sessionId) || [];
    // const existingMessageIds = new Set(existingCacheMessages.map(m => m.id));
    
    // Convert database messages to SharedMessage format
    const databaseMessages: SharedMessage[] = messages.map((msg: any) => ({
      id: msg.message_id || msg.id || `msg_${Date.now()}_${Math.random()}`,
      sender: msg.sender,
      text: msg.text || msg.content,
      timestamp: msg.timestamp || Date.now(),
      sessionId: sessionId,
      source: 'database' as 'chatpage' | 'sidebar',
      files: this.convertDynamoDBFormat(msg.files)
    }));
    
    // Merge: Keep cache messages (they're more up-to-date), add database messages that aren't in cache
    // Use a Map to deduplicate by ID, with cache messages taking precedence
    const mergedMap = new Map<string, SharedMessage>();
    
    // First add all cache messages (these are the most up-to-date)
    existingCacheMessages.forEach(msg => {
      mergedMap.set(msg.id, msg);
    });
    
    // Then add database messages that aren't already in cache
    databaseMessages.forEach(dbMsg => {
      if (!mergedMap.has(dbMsg.id)) {
        mergedMap.set(dbMsg.id, dbMsg);
      }
    });
    
    // Convert map to array and sort by timestamp
    const mergedMessages: SharedMessage[] = Array.from(mergedMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    
    // Update cache with merged messages
    this.localCache.set(sessionId, mergedMessages);
    
    // Notify listeners of the merged messages
    this.notifyMessageUpdate(sessionId, mergedMessages);
    
    console.log(`✅ UnifiedMessageHandler: Merged messages for session ${sessionId} - Cache: ${existingCacheMessages.length}, Database: ${databaseMessages.length}, Merged: ${mergedMessages.length}`);
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
   * Public method to allow components to manually trigger message updates
   * (useful for fixing race conditions when sessionId changes)
   */
  public notifyMessageUpdate(sessionId: string, messages: SharedMessage[]): void {
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