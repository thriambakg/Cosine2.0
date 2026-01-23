import React, { useState, useEffect } from 'react';
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  Avatar,
  Menu,
  MenuItem,
  Breadcrumbs,
  Link,
  useTheme,
  Badge,
} from '@mui/material';
import {
  Menu as MenuIcon,
  NavigateNext as NavigateNextIcon,
  Chat as ChatIcon,
  Close as CloseIcon,
  HelpOutline as HelpIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { toggleSidebar } from '../../store/slices/navigationSlice';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalChat } from '../../contexts/GlobalChatContext';
import { useDualScreenMode } from '../../contexts/DualScreenModeContext';
import { useDialogManager } from '../../contexts/DialogManagerContext';
import { useEasyMode } from '../../contexts/EasyModeContext';
import { useTutorial } from '../../contexts/TutorialContext';
import WindowsIcon from '../common/WindowsIcon';
import { JellyToggle } from '../common/JellyToggle';

export default function AppHeader() {
  const theme = useTheme();
  const navigate = useNavigate();
  // const location = useLocation(); // Removed unused variable
  const dispatch = useAppDispatch();
  const { user, logout } = useAuth();
  const { isVisible: isGlobalChatVisible, toggle: toggleGlobalChat } = useGlobalChat();
  const { setDualScreenMode } = useDualScreenMode();
  const { dialogs, restoreDialog, closeDialog } = useDialogManager();
  const { isEasyMode, toggleEasyMode } = useEasyMode();
  const { startTutorial } = useTutorial();
  
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [helpMenuAnchor, setHelpMenuAnchor] = useState<null | HTMLElement>(null);
  const [windowsMenuAnchor, setWindowsMenuAnchor] = useState<null | HTMLElement>(null);
  const [shouldJump, setShouldJump] = useState(false);
  
  const { breadcrumbs } = useAppSelector((state) => state.navigation);
  
  // Automatically enable/disable dual screen mode based on chat visibility
  // This syncs dual screen mode with chat visibility: open chat = dual screen, close chat = full screen
  useEffect(() => {
    setDualScreenMode(isGlobalChatVisible);
  }, [isGlobalChatVisible, setDualScreenMode]);

  // Listen for context additions when sidebar is closed - trigger jump animation
  useEffect(() => {
    const handleSidebarContextSuccess = (_event: CustomEvent) => {
      // Only jump if sidebar is not visible
      if (!isGlobalChatVisible) {
        setShouldJump(true);
        // Reset after animation completes (4 jumps * 0.75s each = 3s, add buffer)
        const timer = setTimeout(() => {
          setShouldJump(false);
        }, 3200);
        return () => clearTimeout(timer);
      }
    };

    window.addEventListener('sidebar-context-success', handleSidebarContextSuccess as EventListener);

    return () => {
      window.removeEventListener('sidebar-context-success', handleSidebarContextSuccess as EventListener);
    };
  }, [isGlobalChatVisible]);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleHelpMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setHelpMenuAnchor(event.currentTarget);
  };

  const handleHelpMenuClose = () => {
    setHelpMenuAnchor(null);
  };

  const handleLogout = async () => {
    await logout();
    handleMenuClose();
  };

  const handleBreadcrumbClick = (path: string) => {
    navigate(path);
  };

  const handleWindowsMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setWindowsMenuAnchor(event.currentTarget);
  };

  const handleWindowsMenuClose = () => {
    setWindowsMenuAnchor(null);
  };

  const handleRestoreDialog = (id: string) => {
    restoreDialog(id);
    handleWindowsMenuClose();
  };

  const handleCloseDialog = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeDialog(id);
    const minimizedDialogs = dialogs.filter(d => d.isMinimized);
    if (minimizedDialogs.length === 1) {
      handleWindowsMenuClose();
    }
  };

  const minimizedDialogs = dialogs.filter(d => d.isMinimized);
  const activeDialogs = dialogs.filter(d => !d.isMinimized);
  const totalDialogCount = dialogs.length;

  const helpSections = [
    {
      title: 'Main',
      items: [
        { label: 'Welcome Tutorial', path: '/', key: 'welcome' },
        { label: 'Dashboard Tutorial', path: '/', key: 'dashboard' },
        { label: 'Chat Tutorial', path: '/chat', key: 'chat' },
        { label: 'Files Tutorial', path: '/files', key: 'files' },
      ],
    },
    {
      title: 'Portfolio',
      items: [
        { label: 'Portfolio Risk Tutorial', path: '/portfolio-risk', key: 'portfolio-risk' },
        { label: 'Stock Screener Tutorial', path: '/stock-screener-search', key: 'stock-screener-search' },
      ],
    },
    {
      title: 'Government Data',
      items: [
        { label: 'SEC Search Tutorial', path: '/sec-search', key: 'sec-search' },
        { label: 'Politician Trades Tutorial', path: '/politician-trades-search', key: 'politician-trades' },
        { label: 'Gov Contracts Tutorial', path: '/govt-contracts-search', key: 'govt-contracts' },
        { label: 'Congress Bills Tutorial', path: '/congress-bills-search', key: 'congress-bills' },
        { label: 'LDA Search Tutorial', path: '/lda-search', key: 'lda-search' },
      ],
    },
    {
      title: 'News',
      items: [
        { label: 'News Search Tutorial', path: '/news-search', key: 'news-search' },
      ],
    },
    {
      title: 'Dialogs',
      items: [
        { label: 'File Preview Tutorial', path: '/files', key: 'file-preview' },
        { label: 'Details Window Tutorial', path: '/files', key: 'item-details' },
      ],
    },
  ];

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
              data-tutorial="hamburger-menu"
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
                alt="FinGov"
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

          {/* Right Section - Windows + Chat + Profile */}
          <Box display="flex" alignItems="center" gap={1}>
            {/* Windows Menu Button */}
            {totalDialogCount > 0 && (
              <>
                <IconButton
                  color="inherit"
                  onClick={handleWindowsMenuOpen}
                  sx={{
                    color: windowsMenuAnchor ? '#3b82f6' : '#8b8b8b',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    width: 44,
                    height: 44,
                    borderRadius: '8px',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      color: '#3b82f6',
                      transform: 'translateY(-1px)',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    },
                  }}
                >
                  <Badge badgeContent={totalDialogCount} color="primary" max={99}>
                    <WindowsIcon fontSize="medium" />
                  </Badge>
                </IconButton>

                <Menu
                  anchorEl={windowsMenuAnchor}
                  open={Boolean(windowsMenuAnchor)}
                  onClose={handleWindowsMenuClose}
                  transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                  anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                  PaperProps={{
                    sx: {
                      mt: 1,
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      minWidth: 250,
                      maxWidth: 400,
                      maxHeight: 500,
                      overflow: 'auto',
                    },
                  }}
                >
                  {minimizedDialogs.length > 0 && (
                    <>
                      <MenuItem disabled sx={{ color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>
                      Minimized ({minimizedDialogs.length})
                    </MenuItem>
                      {minimizedDialogs.map((dialog) => (
                        <MenuItem
                          key={dialog.id}
                          onClick={() => handleRestoreDialog(dialog.id)}
                          sx={{
                            color: '#ffffff',
                            '&:hover': {
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            },
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {dialog.title}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={(e) => handleCloseDialog(dialog.id, e)}
                            sx={{
                              color: '#ef4444',
                              ml: 1,
                              '&:hover': {
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                              },
                            }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </MenuItem>
                      ))}
                      {activeDialogs.length > 0 && <Box sx={{ borderTop: '1px solid #374151', my: 0.5 }} />}
                    </>
                  )}
                  
                  {activeDialogs.length > 0 && (
                    <>
                      <MenuItem disabled sx={{ color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>
                        Active ({activeDialogs.length})
                      </MenuItem>
                      {activeDialogs.map((dialog) => (
                        <MenuItem
                          key={dialog.id}
                          disabled
                          sx={{
                            color: '#9ca3af',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {dialog.title}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#6b7280', ml: 1 }}>
                            Open
                          </Typography>
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Menu>
              </>
            )}

            <IconButton
              color="inherit"
              data-tutorial="chat-button"
              onClick={() => {
                // Toggle chat visibility - this will automatically manage dual screen mode
                toggleGlobalChat();
              }}
              sx={{
                color: isGlobalChatVisible ? '#10b981' : '#8b8b8b',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                width: 44,
                height: 44,
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                animation: shouldJump ? 'jump 0.75s ease-in-out 4' : 'none',
                '@keyframes jump': {
                  '0%, 100%': { transform: 'translateY(0)' },
                  '25%': { transform: 'translateY(-8px)' },
                  '50%': { transform: 'translateY(0)' },
                  '75%': { transform: 'translateY(-8px)' },
                },
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: isGlobalChatVisible ? '#34d399' : '#ffffff',
                  transform: shouldJump ? undefined : 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                },
              }}
            >
              <ChatIcon />
            </IconButton>

            {/* Help Button */}
            <IconButton
              color="inherit"
              onClick={handleHelpMenuOpen}
              sx={{
                color: helpMenuAnchor ? '#3b82f6' : '#8b8b8b',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                width: 44,
                height: 44,
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#3b82f6',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                },
              }}
            >
              <HelpIcon />
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
              <MenuItem 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleEasyMode();
                }}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 500 }}>
                  Easy Mode
                </Typography>
                <JellyToggle checked={isEasyMode} onChange={toggleEasyMode} />
              </MenuItem>
              <MenuItem onClick={handleLogout}>
                <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 500 }}>Logout</Typography>
              </MenuItem>
            </Menu>

            {/* Help Menu */}
            <Menu
              anchorEl={helpMenuAnchor}
              open={Boolean(helpMenuAnchor)}
              onClose={handleHelpMenuClose}
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
                  maxHeight: '70vh',
                  overflowY: 'auto',
                  '&::-webkit-scrollbar': {
                    width: '6px',
                  },
                  '&::-webkit-scrollbar-track': {
                    backgroundColor: '#475569',
                    borderRadius: '3px',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: '#3b82f6',
                    borderRadius: '3px',
                    '&:hover': {
                      backgroundColor: '#2563eb',
                    },
                  },
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
              {helpSections.map((section, sectionIdx) => (
                <Box key={section.title} sx={{ 
                  borderTop: sectionIdx === 0 ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                  pt: sectionIdx === 0 ? 0 : 0.5,
                  mt: sectionIdx === 0 ? 0 : 0.5,
                }}>
                  <Typography variant="caption" sx={{ color: '#9ca3af', px: 2, py: 1, display: 'block', fontWeight: 700, letterSpacing: '0.5px' }}>
                    {section.title}
                  </Typography>
                  {section.items.map(item => (
                    <MenuItem 
                      key={item.key}
                      onClick={() => {
                        handleHelpMenuClose();
                        // Dialog tutorials don't need to navigate, they appear on current page
                        if (item.key !== 'file-preview' && item.key !== 'item-details') {
                          navigate(item.path);
                          setTimeout(() => startTutorial(item.key), 300);
                        } else {
                          startTutorial(item.key);
                        }
                      }}
                    >
                      <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 500 }}>{item.label}</Typography>
                    </MenuItem>
                  ))}
                </Box>
              ))}
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>
    </>
  );
}

