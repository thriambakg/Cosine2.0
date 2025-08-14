"use client";

import { StockAlertsMUI } from '@/components/stock-alerts';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function StockAlertsPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <div style={{ padding: '20px' }}>
          <h1>Stock Alerts Page Test</h1>
          <p>If you can see this, the routing is working.</p>
          <StockAlertsMUI />
        </div>
      </AppLayout>
    </AuthWrapper>
  );
}