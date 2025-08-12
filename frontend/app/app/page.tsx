"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LandingPageMUI from '@/components/LandingPageMUI';
import DashboardMUI from '@/components/DashboardMUI';

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
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-purple-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto"></div>
          <p className="mt-2 text-white/80">Loading...</p>
        </div>
      </div>
    );
  }

  // Show dashboard if authenticated, landing page if not
  return user ? <DashboardMUI /> : <LandingPageMUI />;
}