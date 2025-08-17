import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
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

const LoadingContainer = styled(Box)(() => ({
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
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
    background: 'radial-gradient(circle, rgba(34, 197, 94, 0.1) 0%, transparent 70%)',
    borderRadius: '50%',
    filter: 'blur(30px)',
    animation: `${rotate} 15s linear infinite reverse`,
  },
}));

const LoadingCard = styled(Box)(() => ({
  background: 'rgba(15, 23, 42, 0.95)',
  backdropFilter: 'blur(16px)',
  border: '1px solid #374151',
  borderRadius: '12px',
  padding: '48px 64px',
  textAlign: 'center',
  position: 'relative',
  zIndex: 10,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  animation: `${pulse} 2s ease-in-out infinite`,
}));

const StyledCircularProgress = styled(CircularProgress)(() => ({
  color: '#3b82f6',
  marginBottom: '24px',
  filter: 'drop-shadow(0 4px 8px rgba(59, 130, 246, 0.3))',
}));

const LoadingText = styled(Typography)(() => ({
  color: '#ffffff',
  fontWeight: 700,
  fontSize: '1.5rem',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  marginBottom: '8px',
}));

const SubText = styled(Typography)(() => ({
  color: '#9ca3af',
  fontSize: '0.875rem',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontWeight: 500,
}));

interface LoadingPageProps {
  message?: string;
  subMessage?: string;
}

const LoadingPage: React.FC<LoadingPageProps> = ({ 
  message = "Loading Cosine...", 
  subMessage = "AI Trading Intelligence"
}) => {
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
};

export default LoadingPage;
