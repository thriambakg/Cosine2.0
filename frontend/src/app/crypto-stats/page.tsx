"use client";

import { CryptoStatsMUI } from '@/components/crypto-stats';
import AppLayout from '@/components/layout/AppLayout';

export default function CryptoStatsPage() {
  return (
    <AppLayout>
      <CryptoStatsMUI />
    </AppLayout>
  );
}