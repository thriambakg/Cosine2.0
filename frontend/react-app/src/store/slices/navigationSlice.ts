import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface NavigationItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  category?: string;
  badge?: string | number;
  disabled?: boolean;
}

interface NavigationState {
  isSidebarOpen: boolean;
  currentPage: string;
  navigationItems: NavigationItem[];
  recentPages: string[];
  breadcrumbs: { label: string; path: string }[];
}

const defaultNavigationItems: NavigationItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: 'DashboardIcon',
    category: 'main'
  },
  {
    id: 'chat',
    label: 'AI Chat',
    path: '/chat',
    icon: 'ChatIcon',
    category: 'main'
  },
  {
    id: 'files',
    label: 'Files',
    path: '/files',
    icon: 'FolderIcon',
    category: 'main'
  },
  {
    id: 'robinhood',
    label: 'Robinhood',
    path: '/robinhood',
    icon: 'AccountBalanceWalletIcon',
    category: 'portfolio'
  },
  {
    id: 'portfolio-risk',
    label: 'Portfolio Risk',
    path: '/portfolio-risk',
    icon: 'AssessmentIcon',
    category: 'portfolio'
  },
  {
    id: 'stock-screener-search',
    label: 'Stock Screener',
    path: '/stock-screener-search',
    icon: 'TrendingUpIcon',
    category: 'portfolio'
  },
  {
    id: 'stock-volatility',
    label: 'Stock Volatility',
    path: '/stock-volatility',
    icon: 'TrendingUpIcon',
    category: 'analysis'
  },
  {
    id: 'stock-alerts',
    label: 'Stock Alerts',
    path: '/stock-alerts',
    icon: 'NotificationsIcon',
    category: 'analysis'
  },
  {
    id: 'option-pricing',
    label: 'Option Pricing',
    path: '/option-pricing',
    icon: 'CalculateIcon',
    category: 'analysis'
  },
  {
    id: 'heatmap',
    label: 'Market Heatmap',
    path: '/heatmap',
    icon: 'GridOnIcon',
    category: 'analysis'
  },
  {
    id: 'sec-search',
    label: 'SEC Search',
    path: '/sec-search',
    icon: 'DescriptionIcon',
    category: 'government_data'
  },
  {
    id: 'politician-trades-search',
    label: 'Politician Trades',
    path: '/politician-trades-search',
    icon: 'DescriptionIcon',
    category: 'government_data'
  },
  {
    id: 'govt-contracts-search',
    label: 'Government Contracts',
    path: '/govt-contracts-search',
    icon: 'DescriptionIcon',
    category: 'government_data'
  },
  {
    id: 'congress-bills-search',
    label: 'Congress Bills',
    path: '/congress-bills-search',
    icon: 'DescriptionIcon',
    category: 'government_data'
  },
  {
    id: 'lda-search',
    label: 'LDA Disclosures',
    path: '/lda-search',
    icon: 'DescriptionIcon',
    category: 'government_data'
  },
  {
    id: 'news-search',
    label: 'News Search',
    path: '/news-search',
    icon: 'ArticleIcon',
    category: 'news'
  }
];

const initialState: NavigationState = {
  isSidebarOpen: false,
  currentPage: '/',
  navigationItems: defaultNavigationItems,
  recentPages: [],
  breadcrumbs: [{ label: 'Dashboard', path: '/' }],
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.isSidebarOpen = !state.isSidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.isSidebarOpen = action.payload;
    },
    setCurrentPage: (state, action: PayloadAction<string>) => {
      const previousPage = state.currentPage;
      state.currentPage = action.payload;
      
      // Add to recent pages if it's not already there and not the same as current
      if (previousPage !== action.payload && !state.recentPages.includes(previousPage)) {
        state.recentPages.unshift(previousPage);
        // Keep only last 5 recent pages
        if (state.recentPages.length > 5) {
          state.recentPages = state.recentPages.slice(0, 5);
        }
      }

      // Update breadcrumbs based on current page
      const currentItem = state.navigationItems.find(item => item.path === action.payload);
      if (currentItem && action.payload !== '/') {
        state.breadcrumbs = [
          { label: 'Dashboard', path: '/' },
          { label: currentItem.label, path: currentItem.path }
        ];
      } else if (action.payload === '/') {
        state.breadcrumbs = [{ label: 'Dashboard', path: '/' }];
      }
    },
    setBreadcrumbs: (state, action: PayloadAction<{ label: string; path: string }[]>) => {
      state.breadcrumbs = action.payload;
    },
    updateNavigationBadge: (state, action: PayloadAction<{ itemId: string; badge: string | number }>) => {
      const item = state.navigationItems.find(item => item.id === action.payload.itemId);
      if (item) {
        item.badge = action.payload.badge;
      }
    },
    clearNavigationBadge: (state, action: PayloadAction<string>) => {
      const item = state.navigationItems.find(item => item.id === action.payload);
      if (item) {
        item.badge = undefined;
      }
    },
    setNavigationItemDisabled: (state, action: PayloadAction<{ itemId: string; disabled: boolean }>) => {
      const item = state.navigationItems.find(item => item.id === action.payload.itemId);
      if (item) {
        item.disabled = action.payload.disabled;
      }
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  setCurrentPage,
  setBreadcrumbs,
  updateNavigationBadge,
  clearNavigationBadge,
  setNavigationItemDisabled,
} = navigationSlice.actions;

export default navigationSlice.reducer;
