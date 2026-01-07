import React from 'react';
import { Box, Paper, Typography, IconButton, Button, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import FolderIcon from '@mui/icons-material/Folder';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DownloadIcon from '@mui/icons-material/Download';

const commonContainerSx = {
  position: 'fixed' as const,
  top: 80,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 900,
  height: 560,
  backgroundColor: '#1f2937',
  border: '2px solid #374151',
  color: '#ffffff',
  display: 'flex',
  flexDirection: 'column' as const,
  overflow: 'hidden',
  zIndex: 9990,
  pointerEvents: 'none' as const, // non-interactive mock
};

const titleBarSx = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid #374151',
  pb: 2,
  pt: 2,
  px: 3,
  userSelect: 'none',
};

const actionsBarSx = {
  borderTop: '1px solid #374151',
  p: 2,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 2,
};

const iconButtonSx = { color: '#9ca3af' };

export const MockFilePreviewDialog: React.FC = () => {
  return (
    <Paper sx={commonContainerSx} elevation={8}>
      <Box data-title-bar data-tutorial="file-preview-titlebar" sx={titleBarSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ color: '#ffffff' }}>File Preview</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Add to Context"><span><IconButton sx={iconButtonSx}><DashboardIcon /></IconButton></span></Tooltip>
          <Tooltip title="Minimize"><span><IconButton sx={iconButtonSx}><MinimizeIcon /></IconButton></span></Tooltip>
          <Tooltip title="Close"><span><IconButton sx={iconButtonSx}><CloseIcon /></IconButton></span></Tooltip>
        </Box>
      </Box>

      <Box data-tutorial="file-preview-content" sx={{ flex: 1, p: 0, mt: 2, position: 'relative' }}>
        <Box sx={{ m: 3, p: 3, border: '1px dashed #374151', borderRadius: '4px', color: '#9ca3af' }}>
          Mock preview content area
        </Box>
      </Box>

      <Box data-tutorial="file-preview-actions" sx={actionsBarSx}>
        <Button sx={{ color: '#9ca3af' }}>Close</Button>
        <Button variant="contained" startIcon={<DownloadIcon />} sx={{ backgroundColor: '#3b82f6', color: '#ffffff' }}>Download</Button>
      </Box>
    </Paper>
  );
};

export const MockItemDetailsDialog: React.FC = () => {
  return (
    <Paper sx={{ ...commonContainerSx, top: 120 }} elevation={8}>
      <Box data-title-bar data-tutorial="item-details-titlebar" sx={{ ...titleBarSx, position: 'relative' }}>
        <Typography component="div" variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
          Item Details
        </Typography>
        <Box data-tutorial="item-details-actions" sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Add to Context"><span><IconButton size="small" sx={iconButtonSx}><DashboardIcon fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Save to Files"><span><IconButton size="small" sx={{ color: '#fbbf24' }}><FolderIcon fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Minimize"><span><IconButton size="small" sx={iconButtonSx}><MinimizeIcon fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Close"><span><IconButton size="small" sx={iconButtonSx}><CloseIcon fontSize="small" /></IconButton></span></Tooltip>
        </Box>
      </Box>

      <Box data-tutorial="item-details-content" sx={{ mt: 2, p: 2.5, flex: 1, overflow: 'auto' }}>
        <Box sx={{ p: 3, border: '1px dashed #374151', borderRadius: '4px', color: '#9ca3af' }}>
          Mock details content area
        </Box>
      </Box>

      <Box sx={actionsBarSx}>
        <Button sx={{ color: '#94a3b8' }}>Close</Button>
      </Box>
    </Paper>
  );
};

export default function TutorialMockDialogs({ type }: { type: 'file-preview' | 'item-details' }) {
  if (type === 'file-preview') return <MockFilePreviewDialog />;
  if (type === 'item-details') return <MockItemDetailsDialog />;
  return null;
}
