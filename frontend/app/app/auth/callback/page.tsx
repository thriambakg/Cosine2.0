"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check for errors in URL
        const urlParams = new URLSearchParams(window.location.search);
        const errorParam = urlParams.get('error');
        const code = urlParams.get('code');

        if (errorParam) {
          setError(`Authentication error: ${errorParam}`);
          setTimeout(() => router.push('/login?error=oauth_error'), 3000);
          return;
        }

        if (!code) {
          setError('No authorization code received');
          setTimeout(() => router.push('/login?error=no_code'), 3000);
          return;
        }

        // Let Amplify handle the callback automatically
        // This will process the authorization code and set up the session
        const { fetchAuthSession } = await import('aws-amplify/auth');
        
        // Wait a moment for Amplify to process
        setTimeout(async () => {
          try {
            const session = await fetchAuthSession();
            if (session.tokens?.accessToken) {
              console.log('OAuth callback successful, redirecting to home');
              router.push('/');
            } else {
              throw new Error('No access token received');
            }
          } catch (sessionError) {
            console.error('Session fetch error:', sessionError);
            setError('Failed to establish session');
            setTimeout(() => router.push('/login?error=session_failed'), 3000);
          }
        }, 2000);

      } catch (error) {
        console.error('Auth callback error:', error);
        setError('Authentication callback failed');
        setTimeout(() => router.push('/login?error=callback_error'), 3000);
      }
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        {error ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 text-red-500">
              <svg fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-red-600 font-medium">{error}</p>
            <p className="mt-2 text-gray-600">Redirecting to login...</p>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Completing authentication...</p>
            <p className="mt-1 text-gray-500 text-sm">Please wait while we process your login</p>
          </>
        )}
      </div>
    </div>
  );
}
