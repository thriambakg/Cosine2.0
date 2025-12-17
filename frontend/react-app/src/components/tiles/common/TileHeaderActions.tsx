import React, { useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon, Palette as PaletteIcon } from '@mui/icons-material';
import { PinButton } from './PinButton';

interface TileHeaderActionsProps {
  // Always visible actions
  pinButton: {
    isPinned: boolean;
    onTogglePin: () => void;
  };
  contextButton?: {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    tooltip: string;
    icon: React.ReactNode;
  };
  deleteButton: {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    icon: React.ReactNode;
  };
  // Customize button (optional)
  customizeButton?: {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  };
  // Collapsible actions (optional)
  collapsibleActions?: React.ReactNode;
  // Optional: persist collapse state
  defaultCollapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

/**
 * Shared tile header actions component with collapse functionality
 * Always shows: Pin, (Context if provided), Delete
 * Collapsible: Other actions (Refresh, Column Selection, Filter, etc.)
 */
export const TileHeaderActions: React.FC<TileHeaderActionsProps> = ({
  pinButton,
  contextButton,
  deleteButton,
  customizeButton,
  collapsibleActions,
  defaultCollapsed = true,
  onCollapseChange,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const handleToggleCollapse = () => {
    const newCollapsed = !collapsed;
    setCollapsed(newCollapsed);
    onCollapseChange?.(newCollapsed);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {/* Collapse/Expand Button */}
      {collapsibleActions && (
        <Tooltip title={collapsed ? 'Expand options' : 'Collapse options'}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleCollapse();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            sx={{
              color: '#9ca3af',
              '&:hover': { color: '#3b82f6' },
              transition: 'all 0.2s ease',
            }}
          >
            {collapsed ? (
              <ChevronLeftIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Tooltip>
      )}

      {/* Always visible: Pin Button */}
      <PinButton
        isPinned={pinButton.isPinned}
        onTogglePin={pinButton.onTogglePin}
      />

      {/* Always visible: Context Button (if provided) */}
      {contextButton && (
        <Tooltip title={contextButton.tooltip}>
          <span>
            <IconButton
              size="small"
              onClick={contextButton.onClick}
              disabled={contextButton.disabled}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{
                color: contextButton.disabled ? '#6b7280' : '#9ca3af',
                '&:hover': { color: contextButton.disabled ? '#6b7280' : '#10b981' },
                '&.Mui-disabled': { color: '#6b7280' },
              }}
            >
              {contextButton.icon}
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Always visible: Customize Button */}
      {customizeButton && (
        <Tooltip title="Customize tile">
          <IconButton
            size="small"
            onClick={customizeButton.onClick}
            onMouseDown={(e) => e.stopPropagation()}
            sx={{
              color: '#9ca3af',
              '&:hover': { color: '#8b5cf6' },
            }}
          >
            <PaletteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      {/* Collapsible Actions */}
      {collapsibleActions && (
        <Box
          sx={{
            display: 'flex',
            gap: 0.5,
            alignItems: 'center',
            overflow: 'hidden',
            maxWidth: collapsed ? 0 : '1000px',
            opacity: collapsed ? 0 : 1,
            transition: 'max-width 0.3s ease, opacity 0.3s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {collapsibleActions}
        </Box>
      )}

      {/* Always visible: Delete Button */}
      <Tooltip title="Remove tile">
        <IconButton
          size="small"
          onClick={deleteButton.onClick}
          onMouseDown={(e) => e.stopPropagation()}
          sx={{ color: '#9ca3af', '&:hover': { color: '#dc2626' } }}
        >
          {deleteButton.icon}
        </IconButton>
      </Tooltip>
    </Box>
  );
};

