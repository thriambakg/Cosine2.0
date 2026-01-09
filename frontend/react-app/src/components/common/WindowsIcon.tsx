import React from 'react';
import { Box } from '@mui/material';

interface WindowsIconProps {
  fontSize?: 'small' | 'medium' | 'large' | 'inherit';
  color?: string;
}

const WindowsIcon: React.FC<WindowsIconProps> = ({ fontSize = 'medium', color = 'currentColor' }) => {
  // Size based on fontSize
  const size = fontSize === 'small' ? 16 : fontSize === 'large' ? 24 : 20;
  
  // Back square: full size
  // Front square: same size, positioned at (size/4, size/4) - halfway between top-left and center
  const offset = size / 4;
  
  return (
    <Box
      sx={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Back square */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          border: `1.5px solid ${color}`,
          borderRadius: '2px',
        }}
      />
      {/* Front square */}
      <Box
        sx={{
          position: 'absolute',
          top: offset,
          left: offset,
          width: size,
          height: size,
          border: `1.5px solid ${color}`,
          borderRadius: '2px',
        }}
      />
    </Box>
  );
};

export default WindowsIcon;




