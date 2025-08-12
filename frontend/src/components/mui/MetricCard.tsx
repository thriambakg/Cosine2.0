"use client";

import React from 'react';
import { Box, Typography, Card, CardProps } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';

interface MetricCardProps extends CardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: SvgIconComponent;
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'primary',
  trend = 'neutral',
  trendValue,
  sx,
  ...props
}) => {
  const colorMap = {
    primary: '#3B82F6',
    secondary: '#8B5CF6',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
  };

  const trendColorMap = {
    up: '#10B981',
    down: '#EF4444',
    neutral: '#6B7280',
  };

  return (
    <Card
      {...props}
      sx={{
        p: 3,
        background: `linear-gradient(135deg, ${colorMap[color]}15 0%, ${colorMap[color]}08 100%)`,
        backdropFilter: 'blur(16px)',
        border: `1px solid ${colorMap[color]}30`,
        borderRadius: 2,
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        },
        ...sx,
      }}
    >
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '12px',
              background: `linear-gradient(135deg, ${colorMap[color]} 0%, ${colorMap[color]}80 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon sx={{ color: 'white', fontSize: 20 }} />
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
      
      <Box display="flex" alignItems="baseline" justifyContent="space-between">
        <Typography variant="h4" fontWeight={700} color="text.primary">
          {value}
        </Typography>
        {trendValue && (
          <Typography 
            variant="body2" 
            fontWeight={600}
            sx={{ color: trendColorMap[trend] }}
          >
            {trendValue}
          </Typography>
        )}
      </Box>
    </Card>
  );
};

export default MetricCard;