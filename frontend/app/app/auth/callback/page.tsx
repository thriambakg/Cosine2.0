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
        // Check if this is a manual OAuth callback (Microsoft)
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');
        
        // Handle OAuth errors
        if (error) {
          console.error('OAuth error:', error);
          router.push('/login?error=oauth_error');
          return;
        }
        
        // If we have a code and state, this might be a manual OAuth callback
        if (code && state) {
          const storedState = sessionStorage.getItem('oauth_state');
          if (state === storedState) {
            // Valid state - let Amplify process the callback
            sessionStorage.removeItem('oauth_state');
            
            // Give Amplify time to process the callback
            setTimeout(() => {
              if (!isLoading) {
                if (user) {
                  router.push('/');
                } else {
                  // Try to fetch auth session manually for Microsoft OAuth
                  import('aws-amplify/auth').then(({ fetchAuthSession }) => {
                    fetchAuthSession().then(session => {
                      if (session.tokens?.accessToken) {
                        router.push('/');
                      } else {
                        router.push('/login?error=authentication_failed');
                      }
                    }).catch(() => {
                      router.push('/login?error=session_failed');
                    });
                  });
                }
              }
            }, 2000);
            return;
          } else {
            // Invalid state - security issue
            router.push('/login?error=invalid_state');
            return;
          }
        }
        
        // Default handling for Amplify-managed callbacks (Google)
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
