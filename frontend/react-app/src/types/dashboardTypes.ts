// Dashboard and Tab Management Types

export interface Dashboard {
  id: string;
  name: string;
  tiles: UnifiedTile[];
  layout: 'grid' | 'list' | 'custom';
  created_at: string;
  updated_at: string;
  isDefault: boolean;
  isPinned?: boolean;
}

export interface DashboardTab {
  id: string;
  name: string;
  dashboardId: string;
  isActive: boolean;
  groupId?: string; // For tab grouping
  position: number;
  isPinned: boolean;
  isDirty?: boolean; // Has unsaved changes
  lastAccessed?: string;
  color?: string; // Tab color for visual distinction
}

export interface DashboardGroup {
  id: string;
  name: string;
  color: string;
  tabs: string[]; // Tab IDs
  collapsed: boolean;
  position: number;
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
  type: 'crypto' | 'stock' | 'portfolio' | 'custom' | 'chat_generated';
  title: string;
  symbol?: string; // For crypto/stock tiles
  timeframe?: string; // For crypto/stock tiles
  name?: string; // For portfolio tiles
  content?: string; // For custom tiles
  prompt?: string; // For chat_generated tiles
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

export interface TabManagementState {
  tabs: DashboardTab[];
  tabGroups: DashboardGroup[];
  activeTabId: string | null;
  dashboards: Dashboard[];
  nextTabId: number;
  nextGroupId: number;
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
