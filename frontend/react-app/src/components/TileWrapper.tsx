import React, { useRef, useState, useCallback } from 'react';
import { Box } from '@mui/material';
import { getTileConfig } from '../utils/tileConfig';
import { GridPosition, GridSize } from '../types/dashboardTypes';

interface TileWrapperProps {
  id: string;
  type: string;
  size: { width: number; height: number };
  gridPosition?: GridPosition;
  gridSize?: GridSize;
  isDragging?: boolean;
  isResizing?: boolean;
  isSelected?: boolean;
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResize?: (id: string, size: { width: number; height: number }) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  onResizeStart?: (id: string, event: React.MouseEvent) => void;
  onSelectionChange?: (id: string, selected: boolean) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const GRID_CELL_SIZE = 80;
const GRID_GAP = 16;

const TileWrapper: React.FC<TileWrapperProps> = ({
  id,
  type,
  size,
  gridPosition,
  gridSize,
  isDragging = false,
  isResizing = false,
  isSelected = false,
  onRemove,
  onUpdate,
  onSettingsChange,
  onResize,
  onDragStart,
  onResizeStart,
  onSelectionChange,
  children,
  className,
  style,
}) => {
  const tileRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Get tile configuration
  const tileConfig = getTileConfig(type);
  const supportsResize = tileConfig.supportsResize;
  const supportsDrag = tileConfig.supportsDrag;

  // Smart drag detection - only start drag on empty background areas
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!supportsDrag || !onDragStart) return;

    const target = e.target as HTMLElement;
    
    // Comprehensive list of interactive elements that should not trigger dragging
    const interactiveSelectors = [
      // Basic HTML elements
      'button', 'input', 'select', 'textarea', 'a', 'label',
      // ARIA roles
      '[role="button"]', '[role="checkbox"]', '[role="radio"]', '[role="slider"]', '[role="tab"]', '[role="menuitem"]',
      // Material-UI components
      '.MuiTableContainer-root', '.MuiTable-root', '.MuiTableCell-root', '.MuiTableHead-root', 
      '.MuiTableBody-root', '.MuiTableRow-root', '.MuiPagination-root', '.MuiPaginationItem-root',
      '.MuiSlider-root', '.MuiSlider-track', '.MuiSlider-rail', '.MuiSlider-thumb', '.MuiSlider-valueLabel',
      '.MuiChip-root', '.MuiAutocomplete-root', '.MuiFormControl-root', '.MuiDialog-root', 
      '.MuiMenu-root', '.MuiTooltip-root', '.MuiIconButton-root', '.MuiButton-root',
      '.MuiCheckbox-root', '.MuiRadio-root', '.MuiSwitch-root', '.MuiTextField-root',
      '.MuiSelect-root', '.MuiMenuItem-root', '.MuiListItem-root', '.MuiListItemButton-root',
      '.MuiAccordion-root', '.MuiTabs-root', '.MuiTab-root', '.MuiCard-root',
      // Chart and visualization components
      '.recharts-wrapper', '.recharts-surface', '.recharts-cartesian-axis',
      // Custom components
      '[data-interactive="true"]'
    ].join(', ');

    const isInteractiveElement = target.closest(interactiveSelectors);
    
    if (!isInteractiveElement) {
      onDragStart(e);
    }
  }, [supportsDrag, onDragStart]);

  // Handle resize end
  const handleMouseUp = useCallback(() => {
    if (onResize && tileRef.current) {
      const rect = tileRef.current.getBoundingClientRect();
      onResize(id, { width: rect.width, height: rect.height });
    }
  }, [onResize, id]);

  // Calculate pixel size from grid size
  const calculatePixelSize = useCallback((gridSize: GridSize) => {
    return {
      width: gridSize.width * GRID_CELL_SIZE + (gridSize.width - 1) * GRID_GAP,
      height: gridSize.height * GRID_CELL_SIZE + (gridSize.height - 1) * GRID_GAP,
    };
  }, []);

  // Get display size (use grid size if available, otherwise use legacy size)
  const displaySize = gridSize ? calculatePixelSize(gridSize) : size;

  return (
    <Box
      ref={tileRef}
      className={className}
      style={style}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        width: displaySize.width,
        height: displaySize.height,
        minWidth: displaySize.width,
        minHeight: displaySize.height,
        maxWidth: displaySize.width,
        maxHeight: displaySize.height,
        cursor: isDragging ? 'grabbing' : (supportsDrag ? 'grab' : 'default'),
        transition: isDragging || isResizing ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        zIndex: isDragging || isResizing ? 1000 : 1,
        '&:hover': {
          borderColor: '#3b82f6',
          transform: isDragging ? 'none' : 'translateY(-2px)',
          boxShadow: isDragging ? 'none' : '0 8px 25px rgba(59, 130, 246, 0.15)',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: isSelected ? '#3b82f6' : (isHovered ? '#8b5cf6' : 'transparent'),
          transition: 'background-color 0.2s ease',
        },
      }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Tile content */}
      {children}

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
            opacity: isResizing ? 1 : (isHovered ? 0.8 : 0.6),
            transition: 'opacity 0.2s ease',
            '&:hover': {
              opacity: 1,
              transform: 'scale(1.1)',
            },
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onResizeStart) {
              onResizeStart(id, e);
            }
          }}
        />
      )}
    </Box>
  );
};

export default TileWrapper;
