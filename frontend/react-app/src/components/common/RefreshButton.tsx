import React from 'react';
import { IconButton, Tooltip, CircularProgress } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';

interface RefreshButtonProps {
  onRefresh: () => void;
  loading?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'secondary' | 'inherit';
  tooltip?: string;
  sx?: any;
}

const RefreshButton: React.FC<RefreshButtonProps> = ({
  onRefresh,
  loading = false,
  disabled = false,
  size = 'medium',
  color = 'primary',
  tooltip = 'Refresh data',
  sx = {},
}) => {
  const sizeMap = {
    small: 20,
    medium: 24,
    large: 32,
  };

  return (
    <Tooltip title={tooltip}>
      <IconButton
        onClick={onRefresh}
        disabled={disabled || loading}
        size={size}
        color={color}
        sx={{
          transition: 'transform 0.2s ease-in-out',
          '&:hover': {
            transform: 'rotate(180deg)',
          },
          ...sx,
        }}
      >
        {loading ? (
          <CircularProgress size={sizeMap[size]} />
        ) : (
          <RefreshIcon />
        )}
      </IconButton>
    </Tooltip>
  );
};

export default RefreshButton;
