"use client";

import { useEffect } from 'react';
import { StockAlertsMUI } from '@/components/stock-alerts';
import AppLayout from '@/components/layout/AppLayout';

export default function StockAlertsPage() {
  useEffect(() => {
    console.log('🔄 StockAlertsPage component mounted');
  }, []);

  console.log('🎯 StockAlertsPage render function executing');

  return (
    <AppLayout>
      <StockAlertsMUI />
    </AppLayout>
  );
}
