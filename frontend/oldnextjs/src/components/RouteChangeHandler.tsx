"use client";

import { useEffect, Suspense } from 'react';
import { usePathname } from 'next/navigation';

interface RouteChangeHandlerProps {
  children: React.ReactNode;
}

function RouteChangeHandlerInner({ children }: RouteChangeHandlerProps) {
  const pathname = usePathname();

  useEffect(() => {
    // Log route changes for debugging
    console.log('Route changed to:', pathname);
    
    // Force a small delay to ensure the page is fully loaded
    const timer = setTimeout(() => {
      // This helps prevent blank screens by ensuring the page has time to render
      if (typeof window !== 'undefined') {
        // Trigger a small re-render to ensure components are mounted
        window.dispatchEvent(new Event('resize'));
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [pathname]);

  return <>{children}</>;
}

export default function RouteChangeHandler({ children }: RouteChangeHandlerProps) {
  return (
    <Suspense fallback={null}>
      <RouteChangeHandlerInner>
        {children}
      </RouteChangeHandlerInner>
    </Suspense>
  );
}
