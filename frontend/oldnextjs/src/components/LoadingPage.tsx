"use client";

import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { styled, keyframes } from '@mui/material/styles';

const rotate = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

const pulse = keyframes`
  0%, 100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
`;

const LoadingContainer = styled(Box)(({ theme }) => ({
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #1E3A8A 0%, #7C3AED 50%, #312E81 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  overflow: 'hidden',
  
  // Animated background orbs
  '&::before': {
    content: '""',
    position: 'absolute',
    top: '20%',
    left: '20%',
    width: '300px',
    height: '300px',
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(40px)',
    animation: `${rotate} 20s linear infinite`,
  },
  
  '&::after': {
    content: '""',
    position: 'absolute',
    bottom: '20%',
    right: '20%',
    width: '200px',
    height: '200px',
    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(30px)',
    animation: `${rotate} 15s linear infinite reverse`,
  },
}));

const LoadingCard = styled(Box)(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.1)',
  backdropFilter: 'blur(16px)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '24px',
  padding: '48px 64px',
  textAlign: 'center',
  position: 'relative',
  zIndex: 10,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
  animation: `${pulse} 2s ease-in-out infinite`,
}));

const StyledCircularProgress = styled(CircularProgress)(({ theme }) => ({
  color: '#60A5FA',
  marginBottom: '24px',
  filter: 'drop-shadow(0 4px 8px rgba(96, 165, 250, 0.3))',
}));

const LoadingText = styled(Typography)(({ theme }) => ({
  color: '#FFFFFF',
  fontWeight: 600,
  fontSize: '1.25rem',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  letterSpacing: '0.5px',
  background: 'linear-gradient(135deg, #FFFFFF 0%, #E5E7EB 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}));

const SubText = styled(Typography)(({ theme }) => ({
  color: 'rgba(255, 255, 255, 0.7)',
  fontSize: '0.875rem',
  marginTop: '8px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
}));

interface LoadingPageProps {
  message?: string;
  subMessage?: string;
}

export default function LoadingPage({ 
  message = "Loading Cosine...", 
  subMessage = "AI Trading Intelligence"
}: LoadingPageProps) {
  return (
    <LoadingContainer>
      <LoadingCard>
        <StyledCircularProgress size={64} thickness={3} />
        <LoadingText variant="h5">
          {message}
        </LoadingText>
        {subMessage && (
          <SubText variant="body2">
            {subMessage}
          </SubText>
        )}
      </LoadingCard>
    </LoadingContainer>
  );
}
