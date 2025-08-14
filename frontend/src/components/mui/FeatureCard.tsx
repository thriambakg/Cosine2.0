"use client";

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';
import GlassCard from './GlassCard';

interface FeatureCardProps {
  title: string;
  description: string;
  icon: SvgIconComponent;
  gradient?: string;
  onClick?: () => void;
  href?: string;
}

export default function FeatureCard({
  title,
  description,
  icon: Icon,
  gradient,
  onClick,
  href,
}: FeatureCardProps) {
  const theme = useTheme();
  
  const defaultGradients = [
    'linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%)', // Blue
    'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)', // Purple  
    'linear-gradient(135deg, #10B981 0%, #059669 100%)', // Green
    'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)', // Orange
  ];
  
  const cardGradient = gradient || defaultGradients[Math.floor(Math.random() * defaultGradients.length)];

  const handleClick = () => {
    if (href && typeof window !== 'undefined') {
      window.location.href = href;
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <GlassCard
      onClick={handleClick}
      sx={{
        p: 4,
        textAlign: 'center',
        cursor: (onClick || href) ? 'pointer' : 'default',
        '&:hover': {
          transform: 'translateY(-8px) scale(1.02)',
          '& .feature-icon': {
            transform: 'scale(1.1)',
          }
        }
      }}
    >
      <Box
        className="feature-icon"
        sx={{
          width: 64,
          height: 64,
          borderRadius: '16px',
          background: cardGradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          mb: 3,
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <Icon sx={{ color: 'white', fontSize: 32 }} />
      </Box>
      
      <Typography variant="h6" fontWeight={600} color="text.primary" mb={2}>
        {title}
      </Typography>
      
      <Typography variant="body2" color="text.secondary" lineHeight={1.6}>
        {description}
      </Typography>
    </GlassCard>
  );
}
