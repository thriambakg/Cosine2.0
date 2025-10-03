import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { PushPin as PinIcon, PushPinOutlined as UnpinIcon } from '@mui/icons-material';

interface PinButtonProps {
  isPinned: boolean;
  onTogglePin: () => void;
  size?: 'small' | 'medium';
}

/**
 * Common pin button component for tiles
 * Shows visual indication of pin state and handles toggle action
 */
export const PinButton: React.FC<PinButtonProps> = ({
  isPinned,
  onTogglePin,
  size = 'small',
}) => {
  return (
    <Tooltip title={isPinned ? 'Unpin tile (unlock position & size)' : 'Pin tile (lock position & size)'}>
      <IconButton
        size={size}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        sx={{
          color: isPinned ? '#f59e0b' : '#9ca3af',
          '&:hover': {
            color: isPinned ? '#d97706' : '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
          },
          transition: 'all 0.2s ease',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {isPinned ? <PinIcon sx={{ fontSize: 18 }} /> : <UnpinIcon sx={{ fontSize: 18 }} />}
      </IconButton>
    </Tooltip>
  );
};

