"use client";

import React from 'react';
import { Card, CardProps, CardContent, CardActions, useTheme } from '@mui/material';
import { styled } from '@mui/material/styles';

const StyledGlassCard = styled(Card)(({ theme }) => ({
  background: theme.customColors.background.glass,
  backdropFilter: 'blur(16px)',
  border: `1px solid ${theme.customColors.background.glassBorder}`,
  borderRadius: 16,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    transform: 'translateY(-4px)',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
  },
}));

interface GlassCardProps extends Omit<CardProps, 'variant'> {
  children: React.ReactNode;
  hover?: boolean;
  glassTint?: 'light' | 'medium' | 'dark';
}

export default function GlassCard({ 
  children, 
  hover = true, 
  glassTint = 'medium',
  sx,
  ...props 
}: GlassCardProps) {
  const theme = useTheme();
  
  const glassOpacity = {
    light: 0.05,
    medium: 0.1,
    dark: 0.2,
  };

  return (
    <StyledGlassCard
      {...props}
      sx={{
        backgroundColor: `rgba(255, 255, 255, ${glassOpacity[glassTint]})`,
        '&:hover': hover ? {
          backgroundColor: `rgba(255, 255, 255, ${glassOpacity[glassTint] + 0.05})`,
          transform: 'translateY(-4px)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
        } : {},
        ...sx,
      }}
    >
      {children}
    </StyledGlassCard>
  );
}
