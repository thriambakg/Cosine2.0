"use client";

import { useEffect } from 'react';
import { PortfolioRiskMUI } from '@/components/portfolio-risk';
import AppLayout from '@/components/layout/AppLayout';

export default function PortfolioRiskPage() {
  useEffect(() => {
    console.log('🔄 PortfolioRiskPage component mounted');
  }, []);

  console.log('🎯 PortfolioRiskPage render function executing');

  return (
    <AppLayout>
      <PortfolioRiskMUI />
    </AppLayout>
  );
}
