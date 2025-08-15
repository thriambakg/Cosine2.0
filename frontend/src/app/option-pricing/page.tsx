"use client";

import { useEffect } from 'react';
import { OptionPricingMUI } from '@/components/option-pricing';
import AppLayout from '@/components/layout/AppLayout';

export default function OptionPricingPage() {
  useEffect(() => {
    console.log('🔄 OptionPricingPage component mounted');
  }, []);

  console.log('🎯 OptionPricingPage render function executing');

  return (
    <AppLayout>
      <OptionPricingMUI />
    </AppLayout>
  );
}
