// Tile Configuration Utility
// Defines size constraints and default properties for each tile type

import { TileSizeConstraints } from '../../types/dashboardTypes';

export interface TileTypeConfig {
  sizeConstraints: TileSizeConstraints;
  defaultDisplayOptions: Record<string, any>;
  supportsResize: boolean;
  supportsDrag: boolean;
}

// Tile size constraints for each tile type
export const TILE_CONFIGS: Record<string, TileTypeConfig> = {
  stock: {
    sizeConstraints: {
      minWidth: 3,
      maxWidth: 6,
      minHeight: 4,
      maxHeight: 4,
      defaultWidth: 4,
      defaultHeight: 4,
    },
    defaultDisplayOptions: {
      showChart: true,
      showStats: true,
      chartType: 'line',
    },
    supportsResize: true,
    supportsDrag: true,
  },
  crypto: {
    sizeConstraints: {
      minWidth: 3,
      maxWidth: 6,
      minHeight: 4,
      maxHeight: 4,
      defaultWidth: 4,
      defaultHeight: 4,
    },
    defaultDisplayOptions: {
      showChart: true,
      showStats: true,
      chartType: 'line',
    },
    supportsResize: true,
    supportsDrag: true,
  },
  portfolio: {
    sizeConstraints: {
      minWidth: 3,
      maxWidth: 10,
      minHeight: 4,
      maxHeight: 12,
      defaultWidth: 6,
      defaultHeight: 6,
    },
    defaultDisplayOptions: {
      showHoldings: true,
      showPerformance: true,
      showAllocation: false,
    },
    supportsResize: true,
    supportsDrag: true,
  },
  custom: {
    sizeConstraints: {
      minWidth: 1,
      maxWidth: 12,
      minHeight: 1,
      maxHeight: 20,
      defaultWidth: 3,
      defaultHeight: 3,
    },
    defaultDisplayOptions: {
      backgroundColor: '#1e293b',
      textColor: '#ffffff',
    },
    supportsResize: true,
    supportsDrag: true,
  },
  chat_generated: {
    sizeConstraints: {
      minWidth: 2,
      maxWidth: 12,
      minHeight: 2,
      maxHeight: 15,
      defaultWidth: 4,
      defaultHeight: 4,
    },
    defaultDisplayOptions: {
      showTimestamp: true,
      showSource: true,
    },
    supportsResize: true,
    supportsDrag: true,
  },
  stock_screener: {
    sizeConstraints: {
      minWidth: 4,
      maxWidth: 8,
      minHeight: 4,
      maxHeight: 8,
      defaultWidth: 6,
      defaultHeight: 6,
    },
    defaultDisplayOptions: {
      showIndustry: true,
      showMarketCap: true,
      showVolatility: true,
      showPriceChange: true,
      showPERatio: true,
      showDividendYield: true,
      showResultsTable: true,
      showCriteriaSummary: true,
      maxResults: 100000,
    },
    supportsResize: true,
    supportsDrag: true,
  },
  news: {
    sizeConstraints: {
      minWidth: 4,
      maxWidth: 6,
      minHeight: 4,
      maxHeight: 8,
      defaultWidth: 4,
      defaultHeight: 6,
    },
    defaultDisplayOptions: {
      showImages: true,
      showSource: true,
      showDate: true,
      showKeywords: false,
      maxResults: 20,
      compactView: false,
    },
    supportsResize: true,
    supportsDrag: true,
  },
  politician_trades: {
    sizeConstraints: {
      minWidth: 4,
      maxWidth: 10,
      minHeight: 4,
      maxHeight: 10,
      defaultWidth: 6,
      defaultHeight: 6,
    },
    defaultDisplayOptions: {
      showPolitician: true,
      showParty: true,
      showPosition: true,
      showSecurity: true,
      showTransactionType: true,
      showAmount: true,
      showDate: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
    },
    supportsResize: true,
    supportsDrag: true,
  },
  sec_search: {
    sizeConstraints: {
      minWidth: 4,
      maxWidth: 10,
      minHeight: 4,
      maxHeight: 10,
      defaultWidth: 6,
      defaultHeight: 6,
    },
    defaultDisplayOptions: {
      showEntity: true,
      showForm: true,
      showFilingDate: true,
      showLocation: true,
      showIncorporation: true,
      showCIK: true,
      showFile: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
    },
    supportsResize: true,
    supportsDrag: true,
  },
};

// Get tile configuration for a specific tile type
export const getTileConfig = (tileType: string): TileTypeConfig => {
  return TILE_CONFIGS[tileType] || TILE_CONFIGS.custom;
};

// Get default size for a tile type
export const getDefaultTileSize = (tileType: string): { width: number; height: number } => {
  const config = getTileConfig(tileType);
  return {
    width: config.sizeConstraints.defaultWidth,
    height: config.sizeConstraints.defaultHeight,
  };
};

// Validate tile size against constraints
export const validateTileSize = (
  tileType: string,
  size: { width: number; height: number }
): { width: number; height: number } => {
  const config = getTileConfig(tileType);
  const constraints = config.sizeConstraints;
  
  return {
    width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, size.width)),
    height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, size.height)),
  };
};

// Check if a tile type supports resize
export const supportsResize = (tileType: string): boolean => {
  return getTileConfig(tileType).supportsResize;
};

// Check if a tile type supports drag
export const supportsDrag = (tileType: string): boolean => {
  return getTileConfig(tileType).supportsDrag;
};

// Get all supported tile types
export const getSupportedTileTypes = (): string[] => {
  return Object.keys(TILE_CONFIGS);
};
