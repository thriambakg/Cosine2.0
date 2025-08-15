"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LoadingPage from '@/components/LoadingPage';

interface SPARouterProps {
  children: React.ReactNode;
}

export default function SPARouter({ children }: SPARouterProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);
  const [isRouting, setIsRouting] = useState(true);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Handle SPA routing
  useEffect(() => {
    if (!isClient || isLoading) return;

    const handleSPARouting = () => {
      // Public routes that don't require authentication
      const publicRoutes = ['/', '/login', '/auth/callback'];
      
      // If user is not authenticated and trying to access protected route
      if (!user && pathname && !publicRoutes.includes(pathname)) {
        router.replace('/login');
        return;
      }

      // If user is authenticated and on login page, redirect to dashboard
      if (user && pathname === '/login') {
        router.replace('/');
        return;
      }

      // Routing is complete
      setIsRouting(false);
    };

    // Small delay to ensure auth state is stable
    const timer = setTimeout(handleSPARouting, 100);
    return () => clearTimeout(timer);
  }, [user, isLoading, pathname, router, isClient]);

  // Show loading during initial load or routing
  if (isLoading || !isClient || isRouting) {
    return <LoadingPage />;
  }

  return <>{children}</>;
}
