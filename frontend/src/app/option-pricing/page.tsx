"use client";

import { OptionPricingMUI } from '@/components/option-pricing';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function OptionPricingPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <OptionPricingMUI />
      </AppLayout>
    </AuthWrapper>
  );
}