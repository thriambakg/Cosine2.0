import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useAppDispatch } from '../../store/hooks';
import { setCurrentPage } from '../../store/slices/navigationSlice';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import FloatingClock from './FloatingClock';
import GlobalChatSidebar from './GlobalChatSidebar';
import ContextSessionHandler from './ContextSessionHandler';
import ContextSuccessNotification from '../common/ContextSuccessNotification';
import { ClockProvider } from '../../contexts/ClockContext';
// import { WebSocketProvider } from '../../contexts/WebSocketContext'; // COMMENTED OUT: Replaced by UnifiedMessageHandler
import { GlobalChatProvider } from '../../contexts/GlobalChatContext';
import { DualScreenModeProvider, useDualScreenMode } from '../../contexts/DualScreenModeContext';

interface AppLayoutProps {
  children: React.ReactNode;
}

// Inner component that uses dual screen mode
const AppLayoutContent: React.FC<AppLayoutProps> = ({ children }) => {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { isDualScreenMode, sidebarWidth } = useDualScreenMode();

  useEffect(() => {
    dispatch(setCurrentPage(location.pathname));
  }, [location.pathname, dispatch]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <AppHeader />
      
      {/* Sidebar */}
      <AppSidebar />
      
      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pt: 8, // Account for fixed header
          minHeight: '100vh',
          backgroundColor: 'transparent',
          // Adjust margin when in dual screen mode to account for sidebar
          marginRight: isDualScreenMode ? `${sidebarWidth}px` : 0,
          transition: 'margin-right 0.3s ease-in-out',
        }}
      >
        {children}
      </Box>
      
      {/* Floating Clock */}
      <FloatingClock />
      
      {/* Global Chat Sidebar */}
      <GlobalChatSidebar />
    </Box>
  );
};

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <ClockProvider>
      <GlobalChatProvider>
        <DualScreenModeProvider>
          <AppLayoutContent>
            {children}
          </AppLayoutContent>
          
          {/* Global Context Session Handler - processes context sessions from any page */}
          <ContextSessionHandler />
          
          {/* Global Success Notification for sidebar context additions */}
          <ContextSuccessNotification />
        </DualScreenModeProvider>
      </GlobalChatProvider>
    </ClockProvider>
  );
}

