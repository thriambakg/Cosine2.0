"use client";

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';
import GlassCard from './GlassCard';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: SvgIconComponent;
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  onClick?: () => void;
}

export default function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'primary',
  trend,
  trendValue,
  onClick,
}: MetricCardProps) {
  const theme = useTheme();
  
  const colorMap = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
  };

  const trendColor = {
    up: theme.palette.success.main,
    down: theme.palette.error.main,
    neutral: theme.palette.text.secondary,
  };

  return (
    <GlassCard
      onClick={onClick}
      sx={{
        p: 3,
        cursor: onClick ? 'pointer' : 'default',
        background: `linear-gradient(135deg, ${colorMap[color]}15 0%, ${colorMap[color]}08 100%)`,
        border: `1px solid ${colorMap[color]}30`,
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
      
      <Box textAlign="right">
        <Typography variant="h4" fontWeight={700} color="text.primary" mb={0.5}>
          {value}
        </Typography>
        {trend && trendValue && (
          <Typography 
            variant="body2" 
            color={trendColor[trend]}
            fontWeight={500}
          >
            {trendValue}
          </Typography>
        )}
      </Box>
    </GlassCard>
  );
}
