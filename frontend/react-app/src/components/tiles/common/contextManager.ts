/**
 * Context Manager for Analysis Context Window
 * 
 * This module provides utilities for adding items to the analysis context,
 * allowing users to collect tiles, articles, and other data for AI analysis.
 */

import { getEnvironmentConfig } from '../../../config/environment';

/** S3 bucket names for the current environment (used so the agent can read files via s3_uri/s3_bucket). Must match actual bucket names, e.g. production: cosine-sec-filings-production, cosine-congress-bills-data-production, cosine-lda-disclosures-production, cosine-politician-trades-production. */
export function getS3BucketNames(): {
  secFilings: string;
  ldaDisclosures: string;
  congressBills: string;
  politicianTrades: string;
} {
  const config = getEnvironmentConfig();
  const env = config.environment || 'development';
  const prefix = 'cosine';
  return {
    secFilings: `${prefix}-sec-filings-${env}`,
    ldaDisclosures: `${prefix}-lda-disclosures-${env}`,
    congressBills: `${prefix}-congress-bills-data-${env}`,
    politicianTrades: `${prefix}-politician-trades-${env}`,
  };
}

export interface ContextItem {
  id: string;
  type: 'tile' | 'article' | 'chart' | 'chat' | 'stock_data' | 'sec_filing' | 'politician_trade' | 'govt_contract_award' | 'congress_bill' | 'roll_call' | 'lda_filing' | 'custom' | 'filesystem';
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
  
  // Search and filter properties (for politician_trades and sec_search tiles)
  searchParams?: any;
  filterSettings?: any;
  filers?: any; // Full filer objects for SEC tile (includes CIK and ticker)
  results?: any; // Results data for session persistence
  
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
 * Now adds directly to sidebar instead of opening context window popup
 */
export const addToContext = (item: ContextItem): void => {
  console.log('🔥 addToContext called with:', item);
  
  // CRITICAL: Ensure data field is an object, not a string, before dispatching
  let dataField = item.data;
  
  // If data is a string, parse it back to an object
  if (typeof dataField === 'string') {
    try {
      dataField = JSON.parse(dataField);
      console.warn('⚠️ contextManager: data field was a string, parsed it back to object');
    } catch (e) {
      console.error('❌ contextManager: Failed to parse data field from string:', e);
      dataField = {};
    }
  }
  
  // Ensure data is an object
  if (!dataField || typeof dataField !== 'object' || Array.isArray(dataField)) {
    console.warn('⚠️ contextManager: data field is not a valid object, using empty object');
    dataField = {};
  }
  
  // Create a clean context item with proper data field
  const cleanItem: ContextItem = {
    ...item,
    data: dataField // Ensure data is always an object
  };
  
  console.log('🔥 addToContext - Clean item before dispatch:', {
    id: cleanItem.id,
    type: cleanItem.type,
    has_data: !!cleanItem.data,
    data_type: typeof cleanItem.data,
    data_keys: cleanItem.data ? Object.keys(cleanItem.data) : [],
    data_s3_key: cleanItem.data?.s3_key
  });
  
  // Add directly to sidebar instead of opening context window
  // This allows users to add context items and send messages when ready
  const event = new CustomEvent('add-to-sidebar-context', {
    detail: cleanItem
  });
  console.log('🔥 Dispatching add-to-sidebar-context event:', event);
  window.dispatchEvent(event);
  console.log('🔥 Event dispatched successfully - item added to sidebar');
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
  target: 'sidebar' = 'sidebar'
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
    folder: 'Folder',
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
  target: 'sidebar' = 'sidebar'
): void => {
  // Format published date
  const formatPublishedDate = (dateStr?: string): string => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  };

  const publishedDate = formatPublishedDate(articleData.published_date);
  const formattedTitle = `${title} - ${source}`;
  const subtitle = publishedDate 
    ? `Published on ${publishedDate}${articleData.category ? ` • ${articleData.category}` : ''}`
    : articleData.category ? `Category: ${articleData.category}` : 'News Article';

  const contextItem: ContextItem = {
    id: `article_${articleId}_${Date.now()}`,
    type: 'article',
    title: formattedTitle,
    subtitle: subtitle,
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
  target: 'sidebar' = 'sidebar'
): void => {
  // Format published date
  const formatPublishedDate = (dateStr?: string): string => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  };

