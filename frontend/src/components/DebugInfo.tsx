"use client";

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function DebugInfo() {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const [renderTime, setRenderTime] = useState<number>(0);

  useEffect(() => {
    setRenderTime(Date.now());
    
    // Log debug info to console
    console.log('🔍 Debug Info:', {
      pathname,
      isAuthenticated: !!user,
      isLoading,
      renderTime: new Date().toISOString(),
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    });
  }, [pathname, user, isLoading]);

  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      background: 'rgba(0,0,0,0.8)',
      color: 'white',
      padding: '4px 8px',
      fontSize: '10px',
      zIndex: 9999,
      fontFamily: 'monospace'
    }}>
      <div>Path: {pathname}</div>
      <div>Auth: {isLoading ? 'Loading' : (user ? 'Yes' : 'No')}</div>
      <div>Time: {new Date(renderTime).toLocaleTimeString()}</div>
    </div>
  );
}
