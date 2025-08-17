"use client";

import { useEffect } from 'react';
import { StockVolatilityMUI } from '@/components/stock-volatility';
import AppLayout from '@/components/layout/AppLayout';

export default function StockVolatilityPage() {
  useEffect(() => {
    console.log('🔄 StockVolatilityPage component mounted');
  }, []);

  console.log('🎯 StockVolatilityPage render function executing');

  return (
    <AppLayout>
      <StockVolatilityMUI />
    </AppLayout>
  );
}
