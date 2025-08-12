"use client";

import React from 'react';
import { Card, CardProps } from '@mui/material';

interface GlassCardProps extends CardProps {
  children: React.ReactNode;
  glassTint?: 'light' | 'medium' | 'dark';
}

const GlassCard: React.FC<GlassCardProps> = ({ 
  children, 
  glassTint = 'medium',
  sx,
  ...props 
}) => {
  const glassOpacity = {
    light: 0.05,
    medium: 0.1,
    dark: 0.2,
  };

  return (
    <Card
      {...props}
      sx={{
        background: `rgba(255, 255, 255, ${glassOpacity[glassTint]})`,
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: 2,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        '&:hover': {
          backgroundColor: `rgba(255, 255, 255, ${glassOpacity[glassTint] + 0.05})`,
          transform: 'translateY(-2px)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
        },
        ...sx,
      }}
    >
      {children}
    </Card>
  );
};

export default GlassCard;