import React, { memo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Checkbox
} from '@mui/material';
import { getDefaultTileSize } from './tileConfig';
import {
  MoreVert as MoreVertIcon,
  Settings as SettingsIcon,
  Delete as DeleteIcon,
  ContentCopy as ContentCopyIcon,
  TrendingUp as TrendingUpIcon,
  AccountBalance as AccountBalanceIcon,
  AutoAwesome as AutoAwesomeIcon,
  Chat as ChatIcon,
  Settings as SettingsIcon2
} from '@mui/icons-material';

interface PlaceholderTileProps {
  tile: {
    id: string;
    type: string;
    title: string;
    size: { width: number; height: number };
    position?: { x: number; y: number };
    gridPosition?: { x: number; y: number };
    gridSize?: { width: number; height: number };
  };
  tileType?: {
    id: string;
    name: string;
    description: string;
    category: string;
    icon: React.ReactNode;
    color: string;
    placeholder?: boolean;
  };
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onResize: (id: string, size: { width: number; height: number }) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  onResizeStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  dashboardContext?: string;
  isSelected?: boolean;
  onSelectionChange?: (id: string, selected: boolean) => void;
  onDuplicate?: (id: string) => void;
}

const PlaceholderTile: React.FC<PlaceholderTileProps> = ({
  tile,
  tileType,
  onRemove,
  onDragStart,
  onResizeStart,
  isDragging = false,
  isResizing: _isResizing = false,
  dashboardContext: _dashboardContext,
  isSelected = false,
  onSelectionChange,
  onDuplicate,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const lastClickTimeRef = React.useRef<number>(0);
  const open = Boolean(anchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleRemove = () => {
    onRemove(tile.id);
    handleMenuClose();
  };

  const getTileIcon = () => {
    switch (tile.type) {
      case 'stock':
        return <AccountBalanceIcon sx={{ fontSize: 40, color: '#10b981' }} />;
      case 'portfolio':
        return <SettingsIcon2 sx={{ fontSize: 40, color: '#3b82f6' }} />;
      case 'custom':
        return <AutoAwesomeIcon sx={{ fontSize: 40, color: '#8b5cf6' }} />;
      case 'chat_generated':
        return <ChatIcon sx={{ fontSize: 40, color: '#ef4444' }} />;
      default:
        return <TrendingUpIcon sx={{ fontSize: 40, color: '#f59e0b' }} />;
    }
  };

  const getTileColor = () => {
    return tileType?.color || '#f59e0b';
  };

  // Calculate grid position and size
  const gridPosition = tile.gridPosition || { x: 0, y: 0 };
  const gridSize = tile.gridSize || getDefaultTileSize(tile.type);

  return (
    <Card
      sx={{
        // Grid positioning
        gridColumn: `${gridPosition.x + 1} / ${gridPosition.x + gridSize.width + 1}`,
        gridRow: `${gridPosition.y + 1} / ${gridPosition.y + gridSize.height + 1}`,
        
        // Fallback for legacy positioning
        ...(tile.position && !tile.gridPosition && {
          position: 'absolute',
          left: tile.position.x,
          top: tile.position.y,
          width: tile.size.width,
          height: tile.size.height,
        }),
        
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.7 : 1,
        transition: 'opacity 0.2s ease',
        '&:hover': {
          borderColor: getTileColor(),
          boxShadow: `0 8px 32px ${getTileColor()}20`
        }
      }}
      onMouseDown={onDragStart}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          borderBottom: '1px solid #374151',
          backgroundColor: 'rgba(30, 41, 59, 0.5)'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {/* Selection checkbox */}
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onClick={(e: React.MouseEvent) => {
                const now = Date.now();
                if (now - lastClickTimeRef.current < 200) {
                  // Prevent double clicks within 200ms
                  return;
                }
                lastClickTimeRef.current = now;
                
                e.stopPropagation();
                onSelectionChange(tile.id, !isSelected);
              }}
              sx={{ 
                color: '#9ca3af',
                '&.Mui-checked': { color: getTileColor() },
                p: 0.5,
                mr: 1,
                '&:hover': { backgroundColor: `${getTileColor()}20` }
              }}
              size="small"
              onMouseDown={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
              onMouseUp={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
            />
          )}
          {getTileIcon()}
          <Box sx={{ ml: 2 }}>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
              {tile.title}
            </Typography>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>
              {tileType?.name || 'Tile'}
            </Typography>
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip 
            label="Coming Soon" 
            size="small" 
            sx={{ 
              backgroundColor: '#374151',
              color: '#9ca3af',
              fontSize: '0.75rem'
            }} 
          />
          <IconButton
            size="small"
            onClick={handleMenuClick}
            sx={{ color: '#9ca3af' }}
          >
            <MoreVertIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Content Area */}
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          {getTileIcon()}
        </Box>
        
        <Typography variant="h6" sx={{ color: '#ffffff', mb: 2, textAlign: 'center' }}>
          {tileType?.name} Tile
        </Typography>
        
        <Typography variant="body2" sx={{ color: '#9ca3af', textAlign: 'center', mb: 3 }}>
          {tileType?.description || 'This tile type is coming soon!'}
        </Typography>

        {/* Placeholder Content */}
        <Box sx={{ 
          width: '100%', 
          height: '120px', 
          backgroundColor: 'rgba(30, 41, 59, 0.3)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed #374151'
        }}>
          <Typography variant="body2" sx={{ color: '#6b7280', textAlign: 'center' }}>
            Placeholder Content
            <br />
            <small>Implementation coming soon</small>
          </Typography>
        </Box>

        {/* Mock Data Preview */}
        <Box sx={{ mt: 2, width: '100%' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>Sample Data:</Typography>
            <Typography variant="body2" sx={{ color: getTileColor() }}>--</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>Last Updated:</Typography>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>--</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>Status:</Typography>
            <Typography variant="body2" sx={{ color: '#f59e0b' }}>Pending</Typography>
          </Box>
        </Box>
      </CardContent>

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: '#1e293b',
            border: '1px solid #374151',
            color: '#ffffff'
          }
        }}
      >
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <SettingsIcon sx={{ color: '#9ca3af' }} />
          </ListItemIcon>
          <ListItemText>Settings</ListItemText>
        </MenuItem>
        {onDuplicate && (
          <MenuItem onClick={() => {
            onDuplicate(tile.id);
            handleMenuClose();
          }}>
            <ListItemIcon>
              <ContentCopyIcon sx={{ color: '#9ca3af' }} />
            </ListItemIcon>
            <ListItemText>Duplicate</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleRemove} sx={{ color: '#ef4444' }}>
          <ListItemIcon>
            <DeleteIcon sx={{ color: '#ef4444' }} />
          </ListItemIcon>
          <ListItemText>Remove</ListItemText>
        </MenuItem>
      </Menu>

      {/* Resize Handles */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '12px',
          height: '12px',
          backgroundColor: getTileColor(),
          cursor: 'nw-resize',
          opacity: 0.7,
          '&:hover': {
            opacity: 1
          }
        }}
        onMouseDown={onResizeStart}
      />
    </Card>
  );
};

