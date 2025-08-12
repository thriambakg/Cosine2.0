"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LandingPageMUI from '@/components/LandingPageMUI';
import DashboardMUI from '@/components/DashboardMUI';
import AppLayout from '@/components/layout/AppLayout';
import LoadingPage from '@/components/LoadingPage';

export default function HomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If loading, don't redirect yet
    if (isLoading) return;
    
    // If not authenticated, show landing page
    // If authenticated, show dashboard
  }, [user, isLoading, router]);

  if (isLoading) {
    return <LoadingPage />;
  }

  // Show dashboard if authenticated, landing page if not
  if (user) {
    return (
      <AppLayout>
        <DashboardMUI />
      </AppLayout>
    );
  }
  
  return <LandingPageMUI />;
}