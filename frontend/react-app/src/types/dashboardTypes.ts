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

export interface UnifiedTile {
  id: string;
  type: 'crypto' | 'stock' | 'portfolio' | 'custom' | 'chat_generated';
  title: string;
  symbol?: string; // For crypto/stock tiles
  timeframe?: string; // For crypto/stock tiles
  displayOptions: {
    showPrice: boolean;
    show24hChange: boolean;
    showAnnualReturn: boolean;
    showVolatility: boolean;
    showChart: boolean;
  };
  autoRefresh: boolean;
  isPinned: boolean;
  size: { width: number; height: number };
  position?: { x: number; y: number };
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
