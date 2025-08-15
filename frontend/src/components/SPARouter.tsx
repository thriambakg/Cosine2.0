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
  const [forceRender, setForceRender] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
    
    // Force render after 1 second to prevent infinite loading
    const timer = setTimeout(() => {
      console.log('🔄 SPARouter force render timeout triggered');
      setForceRender(true);
    }, 1000);
    
    return () => clearTimeout(timer);
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
  if ((isLoading || !isClient) && !forceRender && !hasRendered) {
    console.log('🔄 SPARouter showing loading page - isLoading:', isLoading, 'isClient:', isClient, 'forceRender:', forceRender, 'hasRendered:', hasRendered);
    return <LoadingPage />;
  }

  // Once we've rendered once, always render children to prevent hydration issues
  if (!hasRendered) {
    setHasRendered(true);
  }

  console.log('🔄 SPARouter rendering children - user:', !!user, 'pathname:', pathname, 'forceRender:', forceRender, 'hasRendered:', hasRendered);
  return <>{children}</>;
}