  const contextItems: ContextItem[] = articles.map(article => {
    const publishedDate = formatPublishedDate(article.articleData.published_date);
    const formattedTitle = `${article.title} - ${article.source}`;
    const subtitle = publishedDate 
      ? `Published on ${publishedDate}${article.articleData.category ? ` • ${article.articleData.category}` : ''}`
      : article.articleData.category ? `Category: ${article.articleData.category}` : 'News Article';
    
    return {
      id: `article_${article.articleId}_${Date.now()}_${Math.random()}`,
      type: 'article',
      title: formattedTitle,
      subtitle: subtitle,
      data: article.articleData,
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
 * Add a stock to the context window
 * Used for adding individual stocks from the stock screener
 */
export const addStockToContext = (
  symbol: string,
  name: string,
  timeframe: string,
  stockData: any,
  target: 'sidebar' = 'sidebar'
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
  target: 'sidebar' = 'sidebar'
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
  target: 'sidebar' = 'sidebar'
): void => {
  console.log('🔍 DEBUG: addMultipleChatSessionsToContext called with sessions:', sessions);
  
  const contextItems: ContextItem[] = sessions.map(session => {
    const subtitle = `${session.model} • ${session.messageCount} message${session.messageCount !== 1 ? 's' : ''}`;
    
    console.log('🔍 DEBUG: Processing session:', {
      sessionId: session.sessionId,
      title: session.title,
      model: session.model,
      messageCount: session.messageCount,
      sessionDataKeys: Object.keys(session.sessionData || {}),
      sessionData: session.sessionData
    });
    
    const contextItem: ContextItem = {
      id: `chat_${session.sessionId}_${Date.now()}_${Math.random()}`,
      type: 'chat' as const,
      title: session.title,
      subtitle: subtitle,
      data: {
        // Only store essential metadata, not the entire conversation
        session_id: session.sessionId,
        user_id: session.sessionData?.user_id || 'unknown',
        model: session.model,
        message_count: session.messageCount,
        created_at: session.sessionData?.created_at || Date.now(),
        last_updated: session.sessionData?.last_updated || Date.now(),
        // Remove the full session data to reduce storage
        // ...session.sessionData, // This was storing the entire conversation
      },
      timestamp: Date.now(),
    };
    
    console.log('🔍 DEBUG: Created context item:', {
      id: contextItem.id,
      type: contextItem.type,
      title: contextItem.title,
      dataKeys: Object.keys(contextItem.data),
      session_id: contextItem.data.session_id
    });
    
    return contextItem;
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
 * Add a SEC filing to the context window
 * Used for adding individual filings from the SEC search page
 */
export const addFilingToContext = (
  filing: any,
  target: 'sidebar' = 'sidebar'
): void => {
  // Use filingId as the primary unique identifier, fallback to other fields
  const filingId = filing.filingId || filing.adsh || filing.objectAccession || 
                   `${filing.cik || 'unknown'}_${filing.form || 'filing'}_${filing.filingDate || Date.now()}`;
  const title = `${filing.form || 'SEC Filing'} - ${filing.filingEntity || filing.reportingFor || 'Unknown Entity'}`;
  const subtitle = filing.filingDate 
    ? `Filed: ${filing.filingDate}${filing.cik ? ` • CIK: ${filing.cik}` : ''}`
    : filing.cik ? `CIK: ${filing.cik}` : 'SEC Filing';

  const data = { ...filing };
  const docKeys = filing.documentS3Keys && typeof filing.documentS3Keys === 'object' ? Object.values(filing.documentS3Keys) as string[] : [];
  if (docKeys.length > 0) {
    const primaryKey = docKeys.find((k: string) => k.endsWith('.txt')) ?? docKeys[0];
    const buckets = getS3BucketNames();
    data.s3_bucket = buckets.secFilings;
    data.s3_key = primaryKey;
    data.s3_uri = `${buckets.secFilings}/${primaryKey}`;
  }
  
  const contextItem: ContextItem = {
    id: `sec_filing_${filingId}_${Date.now()}`,
    type: 'sec_filing',
    title,
    subtitle,
    data,
    timestamp: Date.now(),
  };
  
  console.log('📄 Context Manager: Adding SEC filing to context', {
    target,
    filingId,
    title,
    subtitle,
    contextItemId: contextItem.id
  });
  
  // Add to current sidebar session's context
  console.log('📌 Context Manager: Attempting to add to sidebar context...');
  
  const event = new CustomEvent('add-to-sidebar-context', {
    detail: contextItem
  });
  window.dispatchEvent(event);
};

/**
 * Add multiple SEC filings to the context window
 * Used for adding multiple selected filings from the SEC search page
 */
export const addMultipleFilingsToContext = (
  filings: any[],
  target: 'sidebar' = 'sidebar'
): void => {
  const contextItems: ContextItem[] = filings.map(filing => {
    // Use filingId as the primary unique identifier, fallback to other fields
    const filingId = filing.filingId || filing.adsh || filing.objectAccession || 
                     `${filing.cik || 'unknown'}_${filing.form || 'filing'}_${filing.filingDate || Date.now()}`;
    const title = `${filing.form || 'SEC Filing'} - ${filing.filingEntity || filing.reportingFor || 'Unknown Entity'}`;
    const subtitle = filing.filingDate 
      ? `Filed: ${filing.filingDate}${filing.cik ? ` • CIK: ${filing.cik}` : ''}`
      : filing.cik ? `CIK: ${filing.cik}` : 'SEC Filing';
    const data = { ...filing };
    const docKeys = filing.documentS3Keys && typeof filing.documentS3Keys === 'object' ? Object.values(filing.documentS3Keys) as string[] : [];
    if (docKeys.length > 0) {
      const primaryKey = docKeys.find((k: string) => k.endsWith('.txt')) ?? docKeys[0];
      const buckets = getS3BucketNames();
      data.s3_bucket = buckets.secFilings;
      data.s3_key = primaryKey;
      data.s3_uri = `${buckets.secFilings}/${primaryKey}`;
    }
    return {
      id: `sec_filing_${filingId}_${Date.now()}-batch-${Math.random()}`,
      type: 'sec_filing' as const,
      title,
      subtitle,
      data,
      timestamp: Date.now(),
    };
  });
  
  console.log('📄 Context Manager: Adding multiple SEC filings to context', {
    target,
    count: filings.length,
    contextItemIds: contextItems.map(item => item.id)
  });
  
  if (target === 'sidebar') {
    // Check if we have access to user and session state for better error handling
    console.log('📌 Context Manager: Attempting to add multiple filings to sidebar context...');
    
    // Add multiple items to current sidebar session's context
    const event = new CustomEvent('add-multiple-to-sidebar-context', {
      detail: contextItems
    });
    window.dispatchEvent(event);
    
    // Listen for potential error response (if sidebar can't handle it)
    const handleSidebarError = () => {
      console.log('⚠️ Context Manager: Sidebar context failed, falling back to new chat for all filings');
      // Fallback to new chat if sidebar fails - dispatch each item separately
      contextItems.forEach(item => addToContext(item));
      // Remove the listener after use
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    };
    
    // Set up temporary listener for error fallback
    window.addEventListener('sidebar-context-error', handleSidebarError);
    
    // Remove the listener after 1 second if no error occurs
    setTimeout(() => {
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    }, 1000);
    
  } else {
    // Add to new chat (existing behavior) - dispatch each item separately
    console.log('🆕 Context Manager: Adding multiple filings to new chat context');
    contextItems.forEach(item => addToContext(item));
  }
};

/**
 * Add a politician trade to the context window
 * Used for adding individual trades from the politician trades search page
 */
export const addTradeToContext = (
  trade: any,
  target: 'sidebar' = 'sidebar'
): void => {
  // Use tradeId as the primary unique identifier, fallback to other fields
  const tradeId = trade.tradeId || trade.id || 
                  `${trade.politicianName || 'unknown'}_${trade.securitySymbol || 'trade'}_${trade.transactionDate || Date.now()}`;
  // Format transaction date from YYYYMMDD format
  const formatTransactionDate = (transactionDate?: number): string => {
    if (!transactionDate) return '';
    const dateStr = transactionDate.toString();
    if (dateStr.length !== 8) return '';
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    try {
      return new Date(`${year}-${month}-${day}`).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return '';
    }
  };

  // Format amount range
  const formatAmountRange = (trade: any): string => {
    if (trade.amountRange && Array.isArray(trade.amountRange) && trade.amountRange.length === 2) {
      const [min, max] = trade.amountRange;
      if (min === max) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(min);
      }
      return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(min)} - ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(max)}`;
    }
    if (trade.amountMin && trade.amountMax) {
      if (trade.amountMin === trade.amountMax) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(trade.amountMin);
      }
      return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(trade.amountMin)} - ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(trade.amountMax)}`;
    }
    return '';
  };

  const title = `${trade.politicianName || 'Unknown Politician'} - ${trade.securitySymbol || trade.securityName || 'Unknown Security'}`;
  const subtitle = trade.transactionDate 
    ? `${trade.transactionType || 'Trade'} on ${formatTransactionDate(trade.transactionDate)}${formatAmountRange(trade) ? ` • ${formatAmountRange(trade)}` : ''}`
    : trade.transactionType ? `${trade.transactionType}` : 'Politician Trade';

  const data = { ...trade };
  const tradeS3Key = trade.formS3Key ?? trade.s3_key;
  if (tradeS3Key) {
    const buckets = getS3BucketNames();
    data.s3_bucket = buckets.politicianTrades;
    data.s3_key = tradeS3Key;
    data.s3_uri = `${buckets.politicianTrades}/${tradeS3Key}`;
  }
  
  const contextItem: ContextItem = {
    id: `politician_trade_${tradeId}_${Date.now()}`,
    type: 'politician_trade',
    title,
    subtitle,
    data,
    timestamp: Date.now(),
  };
  
  console.log('🏛️ Context Manager: Adding politician trade to context', {
    target,
    tradeId,
    title,
    subtitle,
    contextItemId: contextItem.id
  });
  
  // Add to current sidebar session's context
  console.log('📌 Context Manager: Attempting to add to sidebar context...');
  
  const event = new CustomEvent('add-to-sidebar-context', {
    detail: contextItem
  });
  window.dispatchEvent(event);
};

/**
 * Add multiple politician trades to the context window
 * Used for adding multiple selected trades from the politician trades search page
 */
export const addMultipleTradesToContext = (
  trades: any[],
  target: 'sidebar' = 'sidebar'
): void => {
  const contextItems: ContextItem[] = trades.map(trade => {
    // Use tradeId as the primary unique identifier, fallback to other fields
    const tradeId = trade.tradeId || trade.id || 
                    `${trade.politicianName || 'unknown'}_${trade.securitySymbol || 'trade'}_${trade.transactionDate || Date.now()}`;
    // Format transaction date from YYYYMMDD format
    const formatTransactionDate = (transactionDate?: number): string => {
      if (!transactionDate) return '';
      const dateStr = transactionDate.toString();
      if (dateStr.length !== 8) return '';
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      try {
        return new Date(`${year}-${month}-${day}`).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      } catch {
        return '';
      }
    };

    // Format amount range
    const formatAmountRange = (trade: any): string => {
      if (trade.amountRange && Array.isArray(trade.amountRange) && trade.amountRange.length === 2) {
        const [min, max] = trade.amountRange;
        if (min === max) {
          return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(min);
        }
        return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(min)} - ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(max)}`;
      }
      if (trade.amountMin && trade.amountMax) {
        if (trade.amountMin === trade.amountMax) {
          return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(trade.amountMin);
        }
        return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(trade.amountMin)} - ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(trade.amountMax)}`;
      }
      return '';
    };

    const title = `${trade.politicianName || 'Unknown Politician'} - ${trade.securitySymbol || trade.securityName || 'Unknown Security'}`;
    const subtitle = trade.transactionDate 
      ? `${trade.transactionType || 'Trade'} on ${formatTransactionDate(trade.transactionDate)}${formatAmountRange(trade) ? ` • ${formatAmountRange(trade)}` : ''}`
      : trade.transactionType ? `${trade.transactionType}` : 'Politician Trade';
    const data = { ...trade };
    const tradeS3Key = trade.formS3Key ?? trade.s3_key;
    if (tradeS3Key) {
      const buckets = getS3BucketNames();
      data.s3_bucket = buckets.politicianTrades;
      data.s3_key = tradeS3Key;
      data.s3_uri = `${buckets.politicianTrades}/${tradeS3Key}`;
    }
    return {
      id: `politician_trade_${tradeId}_${Date.now()}-batch-${Math.random()}`,
      type: 'politician_trade' as const,
      title,
      subtitle,
      data,
      timestamp: Date.now(),
    };
  });
  
  console.log('🏛️ Context Manager: Adding multiple politician trades to context', {
    target,
    count: trades.length,
    contextItemIds: contextItems.map(item => item.id)
  });
  
  if (target === 'sidebar') {
    console.log('📌 Context Manager: Attempting to add multiple trades to sidebar context...');
    
    // Add multiple items to current sidebar session's context
    const event = new CustomEvent('add-multiple-to-sidebar-context', {
      detail: contextItems
    });
    window.dispatchEvent(event);
    
    // Listen for potential error response (if sidebar can't handle it)
    const handleSidebarError = () => {
      console.log('⚠️ Context Manager: Sidebar context failed, falling back to new chat for all trades');
      // Fallback to new chat if sidebar fails - dispatch each item separately
      contextItems.forEach(item => addToContext(item));
      // Remove the listener after use
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    };
    
    // Set up temporary listener for error fallback
    window.addEventListener('sidebar-context-error', handleSidebarError);
    
    // Remove the listener after 1 second if no error occurs
    setTimeout(() => {
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    }, 1000);
    
  } else {
    // Add to new chat (existing behavior) - dispatch each item separately
    console.log('🆕 Context Manager: Adding multiple trades to new chat context');
    contextItems.forEach(item => addToContext(item));
  }
};

/**
 * Add a government contract award to the context window
 * Used for adding individual awards from the government contracts search page
 */
export const addAwardToContext = (
  award: any
): void => {
  // Use award_id as the primary unique identifier
  const awardId = award.award_id || award.id || `award_${Date.now()}`;
  
  // Format date
  const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  // Format currency
  const formatCurrency = (amount?: number): string => {
    if (amount === undefined || amount === null) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Format title and subtitle with only basic fields
  const title = `${award.awarding_agency_name || 'Unknown Agency'} - ${award.recipient_name || 'Unknown Recipient'}`;
  const obligatedAmount = award.total_obligated_amount || award.total_obligation;
  const outlayedAmount = award.total_outlayed_amount || award.total_outlay;
  const startDate = award.period_start_date;
  
  const subtitleParts: string[] = [];
  if (award.funding_agency_name) subtitleParts.push(`Funding: ${award.funding_agency_name}`);
  if (obligatedAmount) subtitleParts.push(`Obligated: ${formatCurrency(obligatedAmount)}`);
  if (outlayedAmount) subtitleParts.push(`Outlayed: ${formatCurrency(outlayedAmount)}`);
  if (startDate) subtitleParts.push(`Start: ${formatDate(startDate)}`);
  
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : 'Government Contract Award';
  
  const contextItem: ContextItem = {
    id: `govt_contract_award_${awardId}_${Date.now()}`,
    type: 'govt_contract_award',
    title,
    subtitle,
    data: award, // Include all award data
    timestamp: Date.now(),
  };
  
  // Add to current sidebar session's context
  const event = new CustomEvent('add-to-sidebar-context', {
    detail: contextItem
  });
  window.dispatchEvent(event);
};

/**
 * Add multiple government contract awards to the context window
 * Used for adding multiple selected awards from the government contracts search page
 */
export const addMultipleAwardsToContext = (
  awards: any[]
): void => {
  // Format date
  const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  // Format currency
  const formatCurrency = (amount?: number): string => {
    if (amount === undefined || amount === null) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const contextItems: ContextItem[] = awards.map(award => {
    const awardId = award.award_id || award.id || `award_${Date.now()}`;
    
    // Format title and subtitle with only basic fields
    const title = `${award.awarding_agency_name || 'Unknown Agency'} - ${award.recipient_name || 'Unknown Recipient'}`;
    const obligatedAmount = award.total_obligated_amount || award.total_obligation;
    const outlayedAmount = award.total_outlayed_amount || award.total_outlay;
    const startDate = award.period_start_date;
    
    const subtitleParts: string[] = [];
    if (award.funding_agency_name) subtitleParts.push(`Funding: ${award.funding_agency_name}`);
    if (obligatedAmount) subtitleParts.push(`Obligated: ${formatCurrency(obligatedAmount)}`);
    if (outlayedAmount) subtitleParts.push(`Outlayed: ${formatCurrency(outlayedAmount)}`);
    if (startDate) subtitleParts.push(`Start: ${formatDate(startDate)}`);
    
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : 'Government Contract Award';
    
    return {
      id: `govt_contract_award_${awardId}_${Date.now()}_${Math.random()}`,
      type: 'govt_contract_award' as const,
      title,
      subtitle,
      data: award,
      timestamp: Date.now(),
    };
  });
  
  // Add multiple items to current sidebar session's context
  const event = new CustomEvent('add-multiple-to-sidebar-context', {
    detail: contextItems
  });
  window.dispatchEvent(event);
};

/**
 * Add a congress bill to the context window
 * Used for adding individual bills from the congress bills search page
 */
export const addBillToContext = (
  bill: any,
  target: 'sidebar' = 'sidebar'
): void => {
  const billId = bill.bill_id || bill.id || `bill_${Date.now()}`;
  
  const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  // Format title and subtitle with only basic fields
  const title = `${bill.bill_type || 'Bill'} ${bill.bill_number || ''}`.trim();
  const subtitleParts: string[] = [];
  if (bill.sponsor_full_name) subtitleParts.push(bill.sponsor_full_name);
  if (bill.sponsor_party) subtitleParts.push(bill.sponsor_party);
  if (bill.policy_area) subtitleParts.push(bill.policy_area);
  if (bill.introduced_date) subtitleParts.push(`Introduced: ${formatDate(bill.introduced_date)}`);
  
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : 'Congress Bill';

  const data = { ...bill };
  const buckets = getS3BucketNames();
  if (Array.isArray(bill.bill_texts) && bill.bill_texts.length > 0) {
    data.bill_texts = bill.bill_texts;
    const first = bill.bill_texts[0];
    const s3Key = typeof first === 'object' && first !== null && 's3_key' in first ? (first as { s3_key: string }).s3_key : undefined;
    if (s3Key) {
      data.s3_bucket = buckets.congressBills;
      data.s3_key = s3Key;
      data.s3_uri = `${buckets.congressBills}/${s3Key}`;
    }
  } else if (bill.bill_text_html_s3_key) {
    data.s3_bucket = buckets.congressBills;
    data.s3_key = bill.bill_text_html_s3_key;
    data.s3_uri = `${buckets.congressBills}/${bill.bill_text_html_s3_key}`;
  }

  const contextItem: ContextItem = {
    id: `congress_bill_${billId}_${Date.now()}`,
    type: 'congress_bill',
    title,
    subtitle,
    data,
    timestamp: Date.now(),
  };
  
  if (target === 'sidebar') {
    const event = new CustomEvent('add-to-sidebar-context', {
      detail: contextItem
    });
    window.dispatchEvent(event);
    
    const handleSidebarError = () => {
      addToContext(contextItem);
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    };
    
    window.addEventListener('sidebar-context-error', handleSidebarError);
    setTimeout(() => {
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    }, 1000);
  } else {
    addToContext(contextItem);
  }
};

/**
 * Add multiple congress bills to the context window
 * Used for adding multiple selected bills from the congress bills search page
 */
export const addMultipleBillsToContext = (
  bills: any[],
  target: 'sidebar' = 'sidebar'
): void => {
  const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  const contextItems: ContextItem[] = bills.map(bill => {
    const billId = bill.bill_id || bill.id || `bill_${Date.now()}`;
    
    // Format title and subtitle with only basic fields
    const title = `${bill.bill_type || 'Bill'} ${bill.bill_number || ''}`.trim();
    const subtitleParts: string[] = [];
    if (bill.sponsor_full_name) subtitleParts.push(bill.sponsor_full_name);
    if (bill.sponsor_party) subtitleParts.push(bill.sponsor_party);
    if (bill.policy_area) subtitleParts.push(bill.policy_area);
    if (bill.introduced_date) subtitleParts.push(`Introduced: ${formatDate(bill.introduced_date)}`);
    
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : 'Congress Bill';
    const data = { ...bill };
    const buckets = getS3BucketNames();
    if (Array.isArray(bill.bill_texts) && bill.bill_texts.length > 0) {
      data.bill_texts = bill.bill_texts;
      const first = bill.bill_texts[0];
      const s3Key = typeof first === 'object' && first !== null && 's3_key' in first ? (first as { s3_key: string }).s3_key : undefined;
      if (s3Key) {
        data.s3_bucket = buckets.congressBills;
        data.s3_key = s3Key;
        data.s3_uri = `${buckets.congressBills}/${s3Key}`;
      }
    } else if (bill.bill_text_html_s3_key) {
      data.s3_bucket = buckets.congressBills;
      data.s3_key = bill.bill_text_html_s3_key;
      data.s3_uri = `${buckets.congressBills}/${bill.bill_text_html_s3_key}`;
    }
    return {
      id: `congress_bill_${billId}_${Date.now()}_${Math.random()}`,
      type: 'congress_bill' as const,
      title,
      subtitle,
      data,
      timestamp: Date.now(),
    };
  });
  
  if (target === 'sidebar') {
    const event = new CustomEvent('add-multiple-to-sidebar-context', {
      detail: contextItems
    });
    window.dispatchEvent(event);
    
    const handleSidebarError = () => {
      contextItems.forEach(item => addToContext(item));
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    };
    
    window.addEventListener('sidebar-context-error', handleSidebarError);
    setTimeout(() => {
      window.removeEventListener('sidebar-context-error', handleSidebarError);
    }, 1000);
  } else {
    contextItems.forEach(item => addToContext(item));
  }
};

/**
 * Add a roll call to the context window (congress, session, roll).
 * Optional roll_display, bill_id_associated, and search_index_sk (DynamoDB SK) are included when provided.
 * search_index_sk allows the backend to fetch full vote details with a direct get_item (PK=SEARCH#ROLL, SK=search_index_sk).
 */
export const addRollCallToContext = (
  rollCall: { congress: number; session: number; roll: number; roll_display?: string; bill_id_associated?: string; search_index_sk?: string },
  title?: string
): void => {
  const { congress, session, roll, roll_display, bill_id_associated, search_index_sk } = rollCall;
  const contextItem: ContextItem = {
    id: `roll_call_${congress}_${session}_${roll}_${Date.now()}`,
    type: 'roll_call',
    title: title || roll_display || `Roll Call ${congress}-${session}-${roll}`,
    subtitle: `Congress ${congress}, Session ${session}`,
    data: { congress, session, roll, ...(roll_display != null && { roll_display }), ...(bill_id_associated != null && { bill_id_associated }), ...(search_index_sk != null && { search_index_sk }) },
    timestamp: Date.now(),
  };
  addToContext(contextItem);
};

/**
 * Add multiple roll calls to the context window.
 * Includes roll_display, bill_id_associated, and search_index_sk (DynamoDB SK) when available.
 */
export const addMultipleRollCallsToContext = (
  rollCalls: Array<{ congress: number; session: number; roll: number; roll_display?: string; bill_id_associated?: string; search_index_sk?: string }>
): void => {
  const contextItems: ContextItem[] = rollCalls.map(rc => ({
    id: `roll_call_${rc.congress}_${rc.session}_${rc.roll}_${Date.now()}_${Math.random()}`,
    type: 'roll_call' as const,
    title: rc.roll_display || `Roll Call ${rc.congress}-${rc.session}-${rc.roll}`,
    subtitle: `Congress ${rc.congress}, Session ${rc.session}`,
    data: {
      congress: rc.congress,
      session: rc.session,
      roll: rc.roll,
      ...(rc.roll_display != null && { roll_display: rc.roll_display }),
      ...(rc.bill_id_associated != null && { bill_id_associated: rc.bill_id_associated }),
      ...(rc.search_index_sk != null && { search_index_sk: rc.search_index_sk }),
    },
    timestamp: Date.now(),
  }));
  if (contextItems.length === 0) return;
  const event = new CustomEvent('add-multiple-to-sidebar-context', { detail: contextItems });
  window.dispatchEvent(event);
  const handleSidebarError = () => {
    contextItems.forEach(item => addToContext(item));
    window.removeEventListener('sidebar-context-error', handleSidebarError);
  };
  window.addEventListener('sidebar-context-error', handleSidebarError);
  setTimeout(() => window.removeEventListener('sidebar-context-error', handleSidebarError), 1000);
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
 * Add an LDA filing to the context window
 * Used for adding individual filings from the LDA search page
 */
export const addLDAFilingToContext = (
  filing: any
): void => {
  // Use filing_uuid as the primary unique identifier, fallback to other fields
  const filingId = filing.filing_uuid || filing.PK?.replace('FILING#', '').replace('CONTRIBUTION#', '') || 
                   `${filing.registrant_name || 'unknown'}_${filing.client_name || 'filing'}_${filing.dt_posted || Date.now()}`;
  
  // Format date
  const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  // Format currency
  const formatCurrency = (amount?: string | number): string => {
    if (amount === undefined || amount === null) return '';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
  };

  const title = `${filing.filing_type_display || filing.filing_type || filing.report_type_display || filing.report_type || 'LDA Filing'} - ${filing.registrant_name || filing.client_name || 'Unknown'}`;
  const subtitleParts: string[] = [];
  if (filing.dt_posted) subtitleParts.push(`Posted: ${formatDate(filing.dt_posted)}`);
  if (filing.filing_period_display || filing.filing_period) subtitleParts.push(filing.filing_period_display || filing.filing_period);
  if (filing.filing_year) subtitleParts.push(`Year: ${filing.filing_year}`);
  if (filing.income || filing.expenses) {
    const amount = filing.income || filing.expenses;
    subtitleParts.push(`Amount: ${formatCurrency(amount)}`);
  }
  
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : 'LDA Filing';

  const data = { ...filing };
  const ldaS3Key = filing.s3_key ?? filing.document_s3_key;
  if (ldaS3Key) {
    const buckets = getS3BucketNames();
    data.s3_bucket = buckets.ldaDisclosures;
    data.s3_key = ldaS3Key;
    data.s3_uri = `${buckets.ldaDisclosures}/${ldaS3Key}`;
  }
  
  const contextItem: ContextItem = {
    id: `lda_filing_${filingId}_${Date.now()}`,
    type: 'lda_filing',
    title,
    subtitle,
    data,
    timestamp: Date.now(),
  };
  
  // Add to current sidebar session's context
  const event = new CustomEvent('add-to-sidebar-context', {
    detail: contextItem
  });
  window.dispatchEvent(event);
};

/**
 * Add multiple LDA filings to the context window
 * Used for adding multiple selected filings from the LDA search page
 */
export const addMultipleLDAFilingsToContext = (
  filings: any[]
): void => {
  // Format date
  const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  // Format currency
  const formatCurrency = (amount?: string | number): string => {
    if (amount === undefined || amount === null) return '';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
  };

  const contextItems: ContextItem[] = filings.map(filing => {
    // Use filing_uuid as the primary unique identifier, fallback to other fields
    const filingId = filing.filing_uuid || filing.PK?.replace('FILING#', '').replace('CONTRIBUTION#', '') || 
                     `${filing.registrant_name || 'unknown'}_${filing.client_name || 'filing'}_${filing.dt_posted || Date.now()}`;
    
    const title = `${filing.filing_type_display || filing.filing_type || filing.report_type_display || filing.report_type || 'LDA Filing'} - ${filing.registrant_name || filing.client_name || 'Unknown'}`;
    const subtitleParts: string[] = [];
    if (filing.dt_posted) subtitleParts.push(`Posted: ${formatDate(filing.dt_posted)}`);
    if (filing.filing_period_display || filing.filing_period) subtitleParts.push(filing.filing_period_display || filing.filing_period);
    if (filing.filing_year) subtitleParts.push(`Year: ${filing.filing_year}`);
    if (filing.income || filing.expenses) {
      const amount = filing.income || filing.expenses;
      subtitleParts.push(`Amount: ${formatCurrency(amount)}`);
    }
    
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : 'LDA Filing';
    const data = { ...filing };
    const ldaS3Key = filing.s3_key ?? filing.document_s3_key;
    if (ldaS3Key) {
      const buckets = getS3BucketNames();
      data.s3_bucket = buckets.ldaDisclosures;
      data.s3_key = ldaS3Key;
      data.s3_uri = `${buckets.ldaDisclosures}/${ldaS3Key}`;
    }
    return {
      id: `lda_filing_${filingId}_${Date.now()}_${Math.random()}`,
      type: 'lda_filing' as const,
      title,
      subtitle,
      data,
      timestamp: Date.now(),
    };
  });
  
  // Add multiple items to current sidebar session's context
  const event = new CustomEvent('add-multiple-to-sidebar-context', {
    detail: contextItems
  });
  window.dispatchEvent(event);
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

  // Add search params and filter settings for politician trades, SEC, government contracts, congress bills, and LDA disclosures tiles
  if (tile.type === 'politician_trades' || tile.type === 'sec_search' || tile.type === 'govt_contracts' || tile.type === 'congress_bills' || tile.type === 'lda_disclosures') {
    return {
      ...baseData,
      searchParams: tile.searchParams, // Search parameters (politicians, securities, dates, etc.)
      filterSettings: tile.filterSettings, // Client-side filter settings (entities, forms, etc.)
      filers: tile.filers, // Full filer objects for SEC tile (includes CIK and ticker)
      results: tile.results || tile.trades || tile.filings, // Results data for session persistence
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

