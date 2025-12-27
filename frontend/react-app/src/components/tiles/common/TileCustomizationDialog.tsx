import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Grid,
  IconButton,
  Tooltip,
  Divider,
} from '@mui/material';
import {
  Close as CloseIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import * as Icons from '@mui/icons-material';

// Common Material-UI icons for tiles
const AVAILABLE_ICONS = [
  { name: 'TrendingUp', icon: Icons.TrendingUp, label: 'Trending Up' },
  { name: 'AccountBalance', icon: Icons.AccountBalance, label: 'Account Balance' },
  { name: 'Article', icon: Icons.Article, label: 'Article' },
  { name: 'Assessment', icon: Icons.Assessment, label: 'Assessment' },
  { name: 'Description', icon: Icons.Description, label: 'Description' },
  { name: 'Gavel', icon: Icons.Gavel, label: 'Gavel' },
  { name: 'Dashboard', icon: Icons.Dashboard, label: 'Dashboard' },
  { name: 'BarChart', icon: Icons.BarChart, label: 'Bar Chart' },
  { name: 'PieChart', icon: Icons.PieChart, label: 'Pie Chart' },
  { name: 'ShowChart', icon: Icons.ShowChart, label: 'Show Chart' },
  { name: 'Timeline', icon: Icons.Timeline, label: 'Timeline' },
  { name: 'Analytics', icon: Icons.Analytics, label: 'Analytics' },
  { name: 'Business', icon: Icons.Business, label: 'Business' },
  { name: 'CorporateFare', icon: Icons.CorporateFare, label: 'Corporate' },
  { name: 'AccountTree', icon: Icons.AccountTree, label: 'Account Tree' },
  { name: 'Folder', icon: Icons.Folder, label: 'Folder' },
  { name: 'FolderOpen', icon: Icons.FolderOpen, label: 'Folder Open' },
  { name: 'Star', icon: Icons.Star, label: 'Star' },
  { name: 'StarBorder', icon: Icons.StarBorder, label: 'Star Border' },
  { name: 'Favorite', icon: Icons.Favorite, label: 'Favorite' },
  { name: 'Bookmark', icon: Icons.Bookmark, label: 'Bookmark' },
  { name: 'Label', icon: Icons.Label, label: 'Label' },
  { name: 'Tag', icon: Icons.Tag, label: 'Tag' },
  { name: 'Category', icon: Icons.Category, label: 'Category' },
  { name: 'List', icon: Icons.List, label: 'List' },
  { name: 'ViewList', icon: Icons.ViewList, label: 'View List' },
  { name: 'ViewModule', icon: Icons.ViewModule, label: 'View Module' },
  { name: 'GridView', icon: Icons.GridView, label: 'Grid View' },
  { name: 'TableChart', icon: Icons.TableChart, label: 'Table Chart' },
  { name: 'InsertChart', icon: Icons.InsertChart, label: 'Insert Chart' },
  { name: 'QueryStats', icon: Icons.QueryStats, label: 'Query Stats' },
  { name: 'Search', icon: Icons.Search, label: 'Search' },
  { name: 'FilterList', icon: Icons.FilterList, label: 'Filter List' },
  { name: 'Tune', icon: Icons.Tune, label: 'Tune' },
  { name: 'Settings', icon: Icons.Settings, label: 'Settings' },
  { name: 'Build', icon: Icons.Build, label: 'Build' },
  { name: 'Construction', icon: Icons.Construction, label: 'Construction' },
  { name: 'Engineering', icon: Icons.Engineering, label: 'Engineering' },
  { name: 'Science', icon: Icons.Science, label: 'Science' },
  { name: 'School', icon: Icons.School, label: 'School' },
  { name: 'Work', icon: Icons.Work, label: 'Work' },
  { name: 'BusinessCenter', icon: Icons.BusinessCenter, label: 'Business Center' },
  { name: 'Store', icon: Icons.Store, label: 'Store' },
  { name: 'ShoppingCart', icon: Icons.ShoppingCart, label: 'Shopping Cart' },
  { name: 'LocalOffer', icon: Icons.LocalOffer, label: 'Local Offer' },
  { name: 'AttachMoney', icon: Icons.AttachMoney, label: 'Attach Money' },
  { name: 'Paid', icon: Icons.Paid, label: 'Paid' },
  { name: 'MonetizationOn', icon: Icons.MonetizationOn, label: 'Monetization' },
  { name: 'CurrencyExchange', icon: Icons.CurrencyExchange, label: 'Currency Exchange' },
  { name: 'Savings', icon: Icons.Savings, label: 'Savings' },
  { name: 'AccountBalanceWallet', icon: Icons.AccountBalanceWallet, label: 'Wallet' },
  { name: 'CreditCard', icon: Icons.CreditCard, label: 'Credit Card' },
  { name: 'Receipt', icon: Icons.Receipt, label: 'Receipt' },
  { name: 'ReceiptLong', icon: Icons.ReceiptLong, label: 'Receipt Long' },
  { name: 'FileCopy', icon: Icons.FileCopy, label: 'File Copy' },
  { name: 'Note', icon: Icons.Note, label: 'Note' },
  { name: 'NoteAdd', icon: Icons.NoteAdd, label: 'Note Add' },
  { name: 'StickyNote2', icon: Icons.StickyNote2, label: 'Sticky Note' },
  { name: 'Edit', icon: Icons.Edit, label: 'Edit' },
  { name: 'EditNote', icon: Icons.EditNote, label: 'Edit Note' },
  { name: 'Create', icon: Icons.Create, label: 'Create' },
  { name: 'AddCircle', icon: Icons.AddCircle, label: 'Add Circle' },
  { name: 'Add', icon: Icons.Add, label: 'Add' },
  { name: 'Remove', icon: Icons.Remove, label: 'Remove' },
  { name: 'Delete', icon: Icons.Delete, label: 'Delete' },
  { name: 'Clear', icon: Icons.Clear, label: 'Clear' },
  { name: 'CheckCircle', icon: Icons.CheckCircle, label: 'Check Circle' },
  { name: 'Cancel', icon: Icons.Cancel, label: 'Cancel' },
  { name: 'Info', icon: Icons.Info, label: 'Info' },
  { name: 'Help', icon: Icons.Help, label: 'Help' },
  { name: 'Warning', icon: Icons.Warning, label: 'Warning' },
  { name: 'Error', icon: Icons.Error, label: 'Error' },
  { name: 'Check', icon: Icons.Check, label: 'Check' },
  { name: 'Close', icon: Icons.Close, label: 'Close' },
];

// Predefined color palette
const COLOR_PALETTE = [
  { name: 'Blue', value: '#3b82f6', label: 'Blue' },
  { name: 'Green', value: '#10b981', label: 'Green' },
  { name: 'Purple', value: '#8b5cf6', label: 'Purple' },
  { name: 'Orange', value: '#f59e0b', label: 'Orange' },
  { name: 'Red', value: '#ef4444', label: 'Red' },
  { name: 'Pink', value: '#ec4899', label: 'Pink' },
  { name: 'Indigo', value: '#6366f1', label: 'Indigo' },
  { name: 'Teal', value: '#14b8a6', label: 'Teal' },
  { name: 'Cyan', value: '#06b6d4', label: 'Cyan' },
  { name: 'Yellow', value: '#eab308', label: 'Yellow' },
  { name: 'Amber', value: '#f59e0b', label: 'Amber' },
  { name: 'Lime', value: '#84cc16', label: 'Lime' },
  { name: 'Emerald', value: '#10b981', label: 'Emerald' },
  { name: 'Sky', value: '#0ea5e9', label: 'Sky' },
  { name: 'Violet', value: '#8b5cf6', label: 'Violet' },
  { name: 'Fuchsia', value: '#d946ef', label: 'Fuchsia' },
  { name: 'Rose', value: '#f43f5e', label: 'Rose' },
  { name: 'Slate', value: '#64748b', label: 'Slate' },
  { name: 'Gray', value: '#6b7280', label: 'Gray' },
  { name: 'Zinc', value: '#71717a', label: 'Zinc' },
  { name: 'Neutral', value: '#737373', label: 'Neutral' },
  { name: 'Stone', value: '#78716c', label: 'Stone' },
];

interface TileCustomizationDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (customizations: {
    customTitle?: string;
    customColor?: string;
    customIcon?: string;
  }) => void;
  currentTitle: string;
  currentColor?: string;
  currentIcon?: string;
}

