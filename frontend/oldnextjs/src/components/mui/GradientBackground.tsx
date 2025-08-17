"use client";

import React from 'react';
import { Box, BoxProps, useTheme } from '@mui/material';
import { styled } from '@mui/material/styles';

const AnimatedBackground = styled(Box)(({ theme }) => ({
  position: 'relative',
  minHeight: '100vh',
  background: theme.customColors.background.primary,
  overflow: 'hidden',
  
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.2)',
    zIndex: 1,
  },
  
  // Animated floating orbs
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '25%',
    left: '25%',
    width: '24rem',
    height: '24rem',
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(40px)',
    animation: 'float 6s ease-in-out infinite',
    zIndex: 0,
  },
}));

const FloatingOrb = styled(Box)<{ delay?: number; size?: number; color?: string }>(
  ({ delay = 0, size = 384, color = 'rgba(139, 92, 246, 0.1)' }) => ({
    position: 'absolute',
    width: size,
    height: size,
    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
    borderRadius: '50%',
    filter: 'blur(60px)',
    animation: `float 8s ease-in-out infinite ${delay}s, pulse 4s ease-in-out infinite ${delay}s`,
    zIndex: 0,
    
    '@keyframes float': {
      '0%, 100%': {
        transform: 'translateY(0px) translateX(0px)',
      },
      '33%': {
        transform: 'translateY(-20px) translateX(10px)',
      },
      '66%': {
        transform: 'translateY(10px) translateX(-10px)',
      },
    },
    
    '@keyframes pulse': {
      '0%, 100%': {
        opacity: 0.4,
      },
      '50%': {
        opacity: 0.8,
      },
    },
  })
);

const ContentWrapper = styled(Box)({
  position: 'relative',
  zIndex: 10,
  width: '100%',
  height: '100%',
});

interface GradientBackgroundProps extends BoxProps {
  children: React.ReactNode;
  variant?: 'default' | 'minimal' | 'intense';
  animated?: boolean;
}

export default function GradientBackground({ 
  children, 
  variant = 'default',
  animated = true,
  ...props 
}: GradientBackgroundProps) {
  const theme = useTheme();
  
  const backgrounds = {
    default: theme.customColors.background.primary,
    minimal: 'linear-gradient(135deg, #1E40AF 0%, #7C3AED 100%)',
    intense: 'linear-gradient(135deg, #1E3A8A 0%, #7C3AED 30%, #EC4899 60%, #312E81 100%)',
  };

  return (
    <AnimatedBackground
      {...props}
      sx={{
        background: backgrounds[variant],
        ...props.sx,
      }}
    >
      {animated && (
        <>
          <FloatingOrb
            delay={0}
            size={384}
            color="rgba(59, 130, 246, 0.1)"
            sx={{ top: '25%', left: '25%' }}
          />
          <FloatingOrb
            delay={2}
            size={256}
            color="rgba(139, 92, 246, 0.1)"
            sx={{ bottom: '25%', right: '25%' }}
          />
          <FloatingOrb
            delay={4}
            size={320}
            color="rgba(99, 102, 241, 0.1)"
            sx={{ top: '50%', right: '33%' }}
          />
        </>
      )}
      
      <ContentWrapper>
        {children}
      </ContentWrapper>
    </AnimatedBackground>
  );
}
