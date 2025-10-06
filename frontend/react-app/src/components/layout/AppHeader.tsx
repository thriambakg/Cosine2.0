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
  NavigateNext as NavigateNextIcon,
  AccessTime as ClockIcon,
  Dashboard as ContextIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { toggleSidebar } from '../../store/slices/navigationSlice';
import { useAuth } from '../../contexts/AuthContext';
import { useContextWindow } from '../../contexts/ContextWindowContext';
import NotificationCenter from './NotificationCenter';

export default function AppHeader() {
  const theme = useTheme();
  const navigate = useNavigate();
  // const location = useLocation(); // Removed unused variable
  const dispatch = useAppDispatch();
  const { user, logout } = useAuth();
  const { isVisible: isContextVisible, setIsVisible: setContextVisible } = useContextWindow();
  
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notificationAnchorEl, setNotificationAnchorEl] = useState<null | HTMLElement>(null);
  const [notifications] = useState(3); // This would come from Redux in a real app
  const [isClockVisible, setIsClockVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem('floating-clock-visible');
    return saved ? JSON.parse(saved) : false; // Default to hidden
  });
  
  const { breadcrumbs } = useAppSelector((state) => state.navigation);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleNotificationMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setNotificationAnchorEl(event.currentTarget);
  };

  const handleNotificationMenuClose = () => {
    setNotificationAnchorEl(null);
  };

  const handleLogout = async () => {
    await logout();
    handleMenuClose();
  };

  const handleBreadcrumbClick = (path: string) => {
    navigate(path);
  };

  const handleClockToggle = () => {
    const newVisibility = !isClockVisible;
    setIsClockVisible(newVisibility);
    localStorage.setItem('floating-clock-visible', JSON.stringify(newVisibility));
    
    // Dispatch a custom event to notify the FloatingClock component
    window.dispatchEvent(new CustomEvent('clock-visibility-changed', { 
      detail: { isVisible: newVisibility } 
    }));
  };

  const handleContextToggle = () => {
    setContextVisible(!isContextVisible);
  };

  return (
    <>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          backgroundColor: 'rgba(15, 15, 20, 0.95)',
          backdropFilter: 'blur(20px)',
          borderBottom: '2px solid #1a1a2e',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent, #ff4757, #2ed573, #3742fa, transparent)',
          },
        }}
      >
        <Toolbar sx={{ 
          justifyContent: 'space-between', 
          minHeight: 70,
          px: 3,
          background: 'linear-gradient(135deg, rgba(15, 15, 20, 0.8) 0%, rgba(26, 26, 46, 0.8) 100%)',
        }}>
          {/* Left Section - Hamburger + Logo + Breadcrumbs */}
          <Box display="flex" alignItems="center" gap={2}>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={() => dispatch(toggleSidebar())}
              sx={{
                color: '#ffffff',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                width: 44,
                height: 44,
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                },
              }}
            >
              <MenuIcon />
            </IconButton>

            {/* Logo and current page for mobile/small screens */}
            <Box display={{ xs: 'flex', md: 'none' }} alignItems="center" gap={1.5}>
              <Box
                component="img"
                src="/logo-dark.svg"
                alt="Cosine"
                sx={{
                  height: 36,
                  width: 'auto',
                  filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
                }}
              />
              {breadcrumbs.length > 1 && (
                <Typography 
                  variant="caption" 
                  sx={{
                    color: '#9ca3af',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {breadcrumbs[breadcrumbs.length - 1].label}
                </Typography>
              )}
            </Box>

            {/* Breadcrumbs for larger screens */}
            <Box display={{ xs: 'none', md: 'block' }}>
              <Breadcrumbs
                separator={<NavigateNextIcon fontSize="small" sx={{ color: '#8b8b8b' }} />}
                sx={{
                  '& .MuiBreadcrumbs-ol': {
                    alignItems: 'center',
                  },
                  '& .MuiBreadcrumbs-separator': {
                    margin: '0 8px',
                  },
                }}
              >
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  
                  return isLast ? (
                    <Typography
                      key={crumb.path}
                      sx={{
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                      }}
                    >
                      {crumb.label}
                    </Typography>
                  ) : (
                    <Link
                      key={crumb.path}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        handleBreadcrumbClick(crumb.path);
                      }}
                      sx={{
                        textDecoration: 'none',
                        fontSize: '0.875rem',
                        color: '#8b8b8b',
                        fontWeight: 500,
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          color: '#ffffff',
                          textDecoration: 'none',
                          textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
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

          {/* Right Section - Context + Clock + Notifications + Profile */}
          <Box display="flex" alignItems="center" gap={1}>
            <IconButton
              color="inherit"
              onClick={handleContextToggle}
              sx={{
                color: isContextVisible ? '#3b82f6' : '#8b8b8b',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                width: 44,
                height: 44,
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: isContextVisible ? '#60a5fa' : '#ffffff',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                },
              }}
            >
              <ContextIcon />
            </IconButton>
            
            <IconButton
              color="inherit"
              onClick={handleClockToggle}
              sx={{
                color: isClockVisible ? '#f59e0b' : '#8b8b8b',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                width: 44,
                height: 44,
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: isClockVisible ? '#fbbf24' : '#ffffff',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                },
              }}
            >
              <ClockIcon />
            </IconButton>
            
            <IconButton
              color="inherit"
              onClick={handleNotificationMenuOpen}
              sx={{
                color: '#8b8b8b',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                width: 44,
                height: 44,
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                },
              }}
            >
              <Badge 
                badgeContent={notifications} 
                sx={{
                  '& .MuiBadge-badge': {
                    backgroundColor: '#ff4757',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    minWidth: 18,
                    height: 18,
                    borderRadius: '9px',
                    border: '2px solid rgba(15, 15, 20, 0.95)',
                  }
                }}
              >
                <BellIcon />
              </Badge>
            </IconButton>

            <IconButton 
              onClick={handleProfileMenuOpen} 
              sx={{ 
                p: 0.5,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                },
              }}
            >
              <Avatar
                sx={{
                  width: 40,
                  height: 40,
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  border: '2px solid #374151',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
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
                  backgroundColor: 'rgba(15, 15, 20, 0.95)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                  '& .MuiMenuItem-root': {
                    color: '#ffffff',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    },
                  },
                },
              }}
            >
              <MenuItem onClick={handleMenuClose}>
                <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 500 }}>Profile</Typography>
              </MenuItem>
              <MenuItem onClick={handleMenuClose}>
                <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 500 }}>Settings</Typography>
              </MenuItem>
              <MenuItem onClick={handleLogout}>
                <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 500 }}>Logout</Typography>
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Notification Center */}
      <NotificationCenter
        anchorEl={notificationAnchorEl}
        onClose={handleNotificationMenuClose}
      />
    </>
  );
}

