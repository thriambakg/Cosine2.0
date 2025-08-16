"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LandingPageMUI from '@/components/LandingPageMUI';
import DashboardMUI from '@/components/DashboardMUI';
import AppLayout from '@/components/layout/AppLayout';

export default function HomePage() {
  const { user } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    console.log('🔄 HomePage component mounted for pathname:', pathname);
  }, [pathname]);

  console.log('🎯 HomePage render function executing - user:', !!user, 'pathname:', pathname);

  // This component ONLY handles the root path (/)
  // All other paths should be handled by their respective page components
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
