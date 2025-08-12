"use client";

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import LandingPageMUI from '@/components/LandingPageMUI';
import { Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

interface AuthWrapperProps {
  children: React.ReactNode;
}

export default function AuthWrapper({ children }: AuthWrapperProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Routes that should be accessible without auth
  const publicRoutes = new Set<string>([
    '/',
    '/login',
    '/auth/callback'
  ]);

  // Redirect unauthenticated users trying to access protected routes
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated && pathname && !publicRoutes.has(pathname)) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading Cosine...</p>
        </div>
      </div>
    );
  }

  // If not authenticated: render landing page on root, otherwise allow public routes or wait for redirect
  if (!isAuthenticated) {
    if (pathname === '/') return <LandingPageMUI />;
    if (pathname && publicRoutes.has(pathname)) return <>{children}</>;
    // For protected routes, a redirect will occur; render nothing to avoid flash
    return null;
  }

  // Show main app if authenticated
  return <>{children}</>;
}
