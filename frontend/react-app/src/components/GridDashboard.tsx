import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import CryptoTile from './CryptoTile';
import StockTile from './StockTile';
import PlaceholderTile from './PlaceholderTile';
import { UnifiedTile, GridPosition, GridSize } from '../types/dashboardTypes';

interface GridDashboardProps {
  tiles: UnifiedTile[];
  dashboardContext?: string;
  onRemoveTile: (id: string) => void;
  onUpdateTile: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResizeTile: (id: string, size: { width: number; height: number }) => void;
  onMoveTile: (id: string, position: GridPosition) => void;
}

interface DragState {
  isDragging: boolean;
  dragTileId: string | null;
  dragStart: { x: number; y: number };
  currentPosition: GridPosition | null;
}

interface ResizeState {
  isResizing: boolean;
  resizeTileId: string | null;
  resizeStart: { x: number; y: number };
  currentSize: GridSize | null;
  previewSize: GridSize | null;
}

const GRID_COLUMNS = 12; // Total grid columns
const GRID_CELL_SIZE = 80; // Size of each grid cell in pixels
const GRID_GAP = 16; // Gap between grid cells

const GridDashboard: React.FC<GridDashboardProps> = ({
  tiles,
  dashboardContext,
  onRemoveTile,
  onUpdateTile,
  onSettingsChange,
  onResizeTile,
  onMoveTile,
}) => {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragTileId: null,
    dragStart: { x: 0, y: 0 },
    currentPosition: null,
  });

  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    resizeTileId: null,
    resizeStart: { x: 0, y: 0 },
    currentSize: null,
    previewSize: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize grid props for all tiles to prevent unnecessary recalculations
  const tileGridProps = useMemo(() => {
    const propsMap = new Map<string, { position: GridPosition; size: GridSize }>();
    
    // First pass: collect all tiles with existing grid props
    const tilesWithGridProps = tiles.filter(tile => tile.gridPosition && tile.gridSize);
    tilesWithGridProps.forEach(tile => {
      propsMap.set(tile.id, {
        position: tile.gridPosition!,
        size: tile.gridSize!
      });
    });

    // Second pass: calculate positions for tiles without grid props
    const tilesWithoutGridProps = tiles.filter(tile => !tile.gridPosition || !tile.gridSize);
    
    tilesWithoutGridProps.forEach(tile => {
      // Convert legacy pixel size to grid size
      let gridSize: GridSize = { width: 1, height: 1 };
      if (tile.size) {
        gridSize = {
          width: Math.max(1, Math.round(tile.size.width / (GRID_CELL_SIZE + GRID_GAP))),
          height: Math.max(1, Math.round(tile.size.height / (GRID_CELL_SIZE + GRID_GAP))),
        };
      }

      // Find available position by scanning the grid
      const occupiedCells = new Set<string>();
      propsMap.forEach((props, tileId) => {
        for (let x = props.position.x; x < props.position.x + props.size.width; x++) {
          for (let y = props.position.y; y < props.position.y + props.size.height; y++) {
            occupiedCells.add(`${x},${y}`);
          }
        }
      });

      // Find first available position
      let foundPosition = false;
      for (let y = 0; y < 20 && !foundPosition; y++) { // Max 20 rows
        for (let x = 0; x < GRID_COLUMNS - gridSize.width + 1 && !foundPosition; x++) {
          let canPlace = true;
          for (let dx = 0; dx < gridSize.width; dx++) {
            for (let dy = 0; dy < gridSize.height; dy++) {
              if (occupiedCells.has(`${x + dx},${y + dy}`)) {
                canPlace = false;
                break;
              }
            }
            if (!canPlace) break;
          }
          if (canPlace) {
            propsMap.set(tile.id, { position: { x, y }, size: gridSize });
            foundPosition = true;
          }
        }
      }

      if (!foundPosition) {
        propsMap.set(tile.id, { position: { x: 0, y: 0 }, size: gridSize });
      }
    });

    return propsMap;
  }, [tiles]);

  // Get default grid position and size for a tile
  const getDefaultGridProps = useCallback((tile: UnifiedTile): { position: GridPosition; size: GridSize } => {
    return tileGridProps.get(tile.id) || { position: { x: 0, y: 0 }, size: { width: 1, height: 1 } };
  }, [tileGridProps]);

  // Check if a grid area is available
  const isAreaAvailable = useCallback((position: GridPosition, size: GridSize, excludeTileId?: string): boolean => {
    // Check bounds
    if (position.x < 0 || position.y < 0 || 
        position.x + size.width > GRID_COLUMNS || 
        position.y + size.height > 20) {
      return false;
    }

    // Check for overlaps with other tiles
    for (const tile of tiles) {
      if (tile.id === excludeTileId) continue;
      
      const { position: tilePos, size: tileSize } = getDefaultGridProps(tile);
      
      // Check if rectangles overlap
      if (!(position.x >= tilePos.x + tileSize.width ||
            position.x + size.width <= tilePos.x ||
            position.y >= tilePos.y + tileSize.height ||
            position.y + size.height <= tilePos.y)) {
        return false;
      }
    }

    return true;
  }, [tiles, getDefaultGridProps]);

  // Handle drag start
  const handleDragStart = useCallback((tileId: string, event: React.MouseEvent) => {
    event.preventDefault();
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) return;

    const { position } = getDefaultGridProps(tile);
    
    setDragState({
      isDragging: true,
      dragTileId: tileId,
      dragStart: { x: event.clientX, y: event.clientY },
      currentPosition: position,
    });
  }, [tiles, getDefaultGridProps]);

  // Handle drag move
  const handleDragMove = useCallback((event: MouseEvent) => {
    if (!dragState.isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const relativeY = event.clientY - rect.top;

    // Convert to grid coordinates
    const gridX = Math.round(relativeX / (GRID_CELL_SIZE + GRID_GAP));
    const gridY = Math.round(relativeY / (GRID_CELL_SIZE + GRID_GAP));
    
    const tile = tiles.find(t => t.id === dragState.dragTileId);
    if (tile) {
      const { size } = getDefaultGridProps(tile);
      const constrainedPos = {
        x: Math.max(0, Math.min(gridX, GRID_COLUMNS - size.width)),
        y: Math.max(0, gridY),
      };

      setDragState(prev => ({
        ...prev,
        currentPosition: constrainedPos,
      }));
    }
  }, [dragState, tiles, getDefaultGridProps]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    if (!dragState.isDragging || !dragState.dragTileId || !dragState.currentPosition) return;

    const tile = tiles.find(t => t.id === dragState.dragTileId);
    if (tile) {
      const { size } = getDefaultGridProps(tile);
      
      // Check if the new position is available
      if (isAreaAvailable(dragState.currentPosition, size, dragState.dragTileId)) {
        onMoveTile(dragState.dragTileId, dragState.currentPosition);
      }
    }

    setDragState({
      isDragging: false,
      dragTileId: null,
      dragStart: { x: 0, y: 0 },
      currentPosition: null,
    });
  }, [dragState, tiles, getDefaultGridProps, isAreaAvailable, onMoveTile]);

  // Handle resize start
  const handleResizeStart = useCallback((tileId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) return;

    const { size } = getDefaultGridProps(tile);
    
    setResizeState({
      isResizing: true,
      resizeTileId: tileId,
      resizeStart: { x: event.clientX, y: event.clientY },
      currentSize: size,
      previewSize: size,
    });
  }, [tiles, getDefaultGridProps]);

  // Handle resize move
  const handleResizeMove = useCallback((event: MouseEvent) => {
    if (!resizeState.isResizing) return;

    const deltaX = event.clientX - resizeState.resizeStart.x;
    const deltaY = event.clientY - resizeState.resizeStart.y;

    // Convert delta to grid units
    const gridDeltaX = Math.round(deltaX / (GRID_CELL_SIZE + GRID_GAP));
    const gridDeltaY = Math.round(deltaY / (GRID_CELL_SIZE + GRID_GAP));

    const newSize = {
      width: Math.max(1, Math.min(4, (resizeState.currentSize?.width || 1) + gridDeltaX)),
      height: Math.max(1, Math.min(4, (resizeState.currentSize?.height || 1) + gridDeltaY)),
    };

    setResizeState(prev => ({
      ...prev,
      previewSize: newSize,
    }));
  }, [resizeState]);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    if (!resizeState.isResizing || !resizeState.resizeTileId || !resizeState.previewSize) return;

    const tile = tiles.find(t => t.id === resizeState.resizeTileId);
    if (tile) {
      const { position } = getDefaultGridProps(tile);
      
      // Check if the new size fits
      if (isAreaAvailable(position, resizeState.previewSize, resizeState.resizeTileId)) {
        // Update the tile with new grid size
        onUpdateTile(resizeState.resizeTileId, {
          gridSize: resizeState.previewSize,
        });
        
        // Also update legacy size for backward compatibility
        const pixelSize = {
          width: resizeState.previewSize.width * GRID_CELL_SIZE + (resizeState.previewSize.width - 1) * GRID_GAP,
          height: resizeState.previewSize.height * GRID_CELL_SIZE + (resizeState.previewSize.height - 1) * GRID_GAP,
        };
        onResizeTile(resizeState.resizeTileId, pixelSize);
      }
    }

    setResizeState({
      isResizing: false,
      resizeTileId: null,
      resizeStart: { x: 0, y: 0 },
      currentSize: null,
      previewSize: null,
    });
  }, [resizeState, tiles, getDefaultGridProps, isAreaAvailable, onUpdateTile, onResizeTile]);

  // Add event listeners for drag and resize
  useEffect(() => {
    if (dragState.isDragging) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [dragState.isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (resizeState.isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [resizeState.isResizing, handleResizeMove, handleResizeEnd]);

  // Render tile with grid positioning
  const renderTile = (tile: UnifiedTile) => {
    const { position, size } = getDefaultGridProps(tile);

    // Check if this tile is being dragged - if so, render at original position with reduced opacity
    const isDragging = dragState.dragTileId === tile.id;
    const displayPosition = position; // Always use original position for the actual tile

    // Check if this tile is being resized
    const isResizing = resizeState.resizeTileId === tile.id;
    const displaySize = isResizing && resizeState.previewSize
      ? resizeState.previewSize
      : size;

    const tileProps = {
      key: tile.id,
      id: tile.id,
      symbol: tile.symbol || 'BTC',
      timeframe: tile.timeframe || '1d',
      size: {
        width: displaySize.width * GRID_CELL_SIZE + (displaySize.width - 1) * GRID_GAP,
        height: displaySize.height * GRID_CELL_SIZE + (displaySize.height - 1) * GRID_GAP,
      },
      dashboardContext,
      onRemove: onRemoveTile,
      onUpdate: onUpdateTile,
      onSettingsChange: onSettingsChange,
      onResize: onResizeTile,
      onDragStart: (e: React.MouseEvent) => handleDragStart(tile.id, e),
      onResizeStart: (e: React.MouseEvent) => handleResizeStart(tile.id, e),
      isDragging,
      isResizing,
    };

    return (
      <Box
        key={tile.id}
        sx={{
          gridColumn: `${displayPosition.x + 1} / ${displayPosition.x + displaySize.width + 1}`,
          gridRow: `${displayPosition.y + 1} / ${displayPosition.y + displaySize.height + 1}`,
          position: 'relative',
          zIndex: isDragging || isResizing ? 1000 : 1,
          opacity: isDragging ? 0.3 : 1, // Make dragged tile very transparent
          transition: isDragging || isResizing ? 'none' : 'all 0.2s ease',
        }}
      >
        {tile.type === 'crypto' ? (
          <CryptoTile {...tileProps} />
        ) : tile.type === 'stock' ? (
          <StockTile {...tileProps} />
        ) : (
          <PlaceholderTile
            tile={tile}
            onRemove={onRemoveTile}
            onUpdate={onUpdateTile}
            onSettingsChange={onSettingsChange}
            onResize={onResizeTile}
          />
        )}
        
        {/* Resize handle */}
        <Box
          sx={{
            position: 'absolute',
            bottom: -4,
            right: -4,
            width: 12,
            height: 12,
            backgroundColor: '#3b82f6',
            borderRadius: '50%',
            cursor: 'nw-resize',
            opacity: isResizing ? 1 : 0,
            transition: 'opacity 0.2s ease',
            '&:hover': {
              opacity: 1,
            },
          }}
          onMouseDown={(e) => handleResizeStart(tile.id, e)}
        />
      </Box>
    );
  };

  // Render preview outline for resizing
  const renderResizePreview = () => {
    if (!resizeState.isResizing || !resizeState.previewSize || !resizeState.resizeTileId) return null;

    const tile = tiles.find(t => t.id === resizeState.resizeTileId);
    if (!tile) return null;

    const { position } = getDefaultGridProps(tile);

    return (
      <Box
        sx={{
          gridColumn: `${position.x + 1} / ${position.x + resizeState.previewSize.width + 1}`,
          gridRow: `${position.y + 1} / ${position.y + resizeState.previewSize.height + 1}`,
          border: '2px dashed #3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          pointerEvents: 'none',
          zIndex: 999,
        }}
      />
    );
  };

  // Render drag preview
  const renderDragPreview = () => {
    if (!dragState.isDragging || !dragState.currentPosition || !dragState.dragTileId) return null;

    const tile = tiles.find(t => t.id === dragState.dragTileId);
    if (!tile) return null;

    const { size } = getDefaultGridProps(tile);

    return (
      <Box
        sx={{
          gridColumn: `${dragState.currentPosition.x + 1} / ${dragState.currentPosition.x + size.width + 1}`,
          gridRow: `${dragState.currentPosition.y + 1} / ${dragState.currentPosition.y + size.height + 1}`,
          border: '2px dashed #f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          pointerEvents: 'none',
          zIndex: 998,
        }}
      />
    );
  };

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

  return (
    <Box
      ref={containerRef}
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, ${GRID_CELL_SIZE}px)`,
        gridAutoRows: `${GRID_CELL_SIZE}px`,
        gap: `${GRID_GAP}px`,
        minHeight: '600px',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.9) 100%)',
        border: '1px solid #374151',
        borderRadius: '8px',
        overflow: 'hidden',
        padding: '16px',
      }}
    >
      {/* Grid background */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          bottom: 16,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: `${GRID_CELL_SIZE + GRID_GAP}px ${GRID_CELL_SIZE + GRID_GAP}px`,
          opacity: 0.3,
          pointerEvents: 'none',
        }}
      />
      
      {/* Tiles */}
      {tiles.map(renderTile)}
      
      {/* Drag preview */}
      {renderDragPreview()}
      
      {/* Resize preview */}
      {renderResizePreview()}
    </Box>
  );
};

export default GridDashboard;