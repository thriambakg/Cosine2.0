"use client";

import { PortfolioRiskMUI } from '@/components/portfolio-risk';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function PortfolioRiskPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <PortfolioRiskMUI />
      </AppLayout>
    </AuthWrapper>
  );
}