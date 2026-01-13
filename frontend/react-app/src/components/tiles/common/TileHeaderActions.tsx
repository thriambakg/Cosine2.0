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
    disabled?: boolean;
  };
  // Customize button (optional) - shown when expanded, hidden when collapsed
  customizeButton?: {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  };
  // Edit button (optional) - shown next to delete button
  editButton?: {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    tooltip?: string;
    icon?: React.ReactNode;
  };
  // Refresh button (optional) - shown when collapsed, replaces customize
  refreshButton?: {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    isLoading?: boolean;
    icon: React.ReactNode;
  };
  // Collapsible actions (optional)
  collapsibleActions?: React.ReactNode;
  // Optional: element to show right before the collapse toggle (moves with toggle)
  preToggleElement?: React.ReactNode;
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
  editButton,
  refreshButton,
  collapsibleActions,
  preToggleElement,
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
      {/* Pre-toggle element (e.g., disclaimer tooltip) - appears right before collapse toggle */}
      {preToggleElement}
      
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
              <ChevronRightIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronLeftIcon sx={{ fontSize: 18 }} />
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

      {/* Refresh Button - shown when collapsed (replaces customize) */}
      {collapsed && refreshButton && (
        <Tooltip title="Refresh">
          <span>
            <IconButton
              size="small"
              onClick={refreshButton.onClick}
              disabled={refreshButton.disabled}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{
                color: refreshButton.disabled ? '#6b7280' : '#9ca3af',
                '&:hover': { color: refreshButton.disabled ? '#6b7280' : '#3b82f6' },
                '&.Mui-disabled': { color: '#6b7280' },
              }}
            >
              {refreshButton.icon}
            </IconButton>
          </span>
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

      {/* Customize Button - shown when expanded, next to delete */}
      {!collapsed && customizeButton && (
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

      {/* Edit Button - shown next to delete button */}
      {editButton && (
        <Tooltip title={editButton.tooltip || 'Edit'}>
          <span>
            <IconButton
              size="small"
              onClick={editButton.onClick}
              disabled={editButton.disabled}
              onMouseDown={(e) => e.stopPropagation()}
              sx={{
                color: editButton.disabled ? '#6b7280' : '#9ca3af',
                '&:hover': { color: editButton.disabled ? '#6b7280' : '#3b82f6' },
                '&.Mui-disabled': { color: '#6b7280' },
              }}
            >
              {editButton.icon || <PaletteIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Always visible: Delete Button */}
      <Tooltip title="Remove tile">
        <span>
          <IconButton
            size="small"
            onClick={deleteButton.onClick}
            disabled={deleteButton.disabled}
            onMouseDown={(e) => e.stopPropagation()}
            sx={{
              color: deleteButton.disabled ? '#6b7280' : '#9ca3af',
              '&:hover': { color: deleteButton.disabled ? '#6b7280' : '#dc2626' },
              '&.Mui-disabled': { color: '#6b7280' },
            }}
          >
            {deleteButton.icon}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
};
