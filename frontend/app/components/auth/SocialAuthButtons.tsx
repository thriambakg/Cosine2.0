"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface SocialAuthButtonsProps {
  mode?: 'login' | 'register';
  isDisabled?: boolean;
}

export default function SocialAuthButtons({ mode = 'login', isDisabled = false }: SocialAuthButtonsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<'Google' | 'Microsoft' | null>(null);
  const { loginWithProvider } = useAuth();

  const handleSocialLogin = async (provider: 'Google' | 'Microsoft') => {
    if (isDisabled) return;
    
    try {
      setIsLoading(true);
      setLoadingProvider(provider);
      await loginWithProvider(provider);
    } catch (error: any) {
      console.error(`${provider} login error:`, error);
      // Error handling is managed by the AuthContext
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  const buttonText = mode === 'register' ? 'Sign up with' : 'Continue with';

  return (
    <div className="space-y-3">
      {/* Google Button */}
      <button
        onClick={() => handleSocialLogin('Google')}
        disabled={isDisabled || isLoading}
        className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 group"
      >
        {loadingProvider === 'Google' ? (
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        ) : (
          <>
            {/* Google Logo SVG */}
            <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
              <path 
                fill="#4285f4" 
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path 
                fill="#34a853" 
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path 
                fill="#fbbc05" 
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path 
                fill="#ea4335" 
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span className="group-hover:text-gray-900 transition-colors">
              {buttonText} Google
            </span>
          </>
        )}
      </button>

      {/* Microsoft Button */}
      <button
        onClick={() => handleSocialLogin('Microsoft')}
        disabled={isDisabled || isLoading}
        className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 group"
      >
        {loadingProvider === 'Microsoft' ? (
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        ) : (
          <>
            {/* Microsoft Logo SVG */}
            <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
              <path fill="#f25022" d="M1 1h10v10H1z"/>
              <path fill="#00a4ef" d="M13 1h10v10H13z"/>
              <path fill="#7fba00" d="M1 13h10v10H1z"/>
              <path fill="#ffb900" d="M13 13h10v10H13z"/>
            </svg>
            <span className="group-hover:text-gray-900 transition-colors">
              {buttonText} Microsoft
            </span>
          </>
        )}
      </button>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-3 bg-white text-gray-500 font-medium">
            Or {mode === 'register' ? 'sign up' : 'continue'} with email
          </span>
        </div>
      </div>
    </div>
  );
}
