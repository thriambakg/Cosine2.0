/**
 * Centralized configuration for all tiles
 * 
 * This file defines batch sizes, result limits, and physical size constraints
 * for all tiles in the dashboard.
 * 
 * Tile type names match the types used in DashboardTile interface:
 * - lda_disclosures (LDA Search)
 * - congress_bills (Congress Bills Search)
 * - govt_contracts (Government Contracts Search)
 * - sec_search (SEC Search)
 * - politician_trades (Politician Trades Search)
 * - stock_screener (Stock Screener)
 * - news (News)
 * - stock, crypto, portfolio, folder (Non-search tiles)
 */

export interface TilePaginationConfig {
  /** Number of results to fetch per API request */
  batchSize: number;
  /** Maximum number of pages to load */
  maxPages: number;
  /** Maximum number of pagination keys to store (usually maxPages - 1) */
  maxPaginationKeys: number;
  /** Maximum total results to load (batchSize * maxPages) */
  maxResults: number;
}

export interface TileSizeConfig {
  /** Minimum tile width in pixels */
  minWidth: number;
  /** Maximum tile width in pixels */
  maxWidth: number;
  /** Minimum tile height in pixels */
  minHeight: number;
  /** Maximum tile height in pixels */
  maxHeight: number;
}

export interface TileConfig {
  pagination?: TilePaginationConfig;
  size?: TileSizeConfig;
}

/**
 * Pagination configuration for search tiles
 * Simplified: Fixed batch size of 100, no limits on pagination
 * On refresh, only the first batch (100 results) is shown
 */
export const SEARCH_TILE_PAGINATION: TilePaginationConfig = {
  batchSize: 100, // Fixed batch size
  maxPages: 999, // No practical limit - users can paginate as much as they want
  maxPaginationKeys: 998, // No practical limit
  maxResults: 99900, // No practical limit (999 pages * 100 results)
};

/**
 * Default size configuration for all tiles (in pixels)
 */
export const DEFAULT_TILE_SIZE: TileSizeConfig = {
  minWidth: 200,
  maxWidth: 1200,
  minHeight: 200,
  maxHeight: 800,
};

/**
 * Tile-specific configurations
 * Maps tile type strings (as used in DashboardTile.type) to their configurations
 */
export const TILE_CONFIGS: Record<string, TileConfig> = {
  // Search tiles with pagination (all use SEARCH_TILE_PAGINATION)
  'lda_disclosures': {
    pagination: SEARCH_TILE_PAGINATION,
    size: DEFAULT_TILE_SIZE,
  },
  'congress_bills': {
    pagination: SEARCH_TILE_PAGINATION,
    size: DEFAULT_TILE_SIZE,
  },
  'govt_contracts': {
    pagination: SEARCH_TILE_PAGINATION,
    size: DEFAULT_TILE_SIZE,
  },
  'sec_search': {
    pagination: SEARCH_TILE_PAGINATION,
    size: DEFAULT_TILE_SIZE,
  },
  'politician_trades': {
    pagination: SEARCH_TILE_PAGINATION,
    size: DEFAULT_TILE_SIZE,
  },
  'stock_screener': {
    pagination: SEARCH_TILE_PAGINATION,
    size: DEFAULT_TILE_SIZE,
  },
  'news': {
    pagination: SEARCH_TILE_PAGINATION,
    size: DEFAULT_TILE_SIZE,
  },
  
  // Non-search tiles (no pagination config, only size)
  'stock': {
    size: DEFAULT_TILE_SIZE,
  },
  'crypto': {
    size: DEFAULT_TILE_SIZE,
  },
  'portfolio': {
    size: DEFAULT_TILE_SIZE,
  },
  'folder': {
    size: DEFAULT_TILE_SIZE,
  },
};

/**
 * Helper function to get pagination config for a tile
 */
export function getTilePaginationConfig(tileType: string): TilePaginationConfig | undefined {
  return TILE_CONFIGS[tileType]?.pagination;
}

/**
 * Helper function to get size config for a tile
 */
export function getTileSizeConfig(tileType: string): TileSizeConfig {
  return TILE_CONFIGS[tileType]?.size || DEFAULT_TILE_SIZE;
}

/**
 * Helper function to get batch size for a tile
 */
export function getTileBatchSize(tileType: string): number {
  return getTilePaginationConfig(tileType)?.batchSize || 100;
}

/**
 * Helper function to get max pages for a tile
 */
export function getTileMaxPages(tileType: string): number {
  return getTilePaginationConfig(tileType)?.maxPages || 4;
}

/**
 * Helper function to get max pagination keys for a tile
 */
export function getTileMaxPaginationKeys(tileType: string): number {
  return getTilePaginationConfig(tileType)?.maxPaginationKeys || 3;
}

/**
 * Helper function to get max results for a tile
 */
export function getTileMaxResults(tileType: string): number {
  return getTilePaginationConfig(tileType)?.maxResults || 99900;
}

