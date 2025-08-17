"use client";

import { useEffect } from 'react';
import { CryptoStatsMUI } from '@/components/crypto-stats';
import AppLayout from '@/components/layout/AppLayout';

export default function CryptoStatsPage() {
  useEffect(() => {
    console.log('🔄 CryptoStatsPage component mounted');
  }, []);

  console.log('🎯 CryptoStatsPage render function executing');

  return (
    <AppLayout>
      <CryptoStatsMUI />
    </AppLayout>
  );
}
