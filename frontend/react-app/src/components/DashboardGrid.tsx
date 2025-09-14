import React from 'react';
import { Box, Typography } from '@mui/material';
import CryptoTile from './CryptoTile';
import StockTile from './StockTile';
import PlaceholderTile from './PlaceholderTile';
import { UnifiedTile } from '../types/dashboardTypes';

interface DashboardGridProps {
  tiles: UnifiedTile[];
  dashboardContext?: string; // Add dashboard context for cache isolation
  onRemoveTile: (id: string) => void;
  onUpdateTile: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResizeTile: (id: string, size: { width: number; height: number }) => void;
}

const DashboardGrid: React.FC<DashboardGridProps> = ({
  tiles,
  dashboardContext,
  onRemoveTile,
  onUpdateTile,
  onSettingsChange,
  onResizeTile,
}) => {
  // Sort tiles: pinned first, then by creation order
  const sortedTiles = [...tiles].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  if (tiles.length === 0) {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          background: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid #374151',
          borderRadius: '0px',
        }}
      >
        <Typography variant="h6" color="#9ca3af" sx={{ mb: 2 }}>
          No tiles added yet
        </Typography>
        <Typography variant="body2" color="#6b7280">
          Click the "Add Tile" button to start building your dashboard
        </Typography>
      </Box>
    );
  }

  const renderTile = (tile: UnifiedTile) => {
    switch (tile.type) {
      case 'crypto':
        return (
          <CryptoTile
            key={tile.id}
            id={tile.id}
            symbol={tile.symbol || 'BTC'}
            timeframe={tile.timeframe || '1d'}
            size={tile.size}
            dashboardContext={dashboardContext}
            onRemove={onRemoveTile}
            onUpdate={onUpdateTile}
            onSettingsChange={onSettingsChange}
            onResize={onResizeTile}
          />
        );
      case 'stock':
        return (
          <StockTile
            key={tile.id}
            id={tile.id}
            symbol={tile.symbol || 'AAPL'}
            timeframe={tile.timeframe || '1d'}
            size={tile.size}
            dashboardContext={dashboardContext}
            onRemove={onRemoveTile}
            onUpdate={onUpdateTile}
            onSettingsChange={onSettingsChange}
            onResize={onResizeTile}
          />
        );
      default:
        return (
          <PlaceholderTile
            key={tile.id}
            tile={tile}
            onRemove={onRemoveTile}
            onUpdate={onUpdateTile}
            onSettingsChange={onSettingsChange}
            onResize={onResizeTile}
          />
        );
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 3,
        alignItems: 'flex-start',
      }}
    >
      {sortedTiles.map((tile) => (
        <Box key={tile.id}>
          {renderTile(tile)}
        </Box>
      ))}
    </Box>
  );
};

export default DashboardGrid;