export const TileCustomizationDialog: React.FC<TileCustomizationDialogProps> = ({
  open,
  onClose,
  onSave,
  currentTitle,
  currentColor,
  currentIcon,
}) => {
  const [title, setTitle] = useState(currentTitle);
  const [selectedColor, setSelectedColor] = useState(currentColor || '#3b82f6');
  const [selectedIcon, setSelectedIcon] = useState(currentIcon || 'TrendingUp');

  useEffect(() => {
    if (open) {
      setTitle(currentTitle);
      setSelectedColor(currentColor || '#3b82f6');
      setSelectedIcon(currentIcon || 'TrendingUp');
    }
  }, [open, currentTitle, currentColor, currentIcon]);

  const handleSave = () => {
    onSave({
      customTitle: title.trim() || undefined,
      customColor: selectedColor !== '#3b82f6' ? selectedColor : undefined,
      customIcon: selectedIcon !== 'TrendingUp' ? selectedIcon : undefined,
    });
    onClose();
  };

  const handleReset = () => {
    setTitle(currentTitle);
    setSelectedColor('#3b82f6');
    setSelectedIcon('TrendingUp');
  };

  const SelectedIconComponent = AVAILABLE_ICONS.find(icon => icon.name === selectedIcon)?.icon || Icons.TrendingUp;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #374151',
          color: '#ffffff',
        },
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderBottom: '1px solid #374151',
        pb: 2,
      }}>
        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
          Customize Tile
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ 
        pt: 3,
        '&::-webkit-scrollbar': {
          width: '6px',
          height: '6px',
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'rgba(55, 65, 81, 0.3)',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          borderRadius: '3px',
        },
        '&::-webkit-scrollbar-thumb:hover': {
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
        },
        '&::-webkit-scrollbar-corner': {
          backgroundColor: 'rgba(55, 65, 81, 0.3)',
        },
      }}>
        {/* Title Input */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1.5, fontWeight: 600 }}>
            Tile Name
          </Typography>
          <TextField
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter tile name"
            variant="outlined"
            sx={{
              '& .MuiOutlinedInput-root': {
                color: '#ffffff',
                '& fieldset': {
                  borderColor: '#374151',
                },
                '&:hover fieldset': {
                  borderColor: '#4b5563',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#3b82f6',
                },
              },
            }}
          />
        </Box>

        <Divider sx={{ my: 3, borderColor: '#374151' }} />

        {/* Color Picker */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1.5, fontWeight: 600 }}>
            Tile Color
          </Typography>
          <Grid container spacing={1}>
            {COLOR_PALETTE.map((color) => (
              <Grid item key={color.name}>
                <Tooltip title={color.label}>
                  <Box
                    onClick={() => setSelectedColor(color.value)}
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '8px',
                      backgroundColor: color.value,
                      cursor: 'pointer',
                      border: selectedColor === color.value ? '3px solid #ffffff' : '2px solid transparent',
                      boxShadow: selectedColor === color.value ? `0 0 0 2px ${color.value}` : 'none',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        transform: 'scale(1.1)',
                        boxShadow: `0 0 0 2px ${color.value}`,
                      },
                    }}
                  />
                </Tooltip>
              </Grid>
            ))}
          </Grid>
        </Box>

        <Divider sx={{ my: 3, borderColor: '#374151' }} />

        {/* Icon Picker */}
        <Box>
          <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1.5, fontWeight: 600 }}>
            Tile Icon
          </Typography>
          <Box
            sx={{
              maxHeight: 300,
              overflowY: 'auto',
              border: '1px solid #374151',
              borderRadius: '8px',
              p: 2,
              backgroundColor: 'rgba(31, 41, 55, 0.5)',
              '&::-webkit-scrollbar': {
                width: '6px',
                height: '6px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'rgba(55, 65, 81, 0.3)',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(59, 130, 246, 0.5)',
                borderRadius: '3px',
              },
              '&::-webkit-scrollbar-thumb:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
              },
              '&::-webkit-scrollbar-corner': {
                backgroundColor: 'rgba(55, 65, 81, 0.3)',
              },
            }}
          >
            <Grid container spacing={1}>
              {AVAILABLE_ICONS.map((iconItem) => {
                const IconComponent = iconItem.icon;
                const isSelected = selectedIcon === iconItem.name;
                return (
                  <Grid item key={iconItem.name}>
                    <Tooltip title={iconItem.label}>
                      <IconButton
                        onClick={() => setSelectedIcon(iconItem.name)}
                        sx={{
                          width: 48,
                          height: 48,
                          color: isSelected ? selectedColor : '#9ca3af',
                          backgroundColor: isSelected ? `${selectedColor}20` : 'transparent',
                          border: isSelected ? `2px solid ${selectedColor}` : '2px solid transparent',
                          '&:hover': {
                            backgroundColor: isSelected ? `${selectedColor}30` : 'rgba(59, 130, 246, 0.1)',
                            borderColor: isSelected ? selectedColor : '#3b82f6',
                          },
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <IconComponent />
                      </IconButton>
                    </Tooltip>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        </Box>

        {/* Preview */}
        <Box sx={{ mt: 4, p: 2, backgroundColor: 'rgba(31, 41, 55, 0.5)', borderRadius: '8px', border: '1px solid #374151' }}>
          <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1.5, fontWeight: 600 }}>
            Preview
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SelectedIconComponent sx={{ color: selectedColor, fontSize: '1.5rem' }} />
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
              {title || 'Tile Name'}
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
        <Button
          onClick={handleReset}
          sx={{
            color: '#9ca3af',
            '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
          }}
        >
          Reset
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={onClose}
          sx={{
            color: '#9ca3af',
            '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          startIcon={<CheckIcon />}
          sx={{
            backgroundColor: selectedColor,
            color: '#ffffff',
            '&:hover': {
              backgroundColor: selectedColor,
              opacity: 0.9,
            },
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

