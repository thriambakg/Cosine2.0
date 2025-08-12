"use client";

import React from 'react';
import { Button, ButtonProps, useTheme } from '@mui/material';
import { styled } from '@mui/material/styles';

const StyledGradientButton = styled(Button)(({ theme }) => ({
  background: theme.customColors.primary.gradient,
  color: theme.customColors.text.primary,
  fontWeight: 600,
  borderRadius: 12,
  padding: '12px 24px',
  textTransform: 'none',
  boxShadow: '0 4px 16px rgba(59, 130, 246, 0.3)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  '&:hover': {
    background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)',
    transform: 'translateY(-2px) scale(1.02)',
    boxShadow: '0 8px 32px rgba(59, 130, 246, 0.4)',
  },
  '&:active': {
    transform: 'translateY(0) scale(0.98)',
  },
}));

interface GradientButtonProps extends Omit<ButtonProps, 'variant'> {
  children: React.ReactNode;
  gradient?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  glow?: boolean;
}

export default function GradientButton({ 
  children, 
  gradient = 'primary',
  glow = true,
  sx,
  ...props 
}: GradientButtonProps) {
  const theme = useTheme();
  
  const gradients = {
    primary: theme.customColors.primary.gradient,
    secondary: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
    success: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
    warning: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    error: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
  };

  const glowColors = {
    primary: 'rgba(59, 130, 246, 0.3)',
    secondary: 'rgba(139, 92, 246, 0.3)',
    success: 'rgba(16, 185, 129, 0.3)',
    warning: 'rgba(245, 158, 11, 0.3)',
    error: 'rgba(239, 68, 68, 0.3)',
  };

  return (
    <StyledGradientButton
      {...props}
      sx={{
        background: gradients[gradient],
        boxShadow: glow ? `0 4px 16px ${glowColors[gradient]}` : '0 2px 8px rgba(0, 0, 0, 0.2)',
        '&:hover': {
          background: gradients[gradient],
          filter: 'brightness(1.1)',
          boxShadow: glow ? `0 8px 32px ${glowColors[gradient]}` : '0 4px 16px rgba(0, 0, 0, 0.3)',
        },
        ...sx,
      }}
    >
      {children}
    </StyledGradientButton>
  );
}
