"use client";

import { CryptoStatsMUI } from '@/components/crypto-stats';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function CryptoStatsPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <CryptoStatsMUI />
      </AppLayout>
    </AuthWrapper>
  );
}