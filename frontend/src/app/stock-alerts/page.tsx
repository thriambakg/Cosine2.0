"use client";

import { StockAlertsMUI } from '@/components/stock-alerts';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function StockAlertsPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <StockAlertsMUI />
      </AppLayout>
    </AuthWrapper>
  );
}