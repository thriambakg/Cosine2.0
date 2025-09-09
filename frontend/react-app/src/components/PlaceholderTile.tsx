import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Chip,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';
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
}

const PlaceholderTile: React.FC<PlaceholderTileProps> = ({
  tile,
  tileType,
  onRemove,
  onUpdate,
  onSettingsChange,
  onResize
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
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

  return (
    <Card
      sx={{
        width: tile.size.width,
        height: tile.size.height,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '8px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'grab',
        '&:hover': {
          borderColor: getTileColor(),
          boxShadow: `0 8px 32px ${getTileColor()}20`
        }
      }}
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
        <MenuItem onClick={handleMenuClose}>
          <ListItemIcon>
            <ContentCopyIcon sx={{ color: '#9ca3af' }} />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
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
      />
    </Card>
  );
};

export default PlaceholderTile;
