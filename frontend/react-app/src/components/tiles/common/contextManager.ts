/**
 * Context Manager for Analysis Context Window
 * 
 * This module provides utilities for adding items to the analysis context,
 * allowing users to collect tiles, articles, and other data for AI analysis.
 */

export interface ContextItem {
  id: string;
  type: 'tile' | 'article' | 'chart' | 'chat' | 'stock_data' | 'custom';
  title: string;
  subtitle?: string;
  data: any;
  timestamp: number;
}

export interface TileContextData {
  // Common tile properties
  tileId: string;
  tileType: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  gridPosition?: { x: number; y: number };
  gridSize?: { width: number; height: number };
  
  // Type-specific properties
  symbol?: string;
  timeframe?: string;
  displayOptions?: any;
  filters?: any;
  criteria?: any;
  
  // Backend data (to be fetched)
  backendData?: any;
}

/**
 * Add an item to the context window
 */
export const addToContext = (item: ContextItem): void => {
  console.log('🔥 addToContext called with:', item);
  const event = new CustomEvent('add-to-context', {
    detail: item
  });
  console.log('🔥 Dispatching event:', event);
  window.dispatchEvent(event);
  console.log('🔥 Event dispatched successfully');
};

/**
 * Add a tile to the context window
 * 
 * @param tileId - Unique tile identifier
 * @param tileType - Type of tile (stock, crypto, news, etc.)
 * @param tileData - Frontend tile data (position, settings, etc.)
 * @param options - Additional options for context item
 */
export const addTileToContext = (
  tileId: string,
  tileType: string,
  tileData: TileContextData,
  options?: {
    fetchBackendData?: boolean;
    customTitle?: string;
    customSubtitle?: string;
  }
): void => {
  const title = options?.customTitle || `${getTileTypeName(tileType)} Tile`;
  const subtitle = options?.customSubtitle || getTileSubtitle(tileType, tileData);
  
  const contextItem: ContextItem = {
    id: `tile_${tileId}_${Date.now()}`,
    type: 'tile',
    title,
    subtitle,
    data: tileData,
    timestamp: Date.now(),
  };
  
  addToContext(contextItem);
};

/**
 * Get a friendly name for a tile type
 */
const getTileTypeName = (tileType: string): string => {
  const typeMap: Record<string, string> = {
    stock: 'Stock',
    crypto: 'Crypto',
    news: 'News',
    portfolio: 'Portfolio',
    stock_screener: 'Stock Screener',
    chat_generated: 'Chat Generated',
    custom: 'Custom',
  };
  
  return typeMap[tileType] || tileType;
};

/**
 * Get a subtitle for a tile based on its type and data
 */
const getTileSubtitle = (tileType: string, tileData: TileContextData): string => {
  switch (tileType) {
    case 'stock':
    case 'crypto':
      return `${tileData.symbol || 'Unknown'} • ${tileData.timeframe || '1d'}`;
    
    case 'news':
      const filterCount = Object.values(tileData.filters || {}).filter(
        (v) => Array.isArray(v) ? v.length > 0 : v
      ).length;
      return filterCount > 0 ? `${filterCount} active filters` : 'No filters';
    
    case 'stock_screener':
      const criteriaCount = Object.keys(tileData.criteria || {}).length;
      return criteriaCount > 0 ? `${criteriaCount} criteria` : 'No criteria';
    
    default:
      return `Tile ID: ${tileData.tileId}`;
  }
};

/**
 * Add a news article to the context window
 */
export const addArticleToContext = (
  articleId: string,
  title: string,
  source: string,
  articleData: any
): void => {
  const contextItem: ContextItem = {
    id: `article_${articleId}_${Date.now()}`,
    type: 'article',
    title: title,
    subtitle: `Source: ${source}`,
    data: articleData,
    timestamp: Date.now(),
  };
  
  addToContext(contextItem);
};

/**
 * Add a stock to the context window
 * Used for adding individual stocks from the stock screener
 */
export const addStockToContext = (
  symbol: string,
  name: string,
  timeframe: string,
  stockData: any
): void => {
  const contextItem: ContextItem = {
    id: `stock_${symbol}_${Date.now()}`,
    type: 'stock_data',
    title: `${symbol} - ${name}`,
    subtitle: `${timeframe} • ${stockData.sector || 'Unknown Sector'}`,
    data: {
      symbol,
      name,
      timeframe,
      ...stockData,
    },
    timestamp: Date.now(),
  };
  
  addToContext(contextItem);
};

/**
 * Add a chat session to the context window
 * 
 * @param sessionId - Unique session identifier
 * @param title - Session title
 * @param model - AI model used
 * @param messageCount - Number of messages in session
 * @param sessionData - Session data including messages (trimmed according to backend logic)
 */
export const addChatSessionToContext = (
  sessionId: string,
  title: string,
  model: string,
  messageCount: number,
  sessionData: any
): void => {
  const subtitle = `${model} • ${messageCount} message${messageCount !== 1 ? 's' : ''}`;
  
  const contextItem: ContextItem = {
    id: `chat_${sessionId}_${Date.now()}`,
    type: 'chat',
    title: title,
    subtitle: subtitle,
    data: {
      session_id: sessionId,
      model: model,
      message_count: messageCount,
      ...sessionData
    },
    timestamp: Date.now(),
  };
  
  addToContext(contextItem);
};

/**
 * Add a custom item to the context window
 */
export const addCustomToContext = (
  id: string,
  title: string,
  subtitle: string,
  data: any,
  type: ContextItem['type'] = 'custom'
): void => {
  const contextItem: ContextItem = {
    id: `${type}_${id}_${Date.now()}`,
    type,
    title,
    subtitle,
    data,
    timestamp: Date.now(),
  };
  
  addToContext(contextItem);
};

/**
 * Extract tile data for context
 * This function prepares tile data for context without fetching backend data
 */
export const extractTileData = (tile: any): TileContextData => {
  return {
    tileId: tile.id,
    tileType: tile.type,
    position: tile.position,
    size: tile.size,
    gridPosition: tile.gridPosition,
    gridSize: tile.gridSize,
    symbol: tile.symbol,
    timeframe: tile.timeframe,
    displayOptions: tile.displayOptions,
    filters: tile.filters,
    criteria: tile.criteria,
  };
};

