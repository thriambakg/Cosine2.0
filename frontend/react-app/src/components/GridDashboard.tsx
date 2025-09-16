import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Typography, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import { Analytics as AnalyticsIcon } from '@mui/icons-material';
import CryptoTile from './CryptoTile';
import StockTile from './StockTile';
import PlaceholderTile from './PlaceholderTile';
import { UnifiedTile, GridPosition, GridSize } from '../types/dashboardTypes';
import { getTileConfig, validateTileSize } from '../utils/tileConfig';
import TileDataParser from '../utils/TileDataParser';

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

interface SelectionState {
  selectedTiles: Set<string>;
  contextMenuAnchor: HTMLElement | null;
  contextMenuPosition: { x: number; y: number } | null;
}

const GRID_COLUMNS = 12; // Total grid columns
const GRID_CELL_SIZE = 80; // Size of each grid cell in pixels
const GRID_GAP = 16; // Gap between grid cells
const MAX_GRID_ROWS = 50; // Maximum grid rows (increased for flexibility)

const GridDashboard: React.FC<GridDashboardProps> = ({
  tiles,
  dashboardContext,
  onRemoveTile,
  onUpdateTile,
  onSettingsChange,
  onResizeTile,
  onMoveTile: _onMoveTile,
}) => {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragTileId: null,
    dragStart: { x: 0, y: 0 },
    currentPosition: null,
  });

  const [selectionState, setSelectionState] = useState<SelectionState>({
    selectedTiles: new Set(),
    contextMenuAnchor: null,
    contextMenuPosition: null,
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
      // Get tile-specific configuration
      const tileConfig = getTileConfig(tile.type);
      const defaultSize = tileConfig.sizeConstraints;
      
      // Convert legacy pixel size to grid size, or use tile-specific defaults
      let gridSize: GridSize = { 
        width: defaultSize.defaultWidth, 
        height: defaultSize.defaultHeight 
      };
      
      if (tile.size) {
        const pixelBasedSize = {
          width: Math.max(1, Math.round(tile.size.width / (GRID_CELL_SIZE + GRID_GAP))),
          height: Math.max(1, Math.round(tile.size.height / (GRID_CELL_SIZE + GRID_GAP))),
        };
        
        // Validate against tile-specific constraints
        gridSize = validateTileSize(tile.type, pixelBasedSize);
      }

      // Find available position by scanning the grid
      const occupiedCells = new Set<string>();
      propsMap.forEach((props, _tileId) => {
        for (let x = props.position.x; x < props.position.x + props.size.width; x++) {
          for (let y = props.position.y; y < props.position.y + props.size.height; y++) {
            occupiedCells.add(`${x},${y}`);
          }
        }
      });

      // Find first available position
      let foundPosition = false;
      for (let y = 0; y < MAX_GRID_ROWS && !foundPosition; y++) {
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
    const tileConfig = getTileConfig(tile.type);
    const defaultSize = tileConfig.sizeConstraints;
    
    return tileGridProps.get(tile.id) || { 
      position: { x: 0, y: 0 }, 
      size: { width: defaultSize.defaultWidth, height: defaultSize.defaultHeight } 
    };
  }, [tileGridProps]);

  // Check if a grid area is available
  const isAreaAvailable = useCallback((position: GridPosition, size: GridSize, excludeTileId?: string): boolean => {
    // Check bounds - allow flexible sizing within reasonable limits
    if (position.x < 0 || position.y < 0 || 
        position.x + size.width > GRID_COLUMNS || 
        position.y + size.height > MAX_GRID_ROWS) {
      return false;
    }

    // Check for overlaps with other tiles
    for (const tile of tiles) {
      if (tile.id === excludeTileId) continue;
      
      const { position: tilePos, size: tileSize } = getDefaultGridProps(tile);
      
      // Check if rectangles overlap (improved logic)
      const overlapX = position.x < tilePos.x + tileSize.width && position.x + size.width > tilePos.x;
      const overlapY = position.y < tilePos.y + tileSize.height && position.y + size.height > tilePos.y;
      
      if (overlapX && overlapY) {
        return false;
      }
    }

    return true;
  }, [tiles, getDefaultGridProps]);

  // Handle drag start
  const handleDragStart = useCallback((tileId: string, event: React.MouseEvent) => {
    event.preventDefault();
    console.log('🖱️ Drag start for tile:', tileId);
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) {
      console.log('❌ Tile not found:', tileId);
      return;
    }

    const { position } = getDefaultGridProps(tile);
    console.log('📍 Starting drag from position:', position);
    
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

      // Only update if position actually changed
      if (dragState.currentPosition?.x !== constrainedPos.x || dragState.currentPosition?.y !== constrainedPos.y) {
        console.log('🔄 Updating drag position to:', constrainedPos);
        setDragState(prev => ({
          ...prev,
          currentPosition: constrainedPos,
        }));
      }
    }
  }, [dragState, tiles, getDefaultGridProps]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    console.log('🏁 Drag end:', dragState);
    if (!dragState.isDragging || !dragState.dragTileId || !dragState.currentPosition) return;

    const tile = tiles.find(t => t.id === dragState.dragTileId);
    if (tile) {
      const { size } = getDefaultGridProps(tile);
      
      console.log('🔍 Checking if position is available:', {
        position: dragState.currentPosition,
        size,
        tileId: dragState.dragTileId
      });
      
      // Check if the new position is available
      if (isAreaAvailable(dragState.currentPosition, size, dragState.dragTileId)) {
        console.log('✅ Position available, updating tile');
        // Update the tile's grid position
        onUpdateTile(dragState.dragTileId, {
          gridPosition: dragState.currentPosition,
          // Also update legacy position for backward compatibility
          position: {
            x: dragState.currentPosition.x * (GRID_CELL_SIZE + GRID_GAP),
            y: dragState.currentPosition.y * (GRID_CELL_SIZE + GRID_GAP),
          }
        });
        console.log('✅ Tile moved successfully to:', dragState.currentPosition);
      } else {
        console.log('❌ Position not available, reverting');
      }
    }

    setDragState({
      isDragging: false,
      dragTileId: null,
      dragStart: { x: 0, y: 0 },
      currentPosition: null,
    });
  }, [dragState, tiles, getDefaultGridProps, isAreaAvailable, onUpdateTile]);

  // Handle resize start
  const handleResizeStart = useCallback((tileId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    console.log('🔧 Resize start for tile:', tileId);
    
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) {
      console.log('❌ Tile not found for resize:', tileId);
      return;
    }

    const { size } = getDefaultGridProps(tile);
    console.log('📏 Starting resize with size:', size);
    
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

    // Get tile-specific size constraints
    const currentTile = tiles.find(tile => tile.id === resizeState.resizeTileId);
    if (!currentTile) return;
    
    const tileConfig = getTileConfig(currentTile.type);
    const constraints = tileConfig.sizeConstraints;
    
    const newSize = {
      width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, (resizeState.currentSize?.width || constraints.defaultWidth) + gridDeltaX)),
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, (resizeState.currentSize?.height || constraints.defaultHeight) + gridDeltaY)),
    };

    console.log('📏 Resize move:', { deltaX, deltaY, gridDeltaX, gridDeltaY, newSize });

    setResizeState(prev => ({
      ...prev,
      previewSize: newSize,
    }));
  }, [resizeState]);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    console.log('🏁 Resize end:', resizeState);
    if (!resizeState.isResizing || !resizeState.resizeTileId || !resizeState.previewSize) return;

    const tile = tiles.find(t => t.id === resizeState.resizeTileId);
    if (tile) {
      const { position } = getDefaultGridProps(tile);
      
      console.log('🔍 Checking if resize fits:', {
        position,
        newSize: resizeState.previewSize,
        tileId: resizeState.resizeTileId
      });
      
      // Check if the new size fits
      if (isAreaAvailable(position, resizeState.previewSize, resizeState.resizeTileId)) {
        console.log('✅ Resize fits, updating tile');
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
        console.log('✅ Tile resized successfully to:', resizeState.previewSize);
      } else {
        console.log('❌ Resize would cause overlap, reverting');
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


  // Tile selection handlers
  const handleTileSelection = useCallback((tileId: string, selected: boolean) => {
    setSelectionState(prev => {
      const newSelectedTiles = new Set(prev.selectedTiles);
      if (selected) {
        newSelectedTiles.add(tileId);
      } else {
        newSelectedTiles.delete(tileId);
      }
      
      return {
        ...prev,
        selectedTiles: newSelectedTiles
      };
    });
  }, []); // Remove the dependency array - use the functional update pattern

  // Grid context menu handlers
  const handleGridContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setSelectionState(prev => ({
      ...prev,
      contextMenuAnchor: event.currentTarget as HTMLElement,
      contextMenuPosition: { x: event.clientX, y: event.clientY }
    }));
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setSelectionState(prev => ({
      ...prev,
      contextMenuAnchor: null,
      contextMenuPosition: null
    }));
  }, []);

  // Perform analysis on selected tiles
  const handlePerformAnalysis = useCallback(() => {
    const selectedTilesArray = Array.from(selectionState.selectedTiles);
    console.log('🔍 Analysis Debug - Selected tiles array:', selectedTilesArray);
    console.log('🔍 Analysis Debug - Selection state:', selectionState.selectedTiles);
    console.log('🔍 Analysis Debug - Available tiles:', tiles.map(t => ({ id: t.id, type: t.type })));
    
    if (selectedTilesArray.length === 0) {
      console.log('No tiles selected for analysis');
      return;
    }

    // Get selected tiles data
    const selectedTilesData = tiles.filter(tile => selectionState.selectedTiles.has(tile.id));
    console.log('🔍 Analysis Debug - Selected tiles data:', selectedTilesData);
    
    // Extract data using TileDataParser (configuration-based extraction)
    const extractedData: Record<string, any> = {};
    selectedTilesData.forEach(tile => {
      extractedData[tile.id] = TileDataParser.extractTileConfigData(tile);
    });
    
    // Format for AI consumption
    const formattedData = TileDataParser.formatForAI(extractedData);
    
    // Log the data structure (for now, until AI agent is ready)
    console.log('=== TILE ANALYSIS DATA ===');
    console.log(`Selected ${selectedTilesArray.length} tiles for analysis:`);
    console.log('Formatted data structure:', formattedData);
    console.log('Raw extracted data:', extractedData);
    
    // Close context menu
    handleContextMenuClose();
  }, [selectionState.selectedTiles, tiles, handleContextMenuClose]);

  // Render tile with grid positioning
  const renderTile = (tile: UnifiedTile) => {
    const { position, size } = getDefaultGridProps(tile);

    // Check if this tile is being dragged
    const isDragging = dragState.dragTileId === tile.id;
    
    // Use drag preview position if dragging, otherwise use original position
    const displayPosition = isDragging && dragState.currentPosition 
      ? dragState.currentPosition 
      : position;

    // Check if this tile is being resized
    const isResizing = resizeState.resizeTileId === tile.id;
    const displaySize = isResizing && resizeState.previewSize
      ? resizeState.previewSize
      : size;

    const isTileSelected = selectionState.selectedTiles.has(tile.id);
    
    
    const tileProps = {
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
      isSelected: isTileSelected,
      onSelectionChange: handleTileSelection,
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
          <CryptoTile key={tile.id} {...tileProps} />
        ) : tile.type === 'stock' ? (
          <StockTile key={tile.id} {...tileProps} />
        ) : (
          <PlaceholderTile
            key={tile.id}
            tile={tile}
            onRemove={onRemoveTile}
            onUpdate={onUpdateTile}
            onSettingsChange={onSettingsChange}
            onResize={onResizeTile}
            isSelected={tileProps.isSelected}
            onSelectionChange={handleTileSelection}
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
            opacity: isResizing ? 1 : 0.6, // Make it more visible
            transition: 'opacity 0.2s ease',
            '&:hover': {
              opacity: 1,
            },
          }}
          onMouseDown={(e) => {
            console.log('🖱️ Resize handle clicked for tile:', tile.id);
            handleResizeStart(tile.id, e);
          }}
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
    <>
      <Box
        ref={containerRef}
        onContextMenu={handleGridContextMenu}
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

      {/* Grid Context Menu */}
      <Menu
        anchorEl={selectionState.contextMenuAnchor}
        open={Boolean(selectionState.contextMenuAnchor)}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={selectionState.contextMenuPosition ? {
          top: selectionState.contextMenuPosition.y,
          left: selectionState.contextMenuPosition.x
        } : undefined}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
            color: 'white',
            minWidth: 200,
          },
        }}
      >
        <MenuItem onClick={handlePerformAnalysis} disabled={selectionState.selectedTiles.size === 0}>
          <ListItemIcon>
            <AnalyticsIcon sx={{ color: '#10b981' }} />
          </ListItemIcon>
          <ListItemText>
            Perform Analysis ({selectionState.selectedTiles.size} selected)
          </ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

export default GridDashboard;