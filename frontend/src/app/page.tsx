"use client";

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import LandingPageMUI from '@/components/LandingPageMUI';
import DashboardMUI from '@/components/DashboardMUI';
import AppLayout from '@/components/layout/AppLayout';

export default function HomePage() {
  const { user } = useAuth();

  useEffect(() => {
    console.log('🔄 HomePage component mounted');
  }, []);

  console.log('🎯 HomePage render function executing');

  // This component only handles the root path (/)
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
