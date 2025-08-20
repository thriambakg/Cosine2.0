import React from 'react';
import { Box, Typography } from '@mui/material';
import CryptoTile from './CryptoTile';

interface CryptoTile {
  id: string;
  symbol: string;
  timeframe: string;
  displayOptions: {
    showPrice: boolean;
    show24hChange: boolean;
    showAnnualReturn: boolean;
    showVolatility: boolean;
  };
  autoRefresh: boolean;
  isPinned: boolean;
  size: { width: number; height: number };
  position?: { x: number; y: number };
}

interface DashboardGridProps {
  tiles: CryptoTile[];
  onRemoveTile: (id: string) => void;
  onUpdateTile: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResizeTile: (id: string, size: { width: number; height: number }) => void;
}

const DashboardGrid: React.FC<DashboardGridProps> = ({
  tiles,
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
          No cryptocurrency tiles added yet
        </Typography>
        <Typography variant="body2" color="#6b7280">
          Click the "Add Tile" button to start building your dashboard
        </Typography>
      </Box>
    );
  }

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
          <CryptoTile
            id={tile.id}
            symbol={tile.symbol}
            timeframe={tile.timeframe}
            displayOptions={tile.displayOptions}
            autoRefresh={tile.autoRefresh}
            isPinned={tile.isPinned}
            size={tile.size}
            onRemove={onRemoveTile}
            onUpdate={onUpdateTile}
            onSettingsChange={onSettingsChange}
            onResize={onResizeTile}
          />
        </Box>
      ))}
    </Box>
  );
};

export default DashboardGrid;
