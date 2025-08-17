import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    portfolioContext?: boolean;
    robinhoodData?: boolean;
    cryptoData?: boolean;
    stockData?: boolean;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  isLoading: boolean;
  error: string | null;
  
  // Context data for AI responses
  portfolioContext: {
    includeRobinhoodData: boolean;
    includeCryptoData: boolean;
    includeStockData: boolean;
    includePortfolioAnalysis: boolean;
  };
}

const initialState: ChatState = {
  currentSession: null,
  sessions: [],
  isLoading: false,
  error: null,
  portfolioContext: {
    includeRobinhoodData: true,
    includeCryptoData: true,
    includeStockData: true,
    includePortfolioAnalysis: true,
  },
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    // Session Management
    createNewSession: (state) => {
      const newSession: ChatSession = {
        id: `session-${Date.now()}`,
        title: 'New Chat',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      state.currentSession = newSession;
      state.sessions.unshift(newSession);
    },
    
    setCurrentSession: (state, action: PayloadAction<string>) => {
      const session = state.sessions.find(s => s.id === action.payload);
      if (session) {
        state.currentSession = session;
      }
    },
    
    deleteSession: (state, action: PayloadAction<string>) => {
      state.sessions = state.sessions.filter(s => s.id !== action.payload);
      if (state.currentSession?.id === action.payload) {
        state.currentSession = state.sessions[0] || null;
      }
    },
    
    updateSessionTitle: (state, action: PayloadAction<{ sessionId: string; title: string }>) => {
      const session = state.sessions.find(s => s.id === action.payload.sessionId);
      if (session) {
        session.title = action.payload.title;
        session.updatedAt = new Date().toISOString();
      }
    },
    
    // Message Management
    addMessage: (state, action: PayloadAction<Omit<ChatMessage, 'id' | 'timestamp'>>) => {
      if (!state.currentSession) {
        // Create a new session if none exists
        const newSession: ChatSession = {
          id: `session-${Date.now()}`,
          title: action.payload.content.slice(0, 50) + '...',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.currentSession = newSession;
        state.sessions.unshift(newSession);
      }
      
      const newMessage: ChatMessage = {
        ...action.payload,
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
      };
      
      state.currentSession.messages.push(newMessage);
      state.currentSession.updatedAt = new Date().toISOString();
      
      // Update session title if it's the first user message
      if (state.currentSession.messages.length === 1 && action.payload.type === 'user') {
        state.currentSession.title = action.payload.content.slice(0, 50);
      }
    },
    
    updateMessage: (state, action: PayloadAction<{ messageId: string; content: string }>) => {
      if (state.currentSession) {
        const message = state.currentSession.messages.find(m => m.id === action.payload.messageId);
        if (message) {
          message.content = action.payload.content;
          state.currentSession.updatedAt = new Date().toISOString();
        }
      }
    },
    
    deleteMessage: (state, action: PayloadAction<string>) => {
      if (state.currentSession) {
        state.currentSession.messages = state.currentSession.messages.filter(
          m => m.id !== action.payload
        );
        state.currentSession.updatedAt = new Date().toISOString();
      }
    },
    
    // Loading and Error States
    setChatLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    
    setChatError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    // Portfolio Context Settings
    setPortfolioContext: (state, action: PayloadAction<Partial<ChatState['portfolioContext']>>) => {
      state.portfolioContext = { ...state.portfolioContext, ...action.payload };
    },
    
    // Clear All Data
    clearChatHistory: (state) => {
      state.sessions = [];
      state.currentSession = null;
      state.error = null;
    },
  },
});

export const {
  createNewSession,
  setCurrentSession,
  deleteSession,
  updateSessionTitle,
  addMessage,
  updateMessage,
  deleteMessage,
  setChatLoading,
  setChatError,
  setPortfolioContext,
  clearChatHistory,
} = chatSlice.actions;

export default chatSlice.reducer;
