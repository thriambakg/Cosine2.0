import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Typography, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import { Chat as SidebarChatIcon, Folder as FolderIcon, ContentCopy, DeleteOutline } from '@mui/icons-material';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useAuth } from '@/contexts/AuthContext';
import { filesystemAPI, GovtContractAward, CongressBill } from '@/services/api';
import CryptoTile from '../tiles/CryptoTile';
import StockTile from '../tiles/StockTile';
import StockScreenerTile from '../tiles/StockScreenerTile';
import NewsTile from '../tiles/NewsTile';
import PortfolioTile from '../tiles/PortfolioTile';
import PoliticianTradesSearchTile from '../tiles/PoliticianTradesSearchTile';
import SECSearchTile from '../tiles/SECSearchTile';
import GovtContractsSearchTile from '../tiles/GovtContractsSearchTile';
import CongressBillsSearchTile from '../tiles/CongressBillsSearchTile';
import LDASearchTile from '../tiles/LDASearchTile';
import FolderTile from '../tiles/FolderTile';
import PlaceholderTile from '../tiles/PlaceholderTile';
import { UnifiedTile, GridPosition, GridSize } from '../../types/dashboardTypes';
import { getTileConfig, validateTileSize } from '../tiles/tileConfig';
import { addMultipleTilesToContext, extractTileData } from '../tiles/common';

interface GridDashboardProps {
  tiles: UnifiedTile[];
  dashboardContext?: string;
  onRemoveTile: (id: string) => void;
  onUpdateTile: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResizeTile: (id: string, size: { width: number; height: number }) => void;
  onMoveTile: (id: string, position: GridPosition) => void;
  onDuplicateTile?: (tileId: string) => void;
  onRemoveMultipleTiles?: (ids: string[]) => void;
  isDeletingTiles?: boolean;
  zoomLevel?: number;
}

interface DragState {
  isDragging: boolean;
  dragTileId: string | null;
  dragStart: { x: number; y: number };
  currentPosition: GridPosition | null;
  dragOffset?: { x: number; y: number }; // Offset from mouse to tile top-left
  lastUpdateTime?: number;
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

const GRID_CELL_SIZE = 80; // Size of each grid cell in pixels
const GRID_GAP = 16; // Gap between grid cells
const MAX_GRID_ROWS = 50; // Maximum grid rows (increased for flexibility)
const GRID_PADDING = 16; // Padding on each side of the grid
const MIN_GRID_COLUMNS = 10; // Minimum number of columns
const MAX_GRID_COLUMNS = 30; // Maximum number of columns for ultra-wide screens


const GridDashboard: React.FC<GridDashboardProps> = ({
  tiles,
  dashboardContext,
  onRemoveTile,
  onUpdateTile,
  onSettingsChange,
  onResizeTile,
  onMoveTile: _onMoveTile,
  onDuplicateTile,
  onRemoveMultipleTiles,
  isDeletingTiles = false,
  zoomLevel: zoomLevelProp = 1.0,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevTilesRef = useRef<UnifiedTile[]>([]);
  const [containerWidth, setContainerWidth] = useState(1200); // Default width
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragTileId: null,
    dragStart: { x: 0, y: 0 },
    currentPosition: null,
    dragOffset: undefined,
    lastUpdateTime: undefined,
  });

  const [selectionState, setSelectionState] = useState<SelectionState>({
    selectedTiles: new Set(),
    contextMenuAnchor: null,
    contextMenuPosition: null,
  });

  const { user } = useAuth();
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

  // State for responsive grid dimensions
  const [gridColumns, setGridColumns] = useState(12);
  const [cellSize, setCellSize] = useState(GRID_CELL_SIZE);
  