// Custom comparison function to ensure proper re-rendering when data changes
const PlaceholderTileMemo = memo(PlaceholderTile, (prevProps, nextProps) => {
  // Always re-render if key props change
  if (prevProps.tile.id !== nextProps.tile.id ||
      prevProps.tile.type !== nextProps.tile.type ||
      prevProps.tile.title !== nextProps.tile.title ||
      prevProps.dashboardContext !== nextProps.dashboardContext) {
    return false; // Re-render
  }
  
  // Check if grid position changed
  const prevGridPos = prevProps.tile.gridPosition;
  const nextGridPos = nextProps.tile.gridPosition;
  if (prevGridPos && nextGridPos) {
    if (prevGridPos.x !== nextGridPos.x || prevGridPos.y !== nextGridPos.y) {
      return false; // Re-render
    }
  }
  
  // Check if grid size changed
  const prevGridSize = prevProps.tile.gridSize;
  const nextGridSize = nextProps.tile.gridSize;
  if (prevGridSize && nextGridSize) {
    if (prevGridSize.width !== nextGridSize.width || prevGridSize.height !== nextGridSize.height) {
      return false; // Re-render
    }
  }
  
  // Check if legacy size changed significantly
  const prevSize = prevProps.tile.size;
  const nextSize = nextProps.tile.size;
  if (prevSize && nextSize) {
    const sizeThreshold = 10; // 10px threshold
    if (Math.abs(prevSize.width - nextSize.width) > sizeThreshold ||
        Math.abs(prevSize.height - nextSize.height) > sizeThreshold) {
      return false; // Re-render
    }
  }
  
  // Check if tile type changed
  if (prevProps.tileType?.id !== nextProps.tileType?.id ||
      prevProps.tileType?.name !== nextProps.tileType?.name ||
      prevProps.tileType?.color !== nextProps.tileType?.color) {
    return false; // Re-render
  }
  
  // Check if drag/resize state changed
  if (prevProps.isDragging !== nextProps.isDragging ||
      prevProps.isResizing !== nextProps.isResizing) {
    return false; // Re-render
  }
  
  return true; // Don't re-render
});

export default PlaceholderTileMemo;
