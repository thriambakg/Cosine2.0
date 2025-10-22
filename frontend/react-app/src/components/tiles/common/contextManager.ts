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
  
  // Portfolio-specific data
  portfolioData?: {
    entries: Array<{ stock: string; shares: number }>;
    results: any;
    timeframe: string;
    isExpanded: boolean;
  };
  
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
 * Add multiple tiles to the context window
 * Used for adding multiple selected tiles from the grid
 */
export const addMultipleTilesToContext = (
  tiles: Array<{
    tileId: string;
    tileType: string;
    tileData: TileContextData;
    options?: {
      fetchBackendData?: boolean;
      customTitle?: string;
      customSubtitle?: string;
    };
  }>,
  target: 'new' | 'sidebar' = 'new'
): void => {
  const contextItems: ContextItem[] = tiles.map(tile => {
    const title = tile.options?.customTitle || `${getTileTypeName(tile.tileType)} Tile`;
    const subtitle = tile.options?.customSubtitle || getTileSubtitle(tile.tileType, tile.tileData);
    
    return {
      id: `tile_${tile.tileId}_${Date.now()}_${Math.random()}`,
      type: 'tile',
      title,
      subtitle,
      data: tile.tileData,
      timestamp: Date.now(),
    };
  });
  
  if (target === 'sidebar') {
    // Add multiple items to current sidebar session's context
    const event = new CustomEvent('add-multiple-to-sidebar-context', {
      detail: contextItems
    });
    window.dispatchEvent(event);
  } else {
    // Add to new chat (existing behavior) - dispatch each item separately
    contextItems.forEach(item => addToContext(item));
  }
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
    
    case 'portfolio':
      if (tileData.portfolioData?.entries) {
        const validEntries = tileData.portfolioData.entries.filter(e => e.stock && e.shares > 0);
        if (validEntries.length > 0) {
          const stocks = validEntries.map(e => `${e.shares} ${e.stock}`).join(', ');
          return `${stocks} • ${tileData.portfolioData.timeframe || '1y'}`;
        }
      }
      return 'No holdings • 1y';
    
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
  articleData: any,
  target: 'new' | 'sidebar' = 'new'
): void => {
  const contextItem: ContextItem = {
    id: `article_${articleId}_${Date.now()}`,
    type: 'article',
    title: title,
    subtitle: `Source: ${source}`,
    data: articleData,
    timestamp: Date.now(),
  };
  
  if (target === 'sidebar') {
    // Add to current sidebar session's context
    const event = new CustomEvent('add-to-sidebar-context', {
      detail: contextItem
    });
    window.dispatchEvent(event);
  } else {
    // Add to new chat (existing behavior)
    addToContext(contextItem);
  }
};

/**
 * Add multiple articles to the context window
 * Used for adding multiple selected articles from the news tile
 */
export const addMultipleArticlesToContext = (
  articles: Array<{
    articleId: string;
    title: string;
    source: string;
    articleData: any;
  }>,
  target: 'new' | 'sidebar' = 'new'
): void => {
  const contextItems: ContextItem[] = articles.map(article => ({
    id: `article_${article.articleId}_${Date.now()}_${Math.random()}`,
    type: 'article',
    title: article.title,
    subtitle: `Source: ${article.source}`,
    data: article.articleData,
    timestamp: Date.now(),
  }));
  
  if (target === 'sidebar') {
    // Add multiple items to current sidebar session's context
    const event = new CustomEvent('add-multiple-to-sidebar-context', {
      detail: contextItems
    });
    window.dispatchEvent(event);
  } else {
    // Add to new chat (existing behavior) - dispatch each item separately
    contextItems.forEach(item => addToContext(item));
  }
};

/**
 * Add a stock to the context window
 * Used for adding individual stocks from the stock screener
 */
