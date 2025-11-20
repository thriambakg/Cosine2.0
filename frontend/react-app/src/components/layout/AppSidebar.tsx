import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,

  Badge,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Chat as ChatIcon,
  AccountBalanceWallet as AccountBalanceWalletIcon,
  Assessment as AssessmentIcon,
  TrendingUp as TrendingUpIcon,
  Notifications as NotificationsIcon,
  CurrencyBitcoin as CurrencyBitcoinIcon,
  Calculate as CalculateIcon,
  GridOn as GridOnIcon,
  SmartToy as BotIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { setSidebarOpen, setCurrentPage } from '../../store/slices/navigationSlice';

const DRAWER_WIDTH = 280;

// Icon mapping
const iconMap = {
  DashboardIcon,
  ChatIcon,
  AccountBalanceWalletIcon,
  AssessmentIcon,
  TrendingUpIcon,
  NotificationsIcon,
  CurrencyBitcoinIcon,
  CalculateIcon,
  GridOnIcon,
  BotIcon,
  DescriptionIcon,
};

export default function AppSidebar() {
  // const theme = useTheme(); // Removed unused variable
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  
  const { isSidebarOpen, navigationItems } = useAppSelector((state) => state.navigation);

  const handleNavigate = (path: string) => {
    navigate(path);
    dispatch(setCurrentPage(path));
    // Close sidebar on mobile after navigation
    dispatch(setSidebarOpen(false));
  };

  const handleClose = () => {
    dispatch(setSidebarOpen(false));
  };

  const groupedItems = navigationItems.reduce((acc, item) => {
    const category = item.category || 'other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, typeof navigationItems>);

  const categoryLabels = {
    main: 'Main',
    portfolio: 'Portfolio',
    analysis: 'Analysis & Tools',
    other: 'Other',
  };

  const categoryOrder = ['main', 'portfolio', 'analysis', 'other'];

  const renderNavigationSection = (category: string, items: typeof navigationItems) => {
    // Define colors for each category
    const getCategoryColor = (cat: string) => {
      switch (cat) {
        case 'main': return '#22c55e'; // Green
        case 'portfolio': return '#3b82f6'; // Blue
        case 'analysis': return '#dc2626'; // Red
        default: return '#8b8b8b'; // Gray
      }
    };

    const categoryColor = getCategoryColor(category);

    return (
      <Box key={category} sx={{ mb: 2 }}>
        <Typography
          variant="overline"
          sx={{
            px: 3,
            py: 1,
            color: '#9ca3af',
            fontWeight: 600,
            fontSize: '0.75rem',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          {categoryLabels[category as keyof typeof categoryLabels] || category}
        </Typography>
        
        <List sx={{ px: 2 }}>
          {items.map((item) => {
            const IconComponent = iconMap[item.icon as keyof typeof iconMap] || DashboardIcon;
            const isActive = location.pathname === item.path;
            const isDisabled = item.disabled;
            
            return (
              <ListItem key={item.id} disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton
                  onClick={() => !isDisabled && handleNavigate(item.path)}
                  disabled={isDisabled}
                  sx={{
                    borderRadius: '0px',
                    mx: 0.5,
                    background: isActive ? `linear-gradient(135deg, ${categoryColor} 0%, ${categoryColor}dd 100%)` : 'rgba(255, 255, 255, 0.02)',
                    color: isActive ? 'white' : '#e2e8f0',
                    border: isActive ? `1px solid ${categoryColor}` : '1px solid transparent',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                      backgroundColor: isActive 
                        ? `rgba(${categoryColor === '#22c55e' ? '34, 197, 94' : categoryColor === '#3b82f6' ? '59, 130, 246' : '220, 38, 38'}, 0.2)` 
                        : `rgba(${categoryColor === '#22c55e' ? '34, 197, 94' : categoryColor === '#3b82f6' ? '59, 130, 246' : '220, 38, 38'}, 0.1)`,
                      border: `1px solid ${categoryColor}`,
                      transform: 'translateX(4px)',
                    },
                    '&.Mui-disabled': {
                      opacity: 0.5,
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      color: isActive ? 'white' : '#9ca3af',
                      minWidth: 40,
                    }}
                  >
                    {item.badge ? (
                      <Badge
                        badgeContent={item.badge}
                        sx={{
                          '& .MuiBadge-badge': {
                            fontSize: '0.6rem',
                            height: 16,
                            minWidth: 16,
                            backgroundColor: categoryColor,
                            color: '#ffffff',
                            fontWeight: 600,
                            border: '1px solid rgba(15, 23, 42, 0.95)',
                          },
                        }}
                      >
                        <IconComponent fontSize="small" />
                      </Badge>
                    ) : (
                      <IconComponent fontSize="small" />
                    )}
                  </ListItemIcon>
                  
                  <ListItemText
                    primary={item.label}
                    sx={{
                      '& .MuiListItemText-primary': {
                        fontSize: '0.875rem',
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? '#ffffff' : '#e2e8f0',
                      },
                    }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>
    );
  };

  const drawerContent = (
    <Box
      sx={{
        height: '100%',
        background: 'rgba(15, 23, 42, 0.95)',
        position: 'relative',
        overflow: 'hidden',
        borderRight: '2px solid #374151',
      }}
    >
      {/* Background Effects */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.3)',
          zIndex: 1,
        }}
      />
      
      <Box sx={{ position: 'relative', zIndex: 2, height: '100%' }}>
        {/* Header */}
        <Box
          sx={{
            p: 3,
            borderBottom: '1px solid #374151',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <Box display="flex" alignItems="center">
            <Box
              component="img"
              src="/logo-dark.svg"
              alt="Cosine"
              sx={{
                height: 40,
                width: 'auto',
                filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
              }}
            />
          </Box>
        </Box>

        {/* Navigation Items */}
        <Box sx={{ flex: 1, overflow: 'auto', py: 2 }}>
          {categoryOrder.map((category) => {
            const items = groupedItems[category];
            return items && items.length > 0 ? renderNavigationSection(category, items) : null;
          })}
        </Box>

        {/* Footer */}
        <Box sx={{ 
          p: 2, 
          borderTop: '1px solid #374151',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(10px)',
        }}>
          <Box 
            sx={{ 
              p: 2, 
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '0px',
              border: '1px solid #374151',
              backdropFilter: 'blur(10px)',
            }}
          >
            <Typography variant="caption" sx={{ 
              color: '#9ca3af', 
              textAlign: 'center', 
              display: 'block',
              fontWeight: 500,
              fontSize: '0.75rem',
            }}>
              © 2025 Cosine AI
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Drawer
      variant="temporary"
      open={isSidebarOpen}
      onClose={handleClose}
      ModalProps={{
        keepMounted: true, // Better open performance on mobile
      }}
      sx={{
        display: { xs: 'block' },
        '& .MuiDrawer-paper': {
          boxSizing: 'border-box',
          width: DRAWER_WIDTH,
          border: 'none',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(20px)',
        },
      }}
    >
      {drawerContent}
    </Drawer>
  );
}

