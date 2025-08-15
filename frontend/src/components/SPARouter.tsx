"use client";

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LoadingPage from '@/components/LoadingPage';
import ClientOnly from './ClientOnly';

interface SPARouterProps {
  children: React.ReactNode;
}

export default function SPARouter({ children }: SPARouterProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);
  const [isRouting, setIsRouting] = useState(true);
  const routingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Handle SPA routing with better state management
  useEffect(() => {
    if (!isClient || isLoading) return;

    // Clear any existing timeout
    if (routingTimeoutRef.current) {
      clearTimeout(routingTimeoutRef.current);
    }

    const handleSPARouting = () => {
      try {
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

        // If we get here, routing is complete
        setIsRouting(false);
      } catch (error) {
        console.error('SPA routing error:', error);
        // If there's an error, still allow the page to render
        setIsRouting(false);
      }
    };

    // Execute routing logic immediately for better performance
    handleSPARouting();

    // Fallback timeout to prevent infinite loading
    const fallbackTimeout = setTimeout(() => {
      console.warn('SPA routing timeout - allowing page to render');
      setIsRouting(false);
    }, 1000);

    return () => {
      if (routingTimeoutRef.current) {
        clearTimeout(routingTimeoutRef.current);
      }
      clearTimeout(fallbackTimeout);
    };
  }, [user, isLoading, pathname, router, isClient]);

  // Show loading during initial auth check, client-side hydration, or active routing
  if (isLoading || !isClient || isRouting) {
    return <LoadingPage />;
  }

  return (
    <ClientOnly fallback={<LoadingPage />}>
      {children}
    </ClientOnly>
  );
}