  // Use zoom level from props
  const zoomLevel = zoomLevelProp;

  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    resizeTileId: null,
    resizeStart: { x: 0, y: 0 },
    currentSize: null,
    previewSize: null,
  });

  // Resize observer to track container width changes
  useEffect(() => {
    const updateContainerWidth = () => {
      // Measure the scrollable container width (visible viewport)
      if (scrollContainerRef.current) {
        const newWidth = scrollContainerRef.current.clientWidth; // Use clientWidth to exclude scrollbar
        setContainerWidth(newWidth);
      }
    };

    // Initial measurement
    updateContainerWidth();

    // Create resize observer for the scrollable container
    const resizeObserver = new ResizeObserver(() => {
      updateContainerWidth();
    });
    
    if (scrollContainerRef.current) {
      resizeObserver.observe(scrollContainerRef.current);
    }

    // Listen to window resize events (including dev tools open/close)
    const handleWindowResize = () => {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(updateContainerWidth);
    };
    
    window.addEventListener('resize', handleWindowResize);
    
    // Also observe the document body for additional coverage
    const bodyObserver = new ResizeObserver(handleWindowResize);
    bodyObserver.observe(document.body);

    // Add a periodic check as a safety net (every 2 seconds)
    const periodicCheck = setInterval(() => {
      if (scrollContainerRef.current) {
        const currentWidth = scrollContainerRef.current.clientWidth;
        if (currentWidth !== containerWidth) {
          updateContainerWidth();
        }
      }
    }, 2000);

    return () => {
      resizeObserver.disconnect();
      bodyObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      clearInterval(periodicCheck);
    };
  }, [containerWidth]);

  // Calculate responsive grid columns based on container width
  const calculateGridColumns = useCallback((width: number) => {
    // Account for padding on both sides
    const availableWidth = width - (GRID_PADDING * 2);
    // Calculate how many columns fit, but use a more generous calculation
    // to ensure we fill the available space better
    const columns = Math.floor(availableWidth / (GRID_CELL_SIZE + GRID_GAP));
    // Constrain between min and max
    return Math.max(MIN_GRID_COLUMNS, Math.min(MAX_GRID_COLUMNS, columns));
  }, []);

  // Calculate actual cell size to fill the container width
  const calculateCellSize = useCallback((width: number, columns: number) => {
    const availableWidth = width - (GRID_PADDING * 2);
    const totalGapWidth = (columns - 1) * GRID_GAP;
    const cellSize = (availableWidth - totalGapWidth) / columns;
    return Math.max(60, Math.min(120, cellSize)); // Constrain between 60px and 120px
  }, []);

  // Handle window resize and calculate grid columns
  useEffect(() => {
    const updateGridDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newWidth = rect.width;
        const newColumns = calculateGridColumns(newWidth);
        const newCellSize = calculateCellSize(newWidth, newColumns);
        
        setGridColumns(newColumns);
        setCellSize(newCellSize);
        
        console.log('📐 Grid dimensions updated:', {
          width: newWidth,
          columns: newColumns,
          cellSize: newCellSize,
          gap: GRID_GAP,
          padding: GRID_PADDING
        });
      }
    };

    // Initial calculation
    updateGridDimensions();

    // Add resize listener
    window.addEventListener('resize', updateGridDimensions);
    
    // Cleanup
    return () => window.removeEventListener('resize', updateGridDimensions);
  }, [calculateGridColumns, calculateCellSize]);

  // Track tile changes and log tile list
  useEffect(() => {
    const prevTiles = prevTilesRef.current;
    prevTiles.forEach(prevTile => {
      const currentTile = tiles.find(t => t.id === prevTile.id);
      if (currentTile && prevTile.isPinned !== currentTile.isPinned) {
        // Pin state changed - position should be preserved
      }
    });
    
    // Log current tile list
    console.log('📋 GridDashboard: Current tiles on dashboard', {
      tileCount: tiles.length,
      tiles: tiles.map(t => ({
        id: t.id,
        type: t.type,
        title: t.title || t.symbol || t.name || `${t.type} tile`,
        customTitle: t.customTitle,
      }))
    });
    
    prevTilesRef.current = tiles;
  }, [tiles]);

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
          width: Math.max(1, Math.round(tile.size.width / (cellSize + GRID_GAP))),
          height: Math.max(1, Math.round(tile.size.height / (cellSize + GRID_GAP))),
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

      // Try to preserve current visual position if tile has legacy position
      let preferredPosition: GridPosition | null = null;
      let positionFound = false;
      
      if (tile.position) {
        // Convert legacy pixel position to grid position
        const gridX = Math.round(tile.position.x / (cellSize + GRID_GAP));
        const gridY = Math.round(tile.position.y / (cellSize + GRID_GAP));
        preferredPosition = { x: Math.max(0, gridX), y: Math.max(0, gridY) };
        
        // Check if preferred position is available
        let canPlaceAtPreferred = true;
        for (let dx = 0; dx < gridSize.width; dx++) {
          for (let dy = 0; dy < gridSize.height; dy++) {
            if (occupiedCells.has(`${preferredPosition.x + dx},${preferredPosition.y + dy}`)) {
              canPlaceAtPreferred = false;
              break;
            }
          }
          if (!canPlaceAtPreferred) break;
        }
        
        if (canPlaceAtPreferred) {
          propsMap.set(tile.id, { position: preferredPosition, size: gridSize });
          positionFound = true;
        }
      }

      // Find first available position if preferred position wasn't available
      if (!positionFound) {
        // Note: Use a reasonable maximum width for initial placement, will be adjusted by gridDimensions
        const maxPlacementWidth = Math.max(gridColumns, 50); // Allow up to 50 columns for initial placement
        let foundPosition = false;
        
        // Start search from preferred position if available, otherwise start from (0, 0)
        const startY = preferredPosition ? preferredPosition.y : 0;
        const startX = preferredPosition ? preferredPosition.x : 0;
        
        for (let y = startY; y < MAX_GRID_ROWS && !foundPosition; y++) {
          for (let x = (y === startY ? startX : 0); x < maxPlacementWidth - gridSize.width + 1 && !foundPosition; x++) {
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
      }
    });

    return propsMap;
  }, [tiles, gridColumns, cellSize]);

  // Get default grid position and size for a tile
  const getDefaultGridProps = useCallback((tile: UnifiedTile): { position: GridPosition; size: GridSize } => {
    const tileConfig = getTileConfig(tile.type);
    const defaultSize = tileConfig.sizeConstraints;
    
    const props = tileGridProps.get(tile.id) || { 
      position: { x: 0, y: 0 }, 
      size: { width: defaultSize.defaultWidth, height: defaultSize.defaultHeight } 
    };
    
    return props;
  }, [tileGridProps]);

  // Handle drag start
  const handleDragStart = useCallback((tileId: string, event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    
    // Check if the click is on an interactive element
    const isInteractiveElement = (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable ||
      target.closest('input, textarea, button, select, [contenteditable="true"], .MuiDialog-root, .MuiDialog-container, .MuiAutocomplete-popper, .MuiMenu-root, .MuiPopover-root, .MuiTooltip-popper')
    );
    
    // Don't start drag if clicking on interactive elements
    if (isInteractiveElement) {
      return;
    }
    
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) {
      return;
    }

    // Don't start drag if tile is pinned
    if (tile.isPinned) {
      return;
    }
    
    event.preventDefault();
    
    if (!containerRef.current) return;
    
    const { position } = getDefaultGridProps(tile);
    
    // Calculate the offset between mouse position and tile's grid position
    // This prevents the tile from jumping when drag starts
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = event.clientX - rect.left - GRID_PADDING;
    const relativeY = event.clientY - rect.top - GRID_PADDING;
    
    // Convert tile's grid position to pixel position
    const tilePixelX = position.x * (cellSize + GRID_GAP);
    const tilePixelY = position.y * (cellSize + GRID_GAP);
    
    // Calculate offset from mouse to tile top-left corner
    const offsetX = relativeX - tilePixelX;
    const offsetY = relativeY - tilePixelY;
    
    setDragState({
      isDragging: true,
      dragTileId: tileId,
      dragStart: { x: event.clientX, y: event.clientY },
      currentPosition: position,
      dragOffset: { x: offsetX, y: offsetY }, // Store offset to maintain relative position
    });
  }, [tiles, getDefaultGridProps, cellSize]);

  // Calculate grid dimensions based on tile positions (including drag preview)
  const gridDimensions = useMemo(() => {
    let maxX = 0;
    let maxY = 0;

    // Check all tiles
    tiles.forEach(tile => {
      let position: GridPosition;
      let size: GridSize;
      
      // If this tile is being dragged, use drag preview position, otherwise use actual position
      if (dragState.dragTileId === tile.id && dragState.currentPosition) {
        position = dragState.currentPosition;
        const tileProps = getDefaultGridProps(tile);
        size = tileProps.size;
      } else {
        const tileProps = getDefaultGridProps(tile);
        position = tileProps.position;
        size = tileProps.size;
      }
      
      const tileRight = position.x + size.width;
      const tileBottom = position.y + size.height;
      
      if (tileRight > maxX) {
        maxX = tileRight;
      }
      if (tileBottom > maxY) {
        maxY = tileBottom;
      }
    });

    // Add some padding (2 rows/columns) for visual spacing
    const calculatedWidth = Math.max(gridColumns, maxX + 2);
    const calculatedHeight = Math.max(10, maxY + 2);

    return { width: calculatedWidth, height: calculatedHeight };
  }, [tiles, getDefaultGridProps, gridColumns, dragState.dragTileId, dragState.currentPosition]);

  // Check if a grid area is available
  const isAreaAvailable = useCallback((position: GridPosition, size: GridSize, excludeTileId?: string): boolean => {
    // Check bounds - use dynamic grid dimensions instead of fixed gridColumns
    if (position.x < 0 || position.y < 0 || 
        position.x + size.width > gridDimensions.width || 
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
  }, [tiles, getDefaultGridProps, gridDimensions]);

  // Handle drag move with minimal throttling for smooth, responsive dragging
  const handleDragMove = useCallback((event: MouseEvent) => {
    if (!dragState.isDragging || !containerRef.current || !dragState.dragOffset) return;

    // Minimal throttle for performance (16ms = ~60fps)
    const now = Date.now();
    if (dragState.lastUpdateTime && now - dragState.lastUpdateTime < 16) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    // Account for padding when calculating relative position
    const relativeX = event.clientX - rect.left - GRID_PADDING;
    const relativeY = event.clientY - rect.top - GRID_PADDING;

    // Subtract the offset to get the tile's top-left corner position
    const tilePixelX = relativeX - dragState.dragOffset.x;
    const tilePixelY = relativeY - dragState.dragOffset.y;

    // Convert to grid coordinates
    const gridX = Math.round(tilePixelX / (cellSize + GRID_GAP));
    const gridY = Math.round(tilePixelY / (cellSize + GRID_GAP));
    
    const tile = tiles.find(t => t.id === dragState.dragTileId);
    if (tile) {
      const { size } = getDefaultGridProps(tile);
      // Use dynamic grid dimensions instead of fixed gridColumns
      const maxX = gridDimensions.width - size.width;
      const constrainedPos = {
        x: Math.max(0, Math.min(gridX, maxX)),
        y: Math.max(0, gridY),
      };

      // Only update if position actually changed
      const currentPos = dragState.currentPosition;
      const hasMoved = !currentPos || 
        currentPos.x !== constrainedPos.x || 
        currentPos.y !== constrainedPos.y;

      if (hasMoved) {
        setDragState(prev => ({
          ...prev,
          currentPosition: constrainedPos,
          lastUpdateTime: now,
        }));
      }
    }
  }, [dragState, tiles, getDefaultGridProps, gridDimensions, cellSize]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    if (!dragState.isDragging || !dragState.dragTileId || !dragState.currentPosition) {
      return;
    }

    const tile = tiles.find(t => t.id === dragState.dragTileId);
    if (tile) {
      const { size } = getDefaultGridProps(tile);
      
      // Check if the new position is available
      const isAvailable = isAreaAvailable(dragState.currentPosition, size, dragState.dragTileId);
      
      if (isAvailable) {
        // Update the tile's grid position
        const newLegacyPosition = {
          x: dragState.currentPosition.x * (cellSize + GRID_GAP),
          y: dragState.currentPosition.y * (cellSize + GRID_GAP),
        };
        
        onUpdateTile(dragState.dragTileId, {
          gridPosition: dragState.currentPosition,
          // Also update legacy position for backward compatibility
          position: newLegacyPosition,
        });
      }
    }

    setDragState({
      isDragging: false,
      dragTileId: null,
      dragStart: { x: 0, y: 0 },
      currentPosition: null,
      dragOffset: undefined,
      lastUpdateTime: undefined,
    });
  }, [dragState, tiles, getDefaultGridProps, isAreaAvailable, onUpdateTile, gridDimensions, cellSize]);

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
    const gridDeltaX = Math.round(deltaX / (cellSize + GRID_GAP));
    const gridDeltaY = Math.round(deltaY / (cellSize + GRID_GAP));

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
  }, [resizeState, cellSize]);

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
        
        // Calculate pixel size for legacy compatibility
        const pixelSize = {
          width: resizeState.previewSize.width * cellSize + (resizeState.previewSize.width - 1) * GRID_GAP,
          height: resizeState.previewSize.height * cellSize + (resizeState.previewSize.height - 1) * GRID_GAP,
        };
        
        // Update the tile with both grid size and legacy size
        onUpdateTile(resizeState.resizeTileId, {
          gridSize: resizeState.previewSize,
          size: pixelSize, // Legacy size for backward compatibility
        });
        
        console.log('✅ Tile resized successfully to:', { gridSize: resizeState.previewSize, pixelSize });
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
  }, [resizeState, tiles, getDefaultGridProps, isAreaAvailable, onUpdateTile, cellSize]);

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


  const handleAddToSidebarContext = useCallback(() => {
    if (selectionState.selectedTiles.size === 0) {
      console.log('No tiles selected to add to sidebar context');
      return;
    }

    // Get selected tiles data
    const selectedTilesData = tiles.filter(tile => selectionState.selectedTiles.has(tile.id));
    
    // Prepare tile data for batch addition (immediate visual feedback, no API calls)
    const tilesToAdd = selectedTilesData.map(tile => ({
      tileId: tile.id,
      tileType: tile.type,
      tileData: extractTileData(tile),
      options: {
        customTitle: `${tile.type.charAt(0).toUpperCase() + tile.type.slice(1)} Tile`,
        customSubtitle: tile.symbol ? `${tile.symbol} • ${tile.timeframe || '1d'}` : `Tile ${tile.id.substring(0, 8)}`
      }
    }));
    
    // Use batch addition for multiple tiles, single addition for one tile
    if (tilesToAdd.length > 1) {
      addMultipleTilesToContext(tilesToAdd, 'sidebar');
      console.log(`✅ Added ${tilesToAdd.length} tiles to sidebar context in batch`);
    } else if (tilesToAdd.length === 1) {
      const tile = tilesToAdd[0];
      
      // Dispatch event to add to sidebar context
      const event = new CustomEvent('add-to-sidebar-context', {
        detail: {
          id: `tile_${tile.tileId}_${Date.now()}`,
          type: 'tile',
          title: tile.options.customTitle,
          subtitle: tile.options.customSubtitle,
          data: tile.tileData,
          timestamp: Date.now(),
        }
      });
      window.dispatchEvent(event);
      console.log(`✅ Added ${tile.tileType} tile to sidebar context:`, tile.tileId);
    }
    
    // Close context menu
    handleContextMenuClose();
  }, [selectionState.selectedTiles, tiles, handleContextMenuClose]);

  const handleAddToFiles = useCallback(() => {
    if (selectionState.selectedTiles.size === 0 || !user) {
      return;
    }
    setFileBrowserOpen(true);
    handleContextMenuClose();
  }, [selectionState.selectedTiles, user, handleContextMenuClose]);

  const handleFileBrowserSelect = useCallback(async (folderPath: string) => {
    if (!user || selectionState.selectedTiles.size === 0) return;
    
    try {
      const selectedTilesData = tiles.filter(tile => selectionState.selectedTiles.has(tile.id));
      
      // Save all tiles to the filesystem with FULL data using bulk operation
      const items = selectedTilesData.map(tile => {
        // For filesystem, send full tile data including all configuration and results
        // The spread operator includes all tile properties, but we explicitly ensure
        // searchParams, filterSettings, and paginationState are included for search tiles
        const fullTileData: any = {
          ...tile,
          tileId: tile.id,
          tileType: tile.type,
        };
        
        // For search tiles, ensure searchParams are always included (even if empty)
        // This ensures the tile can be restored with its search configuration AND exact results
        if (['lda_disclosures', 'congress_bills', 'news', 'sec_search', 'govt_contracts', 'politician_trades'].includes(tile.type)) {
          if (tile.searchParams !== undefined) {
            fullTileData.searchParams = tile.searchParams;
          }
          if (tile.filterSettings !== undefined) {
            fullTileData.filterSettings = tile.filterSettings;
          }
          if (tile.paginationState !== undefined) {
            fullTileData.paginationState = tile.paginationState;
          }
          // IMPORTANT: Save results data to preserve exact search results (not just pagination keys)
          // This ensures imported/duplicated tiles show the same data, even if underlying DB changed
          if (tile.results !== undefined) {
            fullTileData.results = tile.results;
          }
        }
        const title = tile.symbol 
          ? `${tile.type.charAt(0).toUpperCase() + tile.type.slice(1)} - ${tile.symbol}`
          : `${tile.type.charAt(0).toUpperCase() + tile.type.slice(1)} Tile`;
        
        return {
          context_data: fullTileData, // Full tile object with all fields
          title: title,
          item_type: 'tile' as const,
        };
      });
      
      // Use bulk operation for better performance
      const response = await filesystemAPI.addBulkContextItems({
        user_id: user.id,
        folder_path: folderPath,
        items: items,
      });
      
      if (response.success) {
        const result = response.result as any;
        const successCount = result?.succeeded || selectedTilesData.length;
        console.log(`✅ Saved ${successCount} of ${selectedTilesData.length} tile(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} tile(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save tiles');
      }
    } catch (error) {
      console.error('Error saving tiles to filesystem:', error);
    }
  }, [user, selectionState.selectedTiles, tiles]);

  // Memoize sessionStorage reads for all tiles to avoid reading on every render
  const tilePaginationStates = useMemo(() => {
    const states = new Map<string, any>();
    tiles.forEach(tile => {
      try {
        const sessionData = sessionStorage.getItem(`tile_results_${tile.id}`);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          if (parsed.paginationState) {
            states.set(tile.id, parsed.paginationState);
          }
        }
      } catch (error) {
        // Ignore sessionStorage errors
      }
    });
    return states;
  }, [tiles]); // Only recompute when tiles array changes

  // Memoize tile results from sessionStorage
  const tileResults = useMemo(() => {
    const results = new Map<string, any>();
    tiles.forEach(tile => {
      try {
        const sessionData = sessionStorage.getItem(`tile_results_${tile.id}`);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          if (parsed.results) {
            results.set(tile.id, parsed.results);
          }
        }
      } catch (error) {
        // Ignore sessionStorage errors
      }
    });
    return results;
  }, [tiles]); // Only recompute when tiles array changes

  // Memoize tile configs to avoid repeated lookups
  const tileConfigs = useMemo(() => {
    const configs = new Map<string, any>();
    tiles.forEach(tile => {
      configs.set(tile.id, getTileConfig(tile.type));
    });
    return configs;
  }, [tiles]); // Only recompute when tiles array changes

  // Render tile with grid positioning - memoized with useCallback
  const renderTile = useCallback((tile: UnifiedTile) => {
    const { position, size } = getDefaultGridProps(tile);
    const tileConfig = tileConfigs.get(tile.id) || getTileConfig(tile.type);
    const supportsResize = (tileConfig?.supportsResize ?? true) && !tile.isPinned;

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
    
    
    // Common props for all tiles
    const commonProps = {
      id: tile.id,
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
      onDuplicate: onDuplicateTile,
      isDeletingTiles,
    };

    // Type-specific props
    const cryptoProps = {
      ...commonProps,
      symbol: tile.symbol || 'BTC',
      timeframe: tile.timeframe || '1d',
      displayOptions: (tile.displayOptions as any) || {
        showPrice: true,
        showPriceMarker: false,
        show24hChange: true,
        showAnnualReturn: true,
        showVolatility: true,
        showChart: true,
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    const stockProps = {
      ...commonProps,
      symbol: tile.symbol || 'AAPL',
      timeframe: tile.timeframe || '1d',
      displayOptions: (tile.displayOptions as any) || {
        showPrice: true,
        showPriceMarker: false,
        show24hChange: true,
        showAnnualReturn: true,
        showVolatility: true,
        showChart: true,
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    // Use memoized pagination state instead of reading from sessionStorage
    const sessionPaginationStateScreener = tilePaginationStates.get(tile.id) || tile.paginationState;
    const sessionResultsScreener = tileResults.get(tile.id) || tile.results;

    const stockScreenerProps = {
      ...commonProps,
      criteria: tile.criteria,
      filterSettings: tile.filterSettings,
      paginationState: sessionPaginationStateScreener,
      results: sessionResultsScreener,
      displayOptions: (tile.displayOptions as any) || {
        showIndustry: true,
        showMarketCap: true,
        showVolatility: true,
        showPriceChange: true,
        showPERatio: true,
        showDividendYield: true,
        showResultsTable: true,
        showCriteriaSummary: true,
        maxResults: 100000,  // Get all matching stocks (effectively unlimited, frontend will paginate)
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    // Use memoized pagination state and results instead of reading from sessionStorage
    const sessionPaginationStateNews = tilePaginationStates.get(tile.id) || tile.paginationState;
    const sessionResultsNews = tileResults.get(tile.id) || tile.results;

    const newsProps = {
      ...commonProps,
      searchParams: tile.searchParams, // Include searchParams like PoliticianTradesSearchTile
      filterSettings: tile.filterSettings,
      paginationState: sessionPaginationStateNews,
      results: sessionResultsNews,
      displayOptions: (tile.displayOptions as any) || {
        showTitle: true,
        showSource: true,
        showDate: true,
        showCategory: true,
        showSentiment: true,
        showCreator: false,
        showCountry: false,
        showImage: true,
        showDescription: false,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    const portfolioProps = {
      ...commonProps,
      displayOptions: (tile.displayOptions as any) || {
        showHoldings: true,
        showPerformance: true,
        showAllocation: false,
        showRiskMetrics: true,
        showStockDetails: true,
      },
      portfolioData: tile.portfolioData,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    // Use memoized pagination state and results instead of reading from sessionStorage
    const sessionPaginationStateTrades = tilePaginationStates.get(tile.id) || tile.paginationState;
    const sessionResultsTrades = tileResults.get(tile.id) || tile.results;

    const politicianTradesProps = {
      ...commonProps,
      searchParams: tile.searchParams,
      filterSettings: tile.filterSettings,
      paginationState: sessionPaginationStateTrades,
      results: sessionResultsTrades,
      displayOptions: (tile.displayOptions as any) || {
        showPolitician: true,
        showParty: true,
        showPosition: true,
        showSecurity: true,
        showTransactionType: true,
        showAmount: true,
        showDate: true,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };
    
    // Log filterSettings for debugging
    if (tile.type === 'politician_trades') {
      console.log('📋 GridDashboard: Rendering PoliticianTradesSearchTile with filterSettings', {
        tileId: tile.id,
        filterSettings: tile.filterSettings,
      });
    }

    // Restore paginationState and results from sessionStorage for SEC tile
    let sessionPaginationStateSEC = tile.paginationState;
    let sessionResultsSEC = tile.results;
    try {
      const sessionData = sessionStorage.getItem(`tile_results_${tile.id}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        if (parsed.paginationState) {
          sessionPaginationStateSEC = parsed.paginationState;
        }
        if (parsed.results) {
          sessionResultsSEC = parsed.results;
        }
      }
    } catch (error) {
      // Ignore sessionStorage errors
    }

    const secSearchProps = {
      ...commonProps,
      onSelectionChange: (isSelected: boolean) => handleTileSelection(tile.id, isSelected),
      searchParams: tile.searchParams,
      filterSettings: tile.filterSettings,
      paginationState: sessionPaginationStateSEC,
      results: sessionResultsSEC,
      displayOptions: {
        showEntity: true,
        showForm: true,
        showFilingDate: true,
        showLocation: true,
        showIncorporation: true,
        showCIK: true,
        showFile: true,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
        ...((tile.displayOptions as any) || {}),
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    // Restore paginationState and results from sessionStorage if available (for session persistence)
    let sessionPaginationState = tile.paginationState;
    let sessionResults = tile.results;
    try {
      const sessionData = sessionStorage.getItem(`tile_results_${tile.id}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        if (parsed.paginationState) {
          sessionPaginationState = parsed.paginationState;
        }
        if (parsed.results) {
          sessionResults = parsed.results;
        }
      }
    } catch (error) {
      console.error('🏛️ GridDashboard: Error restoring session data', error);
    }

    const govtContractsProps = {
      ...commonProps,
      onSelectionChange: (id: string, isSelected: boolean) => handleTileSelection(id, isSelected),
      searchParams: tile.searchParams,
      filterSettings: tile.filterSettings,
      paginationState: sessionPaginationState,
      results: sessionResults as GovtContractAward[] | undefined,
      displayOptions: {
        showRecipient: true,
        showAwardingAgency: true,
        showFundingAgency: true,
        showAmount: true,
        showPeriodStartDate: false,
        showPeriodEndDate: false,
        showNaicsCode: false,
        showPscCode: false,
        showLastUpdated: true,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
        ...((tile.displayOptions as any) || {}),
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    // Restore paginationState and results from sessionStorage if available (for session persistence)
    let sessionPaginationStateBills = tile.paginationState;
    let sessionResultsBills = tile.results;
    try {
      const sessionData = sessionStorage.getItem(`tile_results_${tile.id}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        if (parsed.paginationState) {
          sessionPaginationStateBills = parsed.paginationState;
        }
        if (parsed.results) {
          sessionResultsBills = parsed.results;
        }
      }
    } catch (error) {
      // Ignore sessionStorage errors
    }

    const congressBillsProps = {
      ...commonProps,
      onSelectionChange: (id: string, isSelected: boolean) => handleTileSelection(id, isSelected),
      searchParams: tile.searchParams,
      filterSettings: tile.filterSettings,
      paginationState: sessionPaginationStateBills,
      results: sessionResultsBills as CongressBill[] | undefined,
      displayOptions: {
        showBillTitle: true,
        showBillType: true,
        showBillNumber: false,
        showSponsorName: true,
        showSponsorParty: false,
        showSponsorState: false,
        showIntroducedDate: true,
        showLatestActionDate: false,
        showCongress: true,
        showBipartisan: false,
        showPolicyArea: false,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
        ...((tile.displayOptions as any) || {}),
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    // Restore paginationState and results from sessionStorage if available (for session persistence)
    let sessionPaginationStateLDA = tile.paginationState;
    let sessionResultsLDA = tile.results;
    try {
      const sessionData = sessionStorage.getItem(`tile_results_${tile.id}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        if (parsed.paginationState) {
          sessionPaginationStateLDA = parsed.paginationState;
        }
        if (parsed.results) {
          sessionResultsLDA = parsed.results;
        }
      }
    } catch (error) {
      // Ignore sessionStorage errors
    }

    const ldaSearchProps = {
      ...commonProps,
      onSelectionChange: (id: string, isSelected: boolean) => handleTileSelection(id, isSelected),
      searchParams: tile.searchParams,
      filterSettings: tile.filterSettings,
      paginationState: sessionPaginationStateLDA,
      results: sessionResultsLDA,
      displayOptions: {
        showFilingType: true,
        showFilingPeriod: true,
        showFilingYear: true,
        showRegistrant: true,
        showClient: true,
        showAmount: true,
        showDatePosted: true,
        showState: true,
        showResultsTable: true,
        maxResults: 50,
        compactView: false,
        ...((tile.displayOptions as any) || {}),
      },
      autoRefresh: tile.autoRefresh,
      isPinned: tile.isPinned,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
    };

    const folderProps = {
      ...commonProps,
      onSelectionChange: (id: string, isSelected: boolean) => handleTileSelection(id, isSelected),
      folderPath: (tile as any).folderPath || '',
      folderId: (tile as any).folderId,
      customTitle: tile.customTitle,
      customColor: tile.customColor,
      customIcon: tile.customIcon,
      isPinned: tile.isPinned,
      dashboardContext,
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
          <CryptoTile key={tile.id} {...cryptoProps} />
        ) : tile.type === 'stock' ? (
          <StockTile key={tile.id} {...stockProps} />
        ) : tile.type === 'stock_screener' ? (
          <StockScreenerTile key={tile.id} {...stockScreenerProps} />
        ) : tile.type === 'news' ? (
          <NewsTile key={tile.id} {...newsProps} />
        ) : tile.type === 'portfolio' ? (
          <PortfolioTile key={tile.id} {...portfolioProps} />
        ) : tile.type === 'politician_trades' ? (
          <PoliticianTradesSearchTile key={tile.id} {...politicianTradesProps} />
        ) : tile.type === 'sec_search' ? (
          <SECSearchTile key={tile.id} {...secSearchProps} />
        ) : tile.type === 'govt_contracts' ? (
          <GovtContractsSearchTile key={tile.id} {...govtContractsProps} />
        ) : tile.type === 'congress_bills' ? (
          <CongressBillsSearchTile key={tile.id} {...congressBillsProps} />
        ) : tile.type === 'lda_disclosures' ? (
          <LDASearchTile key={tile.id} {...ldaSearchProps} />
        ) : tile.type === 'folder' ? (
          <FolderTile key={tile.id} {...folderProps} />
        ) : (
          <PlaceholderTile
            key={tile.id}
            tile={tile}
            onRemove={onRemoveTile}
            onUpdate={onUpdateTile}
            onSettingsChange={onSettingsChange}
            onResize={onResizeTile}
            isSelected={commonProps.isSelected}
            onSelectionChange={handleTileSelection}
            onDuplicate={onDuplicateTile}
          />
        )}
        
        {/* Resize handle - only show if tile supports resizing */}
        {supportsResize && (
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
              opacity: isResizing ? 1 : 0.6,
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
        )}
      </Box>
    );
  }, [
    getDefaultGridProps,
    tileConfigs,
    dragState.dragTileId,
    dragState.currentPosition,
    resizeState.resizeTileId,
    resizeState.previewSize,
    selectionState.selectedTiles,
    tilePaginationStates,
    handleDragStart,
    handleResizeStart,
    handleTileSelection,
    onRemoveTile,
    onUpdateTile,
    onSettingsChange,
    onResizeTile,
    onDuplicateTile,
    dashboardContext,
    cellSize,
  ]);

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

  // Memoize rendered tiles array to prevent unnecessary re-renders
  // Must be after renderTile is defined but before any early returns
  const renderedTiles = useMemo(() => tiles.map(renderTile), [tiles, renderTile]);

  if (tiles.length === 0) {
    return (
      <Box
        sx={{
          p: 6,
          textAlign: 'center',
          background: 'rgba(15, 23, 42, 0.9)',
          border: '2px dashed #374151',
          borderRadius: '0px',
          backdropFilter: 'blur(16px)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Background Pattern */}
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.1,
          backgroundImage: `
            radial-gradient(circle at 25% 25%, #3b82f6 2px, transparent 2px),
            radial-gradient(circle at 75% 75%, #8b5cf6 2px, transparent 2px)
          `,
          backgroundSize: '60px 60px',
          backgroundPosition: '0 0, 30px 30px'
        }} />
        
        {/* Content */}
        <Box sx={{ position: 'relative', zIndex: 10 }}>
          {/* Title - moved up, no icon */}
          <Typography 
            variant="h4" 
            sx={{ 
              color: '#ffffff', 
              fontWeight: 700, 
              mb: 2,
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}
          >
            Your Dashboard Awaits
          </Typography>
          
          {/* Description */}
          <Typography 
            variant="h6" 
            sx={{ 
              color: '#e2e8f0', 
              mb: 4,
              maxWidth: '500px',
              mx: 'auto',
              lineHeight: 1.6
            }}
          >
            Transform this empty space into your personalized financial command center. 
            Add tiles to track stocks, crypto, portfolios, and more.
          </Typography>

          {/* Quick Start Options */}
          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            gap: 3,
            maxWidth: '600px',
            mx: 'auto',
            mb: 4
          }}>
            {[
              { 
                title: 'Crypto Tracker', 
                desc: 'Monitor Bitcoin, Ethereum & more',
                color: '#f59e0b',
                icon: '₿'
              },
              { 
                title: 'Stock Analysis', 
                desc: 'Track your favorite stocks',
                color: '#10b981',
                icon: '📈'
              },
              { 
                title: 'AI Insights', 
                desc: 'Get intelligent recommendations',
                color: '#8b5cf6',
                icon: '🤖'
              }
            ].map((option) => (
              <Box
                key={option.title}
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(31, 41, 55, 0.8)',
                  border: '2px solid #374151',
                  borderRadius: '0px',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    border: `2px solid ${option.color}`,
                    transform: 'translateY(-4px)',
                    boxShadow: `0 15px 30px ${option.color}20`
                  }
                }}
              >
                <Typography 
                  variant="h3" 
                  sx={{ 
                    mb: 1,
                    fontSize: '2rem'
                  }}
                >
                  {option.icon}
                </Typography>
                <Typography 
                  variant="h6" 
                  sx={{ 
                    color: '#ffffff', 
                    fontWeight: 600, 
                    mb: 1,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}
                >
                  {option.title}
                </Typography>
                <Typography 
                  variant="body2" 
                  sx={{ color: '#9ca3af' }}
                >
                  {option.desc}
                </Typography>
              </Box>
            ))}
          </Box>

        </Box>

        {/* CSS Animation */}
        <style>
          {`
            @keyframes pulse {
              0%, 100% {
                transform: scale(1);
                opacity: 1;
              }
              50% {
                transform: scale(1.1);
                opacity: 0.8;
              }
            }
          `}
        </style>
      </Box>
    );
  }

  return (
    <>
      {/* Scrollable wrapper container */}
      <Box
        ref={scrollContainerRef}
        sx={{
          width: '100%',
          height: '100%',
          overflow: 'auto', // Enable scrolling
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.9) 100%)',
          border: '1px solid #374151',
          borderRadius: '8px',
          // Custom scrollbar styling
          '&::-webkit-scrollbar': {
            width: '12px',
            height: '12px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(31, 41, 55, 0.5)',
            borderRadius: '8px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(75, 85, 99, 0.8)',
            borderRadius: '8px',
            '&:hover': {
              background: 'rgba(107, 114, 128, 0.9)',
            },
          },
        }}
      >
        <Box
          ref={containerRef}
          onContextMenu={handleGridContextMenu}
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridDimensions.width}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${gridDimensions.height}, ${cellSize}px)`,
            gap: `${GRID_GAP}px`,
            padding: `${GRID_PADDING}px`,
            // Allow grid to expand based on tile positions
            width: 'fit-content',
            minWidth: '100%', // At minimum, fill the container
            height: 'fit-content',
            minHeight: '600px', // Minimum height for visual consistency
            position: 'relative',
            // Apply zoom transform
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top left',
            // Adjust container size to account for zoom
            transition: 'transform 0.2s ease-in-out',
          }}
        >
      {/* Grid background */}
      <Box
        sx={{
          position: 'absolute',
          top: GRID_PADDING,
          left: GRID_PADDING,
          right: GRID_PADDING,
          bottom: GRID_PADDING,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: `${cellSize + GRID_GAP}px ${cellSize + GRID_GAP}px`,
          opacity: 0.3,
          pointerEvents: 'none',
        }}
      />
      
      {/* Tiles - Memoized to prevent unnecessary re-renders */}
      {renderedTiles}
      
      {/* Drag preview */}
      {renderDragPreview()}
      
      {/* Resize preview */}
      {renderResizePreview()}
        </Box>
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
            minWidth: 250,
          },
        }}
      >
        <MenuItem onClick={handleAddToSidebarContext} disabled={selectionState.selectedTiles.size === 0}>
          <ListItemIcon>
            <SidebarChatIcon sx={{ color: '#10b981' }} />
          </ListItemIcon>
          <ListItemText>
            Add to Context ({selectionState.selectedTiles.size} selected)
          </ListItemText>
        </MenuItem>
        
        <MenuItem onClick={handleAddToFiles} disabled={selectionState.selectedTiles.size === 0}>
          <ListItemIcon>
            <FolderIcon sx={{ color: '#fbbf24' }} />
          </ListItemIcon>
          <ListItemText>
            Add to Files ({selectionState.selectedTiles.size} selected)
          </ListItemText>
        </MenuItem>

        {onDuplicateTile && selectionState.selectedTiles.size === 1 && (
          <MenuItem 
            onClick={() => {
              const tileId = Array.from(selectionState.selectedTiles)[0];
              onDuplicateTile(tileId);
              handleContextMenuClose();
            }}
            disabled={isDeletingTiles}
          >
            <ListItemIcon>
              <ContentCopy sx={{ color: '#9ca3af' }} />
            </ListItemIcon>
            <ListItemText>Duplicate Tile</ListItemText>
          </MenuItem>
        )}

        {onRemoveMultipleTiles && selectionState.selectedTiles.size > 0 && (
          <MenuItem 
            onClick={() => {
              const tileIds = Array.from(selectionState.selectedTiles);
              onRemoveMultipleTiles(tileIds);
              handleContextMenuClose();
            }}
            disabled={isDeletingTiles}
          >
            <ListItemIcon>
              <DeleteOutline sx={{ color: '#ef4444' }} />
            </ListItemIcon>
            <ListItemText>
              Delete {selectionState.selectedTiles.size} Tile{selectionState.selectedTiles.size > 1 ? 's' : ''}
            </ListItemText>
          </MenuItem>
        )}
      </Menu>
      
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
        title="Save to Files"
      />
    </>
  );
};
