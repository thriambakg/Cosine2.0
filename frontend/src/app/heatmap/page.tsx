"use client";

import { Heatmap } from '@/components/heatmap';
import AppLayout from '@/components/layout/AppLayout';


export default function HeatmapPage() {
  return (
    
      <AppLayout>
        <div>
          <h1 className="text-4xl font-bold mb-8">Option Price Heatmaps</h1>
          <Heatmap />
        </div>
      </AppLayout>
    
  );
}


