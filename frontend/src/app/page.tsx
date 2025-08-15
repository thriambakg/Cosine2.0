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
    console.log('🔄 HomePage component mounted');
  }, []);

  console.log('🎯 HomePage render function executing');

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
  // The SPARouter will handle authentication and routing for other pages
  return null;
}