export const addStockToContext = (
  symbol: string,
  name: string,
  timeframe: string,
  stockData: any,
  target: 'new' | 'sidebar' = 'new'
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
  
  if (target === 'sidebar') {
    // Add to current sidebar session's context
    const event = new CustomEvent('add-to-sidebar-context', {
      detail: contextItem
    });
    window.dispatchEvent(event);
  } else {
    // Add to new chat (existing behavior)
    addToContext(contextItem);
  }
};

/**
 * Add multiple stocks to the context window
 * Used for adding multiple selected stocks from the stock screener
 */
export const addMultipleStocksToContext = (
  stocks: Array<{
    symbol: string;
    name: string;
    timeframe: string;
    stockData: any;
  }>,
  target: 'new' | 'sidebar' = 'new'
): void => {
  const contextItems: ContextItem[] = stocks.map(stock => ({
    id: `stock_${stock.symbol}_${Date.now()}_${Math.random()}`,
    type: 'stock_data',
    title: `${stock.symbol} - ${stock.name}`,
    subtitle: `${stock.timeframe} • ${stock.stockData.sector || 'Unknown Sector'}`,
    data: {
      symbol: stock.symbol,
      name: stock.name,
      timeframe: stock.timeframe,
      ...stock.stockData,
    },
    timestamp: Date.now(),
  }));
  
  if (target === 'sidebar') {
    // Add multiple items to current sidebar session's context
    const event = new CustomEvent('add-multiple-to-sidebar-context', {
      detail: contextItems
    });
    window.dispatchEvent(event);
  } else {
    // Add to new chat (existing behavior) - dispatch each item separately
    contextItems.forEach(item => addToContext(item));
  }
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
 * Add multiple chat sessions to the context window
 * Used for adding multiple selected chat sessions
 */
export const addMultipleChatSessionsToContext = (
  sessions: Array<{
    sessionId: string;
    title: string;
    model: string;
    messageCount: number;
    sessionData: any;
  }>,
  target: 'new' | 'sidebar' = 'new'
): void => {
  const contextItems: ContextItem[] = sessions.map(session => {
    const subtitle = `${session.model} • ${session.messageCount} message${session.messageCount !== 1 ? 's' : ''}`;
    
    return {
      id: `chat_${session.sessionId}_${Date.now()}_${Math.random()}`,
      type: 'chat',
      title: session.title,
      subtitle: subtitle,
      data: {
        session_id: session.sessionId,
        model: session.model,
        message_count: session.messageCount,
        ...session.sessionData
      },
      timestamp: Date.now(),
    };
  });
  
  if (target === 'sidebar') {
    // Add multiple items to current sidebar session's context
    const event = new CustomEvent('add-multiple-to-sidebar-context', {
      detail: contextItems
    });
    window.dispatchEvent(event);
  } else {
    // Add to new chat (existing behavior) - dispatch each item separately
    contextItems.forEach(item => addToContext(item));
  }
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
 * This function prepares tile data for context INCLUDING backend data
 * Note: This only extracts frontend properties. For actual API data,
 * use fetchTileDataForContext instead.
 */
export const extractTileData = (tile: any): TileContextData => {
  const baseData = {
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
    backendData: tile.backendData || tile.data || {}, // Include backend/API data if available
  };

  // Add portfolio-specific data for portfolio tiles
  if (tile.type === 'portfolio' && tile.portfolioData) {
    return {
      ...baseData,
      portfolioData: tile.portfolioData, // Include portfolio analysis results, stocks, shares, etc.
    };
  }

  return baseData;
};

/**
 * Fetch actual tile data for context (including API data)
 * This function fetches the actual API data for tiles when adding to context
 */
export const fetchTileDataForContext = async (tile: any): Promise<TileContextData> => {
  const baseData = extractTileData(tile);
  
  // If tile already has backend data, use it
  if (tile.backendData || tile.data) {
    return {
      ...baseData,
      backendData: tile.backendData || tile.data
    };
  }
  
  // For tiles without backend data, we need to fetch it
  // This would require importing the API functions
  // For now, return the base data
  return baseData;
};

