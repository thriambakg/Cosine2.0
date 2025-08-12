"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    // Handle OAuth callback
    const handleCallback = async () => {
      try {
        // Wait for auth to process the callback
        if (!isLoading) {
          if (user) {
            // Successful authentication - redirect to home
            router.push('/');
          } else {
            // Authentication failed - redirect to login with error
            router.push('/login?error=authentication_failed');
          }
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        router.push('/login?error=callback_error');
      }
    };

    handleCallback();
  }, [user, isLoading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
        <p className="mt-2 text-gray-600">Completing authentication...</p>
        <p className="mt-1 text-gray-500 text-sm">Please wait while we process your login</p>
      </div>
    </div>
  );
}
