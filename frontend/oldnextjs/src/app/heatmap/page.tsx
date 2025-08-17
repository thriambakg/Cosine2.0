"use client";

import { useEffect } from 'react';
import { Heatmap } from '@/components/heatmap';
import AppLayout from '@/components/layout/AppLayout';

export default function HeatmapPage() {
  useEffect(() => {
    console.log('🔄 HeatmapPage component mounted');
  }, []);

  console.log('🎯 HeatmapPage render function executing');

  return (
    <AppLayout>
      <div>
        <h1 className="text-4xl font-bold mb-8">Option Price Heatmaps</h1>
        <Heatmap />
      </div>
    </AppLayout>
  );
}


