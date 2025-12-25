/**
 * Context Data Extractor
 * 
 * Utility functions to extract full or partial data for context items.
 * - Full data: Complete object with all fields (for filesystem storage)
 * - Partial data: Reduced data for chat agent (agent can fetch full data from database)
 */

export type DataMode = 'full' | 'partial';

/**
 * Extract bill data based on mode
 * @param bill - Full bill object from search results
 * @param mode - 'full' for filesystem, 'partial' for chat agent
 */
export const extractBillData = (bill: any, mode: DataMode = 'partial'): any => {
  if (mode === 'full') {
    // Return complete bill object with all fields
    return bill;
  }
  
  // Partial mode: Return only essential fields for chat agent
  // Agent can fetch full data from database using bill_id
  return {
    bill_id: bill.bill_id,
    bill_type: bill.bill_type,
    bill_number: bill.bill_number,
    bill_title: bill.bill_title,
    sponsor_full_name: bill.sponsor_full_name,
    sponsor_party: bill.sponsor_party,
    sponsor_state: bill.sponsor_state,
    introduced_date: bill.introduced_date,
    latest_action_date: bill.latest_action_date,
    latest_action_text: bill.latest_action_text,
    congress: bill.congress,
    policy_area: bill.policy_area,
    bipartisan: bill.bipartisan,
  };
};

/**
 * Extract LDA filing data based on mode
 */
export const extractLDAFilingData = (filing: any, mode: DataMode = 'partial'): any => {
  if (mode === 'full') {
    return filing;
  }
  
  // Partial mode: Essential fields only
  return {
    id: filing.id || filing.filing_uuid || filing.PK,
    filing_uuid: filing.filing_uuid,
    registrant_name: filing.registrant_name,
    client_name: filing.client_name,
    filing_type: filing.filing_type,
    filing_period: filing.filing_period,
    filing_year: filing.filing_year,
    amount: filing.amount,
    date_posted: filing.date_posted,
  };
};

/**
 * Extract politician trade data based on mode
 */
export const extractPoliticianTradeData = (trade: any, mode: DataMode = 'partial'): any => {
  if (mode === 'full') {
    return trade;
  }
  
  // Partial mode: Essential fields only
  return {
    tradeId: trade.tradeId,
    politicianName: trade.politicianName,
    securitySymbol: trade.securitySymbol,
    securityName: trade.securityName,
    transactionType: trade.transactionType,
    transactionDate: trade.transactionDate,
    amountMin: trade.amountMin,
    amountMax: trade.amountMax,
    filingDate: trade.filingDate,
  };
};

/**
 * Extract tile data based on mode
 */
export const extractTileDataForContext = (tile: any, mode: DataMode = 'partial'): any => {
  if (mode === 'full') {
    // For tiles, full data includes all tile configuration and results
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
      searchParams: tile.searchParams,
      filterSettings: tile.filterSettings,
      filers: tile.filers,
      results: tile.results,
      portfolioData: tile.portfolioData,
      backendData: tile.backendData,
      // Include any other tile-specific data
      ...tile,
    };
  }
  
  // Partial mode: Configuration only, agent can fetch results from database
  return {
    tileId: tile.id,
    tileType: tile.type,
    symbol: tile.symbol,
    timeframe: tile.timeframe,
    searchParams: tile.searchParams,
    filterSettings: tile.filterSettings,
  };
};


