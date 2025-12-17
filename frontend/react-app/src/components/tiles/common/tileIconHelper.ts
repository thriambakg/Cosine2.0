import React from 'react';
import * as Icons from '@mui/icons-material';

/**
 * Get an icon component by name
 * @param iconName - The name of the Material-UI icon (e.g., 'TrendingUp', 'Dashboard')
 * @param defaultIcon - Default icon to use if iconName is not found
 * @returns The icon component
 */
export const getIconByName = (
  iconName?: string,
  defaultIcon: keyof typeof Icons = 'TrendingUp'
): React.ComponentType<any> => {
  if (!iconName) {
    return Icons[defaultIcon];
  }

  const IconComponent = Icons[iconName as keyof typeof Icons];
  return IconComponent || Icons[defaultIcon];
};

/**
 * Get the default icon for a tile type
 */
export const getDefaultIconForTileType = (tileType: string): keyof typeof Icons => {
  const iconMap: Record<string, keyof typeof Icons> = {
    crypto: 'CurrencyBitcoin',
    stock: 'TrendingUp',
    portfolio: 'AccountBalance',
    news: 'Article',
    stock_screener: 'FilterList',
    politician_trades: 'AccountBalance',
    sec_search: 'Description',
    govt_contracts: 'Description',
    congress_bills: 'Gavel',
    custom: 'AutoAwesome',
    chat_generated: 'Chat',
  };

  return iconMap[tileType] || 'Dashboard';
};

