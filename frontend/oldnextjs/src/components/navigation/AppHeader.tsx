"use client";

import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  Badge,
  Avatar,
  Menu,
  MenuItem,
  Breadcrumbs,
  Link,
  useTheme,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Notifications as BellIcon,
  SmartToy as BotIcon,
  NavigateNext as NavigateNextIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { toggleSidebar } from '@/store/slices/navigationSlice';
import { useAuth } from '@/contexts/AuthContext';

export default function AppHeader() {
  const theme = useTheme();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { user, logout } = useAuth();
  
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notifications] = useState(3); // This would come from Redux in a real app
  
  const { breadcrumbs } = useAppSelector((state) => state.navigation);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    await logout();
    handleMenuClose();
  };

  const handleBreadcrumbClick = (path: string) => {
    router.push(path);
  };

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        zIndex: theme.zIndex.drawer + 1,
        backgroundColor: 'transparent',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${theme.customColors.background.glassBorder}`,
        boxShadow: '0 2px 16px rgba(0, 0, 0, 0.1)',
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', minHeight: 64 }}>
        {/* Left Section - Hamburger + Logo + Breadcrumbs */}
        <Box display="flex" alignItems="center" gap={2}>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={() => dispatch(toggleSidebar())}
            sx={{
              color: 'text.primary',
              backgroundColor: theme.customColors.background.glass,
              backdropFilter: 'blur(8px)',
              border: `1px solid ${theme.customColors.background.glassBorder}`,
              width: 40,
              height: 40,
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
              },
            }}
          >
            <MenuIcon />
          </IconButton>

          {/* Logo for mobile/small screens */}
          <Box display={{ xs: 'flex', md: 'none' }} alignItems="center" gap={1.5}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                background: theme.customColors.primary.gradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BotIcon sx={{ color: 'white', fontSize: 20 }} />
            </Box>
            <Typography variant="h6" fontWeight={600} color="text.primary">
              Cosine
            </Typography>
          </Box>

          {/* Breadcrumbs for larger screens */}
          <Box display={{ xs: 'none', md: 'block' }}>
            <Breadcrumbs
              separator={<NavigateNextIcon fontSize="small" sx={{ color: 'text.secondary' }} />}
              sx={{
                '& .MuiBreadcrumbs-ol': {
                  alignItems: 'center',
                },
              }}
            >
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                
                return isLast ? (
                  <Typography
                    key={crumb.path}
                    color="text.primary"
                    fontWeight={600}
                    fontSize="0.875rem"
                  >
                    {crumb.label}
                  </Typography>
                ) : (
                  <Link
                    key={crumb.path}
                    color="text.secondary"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handleBreadcrumbClick(crumb.path);
                    }}
                    sx={{
                      textDecoration: 'none',
                      fontSize: '0.875rem',
                      '&:hover': {
                        color: 'text.primary',
                        textDecoration: 'underline',
                      },
                    }}
                  >
                    {crumb.label}
                  </Link>
                );
              })}
            </Breadcrumbs>
          </Box>
        </Box>

        {/* Right Section - Notifications + Profile */}
        <Box display="flex" alignItems="center" gap={1}>
          <IconButton
            color="inherit"
            sx={{
              color: 'text.secondary',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            <Badge badgeContent={notifications} color="error">
              <BellIcon />
            </Badge>
          </IconButton>

          <IconButton onClick={handleProfileMenuOpen} sx={{ p: 0.5 }}>
            <Avatar
              sx={{
                width: 36,
                height: 36,
                bgcolor: 'primary.main',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}
            >
              {user?.firstName?.[0] || 'U'}
            </Avatar>
          </IconButton>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            PaperProps={{
              sx: {
                mt: 1,
                backgroundColor: theme.customColors.background.glass,
                backdropFilter: 'blur(16px)',
                border: `1px solid ${theme.customColors.background.glassBorder}`,
                boxShadow: theme.shadows[8],
              },
            }}
          >
            <MenuItem onClick={handleMenuClose}>
              <Typography variant="body2">Profile</Typography>
            </MenuItem>
            <MenuItem onClick={handleMenuClose}>
              <Typography variant="body2">Settings</Typography>
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              <Typography variant="body2">Logout</Typography>
            </MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
