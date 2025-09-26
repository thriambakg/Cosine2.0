// Dashboard and Tab Management Types

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
  type: 'crypto' | 'stock' | 'portfolio' | 'custom' | 'chat_generated' | 'stock_screener' | 'news';
  title: string;
  symbol?: string; // For crypto/stock tiles
  timeframe?: string; // For crypto/stock tiles
  name?: string; // For portfolio tiles
  content?: string; // For custom tiles
  prompt?: string; // For chat_generated tiles
  criteria?: StockScreenerCriteria; // For stock_screener tiles
  results?: StockResult[]; // For stock_screener tiles
  filters?: NewsFilters; // For news tiles
  articles?: NewsArticle[]; // For news tiles
  displayOptions: {
    [key: string]: any; // Flexible display options for different tile types
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
  volume: number;
  pe: number;
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
  sentiment?: string;
  ai_tag?: string;
  country?: string;
  language?: string;
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
