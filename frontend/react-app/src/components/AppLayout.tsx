import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useAppDispatch } from '../store/hooks';
import { setCurrentPage } from '../store/slices/navigationSlice';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import FloatingClock from './FloatingClock';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const dispatch = useAppDispatch();

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
        }}
      >
        {children}
      </Box>
      
      {/* Floating Clock */}
      <FloatingClock />
    </Box>
  );
}

