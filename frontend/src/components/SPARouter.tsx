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

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Handle SPA routing
  useEffect(() => {
    if (!isClient || isLoading) return;

    // Public routes that don't require authentication
    const publicRoutes = ['/', '/login', '/auth/callback'];
    
    // If user is not authenticated and trying to access protected route
    if (!user && pathname && !publicRoutes.includes(pathname)) {
      console.log('Redirecting unauthenticated user to login from:', pathname);
      router.replace('/login');
      return;
    }

    // If user is authenticated and on login page, redirect to dashboard
    if (user && pathname === '/login') {
      console.log('Redirecting authenticated user to dashboard from login page');
      router.replace('/');
      return;
    }

    // If we get here, the route is valid (either public or authenticated user on protected route)
    console.log('Route is valid, allowing page to render:', pathname);
  }, [user, isLoading, pathname, router, isClient]);

  // Show loading only during initial auth check or client-side hydration
  if (isLoading || !isClient) {
    return <LoadingPage />;
  }

  return <>{children}</>;
}
