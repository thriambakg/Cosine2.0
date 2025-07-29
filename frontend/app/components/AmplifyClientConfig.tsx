"use client";

import { useEffect } from 'react';
import { configureAmplify } from '@/lib/amplifyConfig';

export default function AmplifyClientConfig({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    configureAmplify();
  }, []);

  return <>{children}</>;
}
