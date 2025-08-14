"use client";

import { useEffect } from 'react';
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

  useEffect(() => {
    // If loading, don't redirect yet
    if (isLoading) return;
    
    // Only handle routing logic for the root path
    if (pathname === '/') {
      if (user) {
        // User is authenticated and on root path, show dashboard
        // Don't redirect, just render dashboard
      } else {
        // User is not authenticated and on root path, show landing page
        // Don't redirect, just render landing page
      }
    }
    // For all other paths, let Next.js handle the routing naturally
  }, [user, isLoading, router, pathname]);

  if (isLoading) {
    return <LoadingPage />;
  }

  // Only handle the root path here
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
  
  // For all other paths, return null to let Next.js handle routing
  return null;
}