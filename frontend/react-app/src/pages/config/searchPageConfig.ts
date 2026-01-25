/**
 * Centralized configuration for all search pages
 * 
 * This file defines batch sizes and pagination settings for search pages.
 * 
 * Search page names match the page component names:
 * - lda_search (LDA Search Page)
 * - congress_bills (Congress Bills Search Page)
 * - govt_contracts (Government Contracts Search Page)
 * - sec_search (SEC Search Page)
 * - politician_trades (Politician Trades Search Page)
 * - stock_screener (Stock Screener Search Page)
 * - news (News Search Page)
 */

export interface SearchPageBatchConfig {
  /** Number of results to fetch per API request/batch */
  batchSize: number;
}

/**
 * Default batch size for search pages (100 results per batch)
 */
export const DEFAULT_SEARCH_PAGE_BATCH_SIZE = 100;

/**
 * Search page-specific batch size configurations
 * Maps search page identifiers to their batch size configurations
 */
export const SEARCH_PAGE_CONFIGS: Record<string, SearchPageBatchConfig> = {
  'lda_search': {
    batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE,
  },
  'congress_bills': {
    batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE,
  },
  'govt_contracts': {
    batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE,
  },
  'sec_search': {
    batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE,
  },
  'politician_trades': {
    batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE,
  },
  'stock_screener': {
    batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE,
  },
  'news': {
    batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE,
  },
};

/**
 * Helper function to get batch size config for a search page
 */
export function getSearchPageBatchConfig(pageIdentifier: string): SearchPageBatchConfig {
  return SEARCH_PAGE_CONFIGS[pageIdentifier] || { batchSize: DEFAULT_SEARCH_PAGE_BATCH_SIZE };
}

/**
 * Helper function to get batch size for a search page
 */
export function getSearchPageBatchSize(pageIdentifier: string): number {
  return getSearchPageBatchConfig(pageIdentifier).batchSize;
}










<<<<<<< HEAD


=======
>>>>>>> ba70d61c88cd76e9f7598f57d72ecdf857e6c9f5
