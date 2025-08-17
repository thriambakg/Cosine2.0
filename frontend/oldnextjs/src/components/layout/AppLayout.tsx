"use client";

import React, { useEffect } from 'react';
import { Box, Container } from '@mui/material';
import { usePathname } from 'next/navigation';
import { useAppDispatch } from '@/store/hooks';
import { setCurrentPage, setBreadcrumbs } from '@/store/slices/navigationSlice';
import AppHeader from '../navigation/AppHeader';
import AppSidebar from '../navigation/AppSidebar';
import { GradientBackground } from '../mui';

interface AppLayoutProps {
  children: React.ReactNode;
}

// Define page titles and breadcrumbs
const pageConfig = {
  '/': { title: 'Dashboard', breadcrumbs: [{ label: 'Dashboard', path: '/' }] },
  '/chat': { title: 'AI Chat', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'AI Chat', path: '/chat' }] },
  '/robinhood': { title: 'Robinhood Integration', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'Portfolio', path: '#' }, { label: 'Robinhood', path: '/robinhood' }] },
  '/portfolio-risk': { title: 'Portfolio Risk', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'Portfolio', path: '#' }, { label: 'Risk Analysis', path: '/portfolio-risk' }] },
  '/stock-volatility': { title: 'Stock Volatility', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'Analysis', path: '#' }, { label: 'Stock Volatility', path: '/stock-volatility' }] },
  '/stock-alerts': { title: 'Stock Alerts', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'Analysis', path: '#' }, { label: 'Stock Alerts', path: '/stock-alerts' }] },
  '/crypto-stats': { title: 'Crypto Stats', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'Analysis', path: '#' }, { label: 'Crypto Stats', path: '/crypto-stats' }] },
  '/option-pricing': { title: 'Option Pricing', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'Analysis', path: '#' }, { label: 'Option Pricing', path: '/option-pricing' }] },
  '/heatmap': { title: 'Market Heatmap', breadcrumbs: [{ label: 'Dashboard', path: '/' }, { label: 'Analysis', path: '#' }, { label: 'Heatmap', path: '/heatmap' }] },
};

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Update current page and breadcrumbs when route changes
    dispatch(setCurrentPage(pathname));
    
    const config = pageConfig[pathname as keyof typeof pageConfig];
    if (config) {
      dispatch(setBreadcrumbs(config.breadcrumbs));
    } else {
      // Fallback breadcrumbs for unknown routes
      const segments = pathname.split('/').filter(Boolean);
      const breadcrumbs = [
        { label: 'Dashboard', path: '/' },
        ...segments.map((segment, index) => ({
          label: segment.charAt(0).toUpperCase() + segment.slice(1).replace('-', ' '),
          path: '/' + segments.slice(0, index + 1).join('/'),
        })),
      ];
      dispatch(setBreadcrumbs(breadcrumbs));
    }
  }, [pathname, dispatch]);

  // Skip navigation for auth pages
  const isAuthPage = pathname.startsWith('/auth') || pathname === '/login';
  
  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <GradientBackground variant="minimal" animated={false}>
      <AppHeader />
      <AppSidebar />
      
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pt: 10, // Account for AppBar height
          minHeight: '100vh',
        }}
      >
        <Container maxWidth="xl" sx={{ py: 3 }}>
          {children}
        </Container>
      </Box>
    </GradientBackground>
  );
}
