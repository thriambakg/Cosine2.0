// Dashboard and Tab Management Types
import React from 'react';

// Simplified structure: Tab = Dashboard
export interface DashboardTab {
  id: string;
  name: string;
  color: string;
  isPinned: boolean;
  tiles: UnifiedTile[];
  layout: 'grid' | 'list' | 'custom';
  created_at: string;
  updated_at: string;
}

// Legacy interface for backward compatibility (deprecated)
export interface Dashboard {
  id: string;
  name: string;
  tiles: UnifiedTile[];
  layout: 'grid' | 'list' | 'custom';
  created_at: string;
  updated_at: string;
  isDefault: boolean;
  isPinned?: boolean;
  tabId?: string; // Associated tab ID
}

export interface DashboardGroup {
  id: string;
  name: string;
  color: string;
  tabs: string[]; // Tab IDs
  tabIds?: string[]; // Alternative property name for compatibility
  collapsed: boolean;
  position: number;
  created_at?: string; // Creation timestamp
}

export interface GridPosition {
  x: number; // Grid column (0-based)
  y: number; // Grid row (0-based)
}

export interface GridSize {
  width: number; // Number of grid columns (1, 2, 3, 4, etc.)
  height: number; // Number of grid rows (1, 2, 3, 4, etc.)
}

export interface TileSizeConstraints {
  minWidth: number; // Minimum grid columns
  maxWidth: number; // Maximum grid columns
  minHeight: number; // Minimum grid rows
  maxHeight: number; // Maximum grid rows
  defaultWidth: number; // Default grid columns
  defaultHeight: number; // Default grid rows
}

export interface UnifiedTile {
  id: string;
  type: 'crypto' | 'stock' | 'portfolio' | 'custom' | 'chat_generated' | 'stock_screener' | 'news' | 'politician_trades' | 'sec_search' | 'govt_contracts' | 'congress_bills' | 'lda_disclosures' | 'folder';
  title: string;
  customTitle?: string; // Custom tile name set by user
  customColor?: string; // Custom tile color (for header/icon)
  customIcon?: string; // Custom icon name (Material-UI icon name)
  symbol?: string; // For crypto/stock tiles
  timeframe?: string; // For crypto/stock tiles
  name?: string; // For portfolio tiles
  content?: string; // For custom tiles
  prompt?: string; // For chat_generated tiles
  folderPath?: string; // For folder tiles - path to the folder to display
  folderId?: string; // For folder tiles - ID of the folder to display
  criteria?: StockScreenerCriteria; // For stock_screener tiles
  results?: any[]; // Search/list tiles: StockResult[] (stock_screener), SECSearchResult[] (sec_search), etc.
  filters?: NewsFilters; // For news tiles
  articles?: NewsArticle[]; // For news tiles
  filterSettings?: { // For news tiles and LDA tiles - client-side filtering settings
    // News tile filter settings
    sources?: string[];
    categories?: string[];
    countries?: string[];
    // LDA tile filter settings
    registrants?: string[];
    clients?: string[];
    lobbyists?: string[];
    filingTypes?: string[];
    issueCodes?: string[];
    states?: string[];
  };
  searchParams?: any; // For politician_trades tiles - keeping flexible for now
  trades?: any[]; // For politician_trades tiles - keeping flexible for now
  portfolioData?: { // For portfolio tiles
    entries: Array<{ stock: string; shares: number }>;
    results: any;
    timeframe: string;
    isExpanded: boolean;
  };
  displayOptions: {
    [key: string]: any; // Flexible display options for different tile types
  };
  paginationState?: { // For search tiles - pagination state persistence
    totalResultsLoaded: number;
    lastEvaluatedKeys: any[];
    hasMore: boolean;
  };
  autoRefresh: boolean;
  isPinned: boolean;
  size: { width: number; height: number }; // Legacy pixel-based size
  position?: { x: number; y: number }; // Legacy pixel-based position
  gridPosition?: GridPosition; // New grid-based position
  gridSize?: GridSize; // New grid-based size
  created_at?: string;
  dashboard_id: string;
}

// Stock Screener specific interfaces
export interface StockScreenerCriteria {
  industries: string[];
  volatilityRange: [number, number];
  priceChangeRange: [number, number];
  marketCapRange: [number, number];
  priceRange: [number, number];
  peRatioRange: [number, number];
  dividendYieldRange: [number, number];
  timeframe: string;
}

export interface StockResult {
  symbol: string;
  name: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  marketCap: number;
  volatility: number;
  industry: string;
  sector?: string;
  volume: number;
  pe: number;
  // Additional fields from EOD aggregator
  current_price?: number;  // Backend compatibility
  price_change_percent?: number;  // Backend compatibility
  market_cap?: number;  // Backend compatibility
  week_return?: number;
  weekReturn?: number;
  shares_outstanding?: number;
  day_high?: number;
  day_low?: number;
  year_high?: number;
  year_low?: number;
  previous_close?: number;
  price_change?: number;
  avg_volume?: number;
  pe_ratio?: number;
  eps?: number;
  dividend_yield?: number;
  beta?: number;
  data_source?: string;
  last_updated?: string;
}

// News specific interfaces
export interface NewsFilters {
  keywords: string[];
  keywordExpression: Array<{ type: 'keyword' | 'operator' | 'group', value: string | any[] }>; // Expression-based keywords
  sourceExpression: Array<{ type: 'source' | 'operator' | 'group', value: string | any[] }>; // Expression-based sources
  categoryExpression: Array<{ type: 'category' | 'operator' | 'group', value: string | any[] }>; // Expression-based categories
  countryExpression: Array<{ type: 'country' | 'operator' | 'group', value: string | any[] }>; // Expression-based countries
  dateRange: string;
  // Legacy arrays for backward compatibility
  sources: string[];
  categories: string[];
  countries: string[];
  // Query operators (legacy)
  keywordOperator: 'AND' | 'OR';
  categoryOperator: 'AND' | 'OR';
  sourceOperator: 'AND' | 'OR';
  countryOperator: 'AND' | 'OR';
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  source_url: string;
  source_name: string;
  published_date: string;
  keywords: string;
  category: string;
  image_url?: string;
  sentiment: string;
  ai_tag: string;
  country: string;
  language: string;
  creator: string;
}

export interface TabManagementState {
  tabs: DashboardTab[];
  tabGroups: DashboardGroup[];
  activeTabId: string | null;
  last_updated: string;
  // Legacy fields for backward compatibility (deprecated)
  dashboards?: Dashboard[];
  nextTabId?: number;
  nextGroupId?: number;
  created_at?: string;
}

export interface TabContextMenuAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: (tabId: string) => void;
  disabled?: boolean;
}

export interface NewTabOptions {
  name?: string;
  dashboardId?: string;
  groupId?: string;
  position?: number;
  isPinned?: boolean;
}

// Tile category definitions for AddTileMenu
export interface TileSubcategory {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  tiles: TileTypeDefinition[];
}

export interface TileCategory {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  subcategories: TileSubcategory[];
}

// Tile type definitions for the selection interface
export interface TileTypeDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  icon: React.ReactNode;
  color: string;
  isAvailable: boolean;
  placeholder?: boolean; // For tiles not yet implemented
  previewImage?: string; // URL or path to preview image
}
