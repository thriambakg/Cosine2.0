"use client";

import { RobinhoodIntegrationMUI } from '@/components/robinhood';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function RobinhoodPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <RobinhoodIntegrationMUI />
      </AppLayout>
    </AuthWrapper>
  );
}