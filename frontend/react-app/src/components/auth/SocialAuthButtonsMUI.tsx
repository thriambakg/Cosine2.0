import React from 'react';
import { Box, Button } from '@mui/material';
import { Google } from '@mui/icons-material';

interface SocialAuthButtonsProps {
  onGoogleSignIn: () => void;
}

export default function SocialAuthButtons({ onGoogleSignIn }: SocialAuthButtonsProps) {
  return (
    <Box sx={{ mt: 2 }}>
      <Button
        variant="outlined"
        fullWidth
        startIcon={<Google />}
        onClick={onGoogleSignIn}
        sx={{
          borderColor: '#374151',
          color: '#e2e8f0',
          borderRadius: '0px',
          textTransform: 'uppercase',
          fontWeight: 600,
          '&:hover': {
            borderColor: '#dc2626',
            color: '#dc2626'
          }
        }}
      >
        Continue with Google
      </Button>
    </Box>
  );
}
