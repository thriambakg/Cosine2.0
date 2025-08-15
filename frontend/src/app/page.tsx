"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LandingPageMUI from '@/components/LandingPageMUI';
import DashboardMUI from '@/components/DashboardMUI';
import AppLayout from '@/components/layout/AppLayout';
import LoadingPage from '@/components/LoadingPage';

export default function HomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    // If loading or not client yet, don't redirect
    if (isLoading || !isClient) return;
    
    // Handle SPA routing for all paths
    const handleRouting = () => {
      // If we're on a protected route and not authenticated, redirect to login
      if (!user && pathname !== '/' && pathname !== '/login' && pathname !== '/auth/callback') {
        router.replace('/login');
        return;
      }
      
      // If we're on login page and authenticated, redirect to dashboard
      if (user && pathname === '/login') {
        router.replace('/');
        return;
      }
    };

    handleRouting();
  }, [user, isLoading, router, pathname, isClient]);

  // Show loading while checking auth or during SSR
  if (isLoading || !isClient) {
    return <LoadingPage />;
  }

  // Handle root path
  if (pathname === '/') {
    if (user) {
      return (
        <AppLayout>
          <DashboardMUI />
        </AppLayout>
      );
    } else {
      return <LandingPageMUI />;
    }
  }
  
  // For all other paths, let Next.js handle routing naturally
  // This allows individual page components to render
  return null;
}
