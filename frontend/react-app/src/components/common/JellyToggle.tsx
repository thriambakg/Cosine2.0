import React from 'react';
import { Box } from '@mui/material';

interface JellyToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

/**
 * Jelly Toggle Component - Animated toggle switch with jelly-like animation
 * Based on Framer design: https://framer.com/m/Jelly-Toggle-FoSZ.js@3chAo1yRuSHriuPqBY3m
 */
export const JellyToggle: React.FC<JellyToggleProps> = ({ checked, onChange, disabled = false }) => {
  return (
    <Box
      onClick={disabled ? undefined : onChange}
      sx={{
        position: 'relative',
        width: 48,
        height: 28,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
      }}
    >
      {/* Track */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: checked ? '#3b82f6' : '#374151',
          borderRadius: '9999px',
          transition: 'background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
      
      {/* Thumb with jelly animation */}
      <Box
        sx={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 24,
          height: 24,
          backgroundColor: '#ffffff',
          borderRadius: '50%',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: checked ? 'scaleX(1.1)' : 'scaleX(1)',
          transformOrigin: 'center',
          // Jelly effect on click
          '@keyframes jelly': {
            '0%, 100%': {
              transform: checked ? 'scaleX(1.1) scaleY(1)' : 'scaleX(1) scaleY(1)',
            },
            '25%': {
              transform: checked ? 'scaleX(1.15) scaleY(0.9)' : 'scaleX(0.9) scaleY(1.1)',
            },
            '50%': {
              transform: checked ? 'scaleX(0.95) scaleY(1.05)' : 'scaleX(1.05) scaleY(0.95)',
            },
            '75%': {
              transform: checked ? 'scaleX(1.05) scaleY(0.95)' : 'scaleX(0.95) scaleY(1.05)',
            },
          },
          animation: 'none',
          '&:active': {
            animation: 'jelly 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          },
        }}
      />
    </Box>
  );
};













<<<<<<< HEAD


=======
>>>>>>> ba70d61c88cd76e9f7598f57d72ecdf857e6c9f5
