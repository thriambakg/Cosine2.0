"use client";

import { StockVolatilityMUI } from '@/components/stock-volatility';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function StockVolatilityPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <StockVolatilityMUI />
      </AppLayout>
    </AuthWrapper>
  );
}