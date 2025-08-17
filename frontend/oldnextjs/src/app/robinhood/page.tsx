"use client";

import { useEffect } from 'react';
import { RobinhoodIntegrationMUI } from '@/components/robinhood';
import AppLayout from '@/components/layout/AppLayout';

export default function RobinhoodPage() {
  useEffect(() => {
    console.log('🔄 RobinhoodPage component mounted');
  }, []);

  console.log('🎯 RobinhoodPage render function executing');

  return (
    <AppLayout>
      <RobinhoodIntegrationMUI />
    </AppLayout>
  );
}
