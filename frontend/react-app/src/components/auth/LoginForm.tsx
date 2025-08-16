import React from 'react';
import { Box, Typography, Button } from '@mui/material';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSwitchToReset: () => void;
  onClose: () => void;
}

export default function LoginForm({ onSwitchToRegister, onSwitchToReset, onClose }: LoginFormProps) {
  return (
    <Box sx={{ 
      p: 4, 
      backgroundColor: 'rgba(15, 23, 42, 0.95)', 
      borderRadius: '0px', 
      boxShadow: 3,
      border: '2px solid #374151',
      maxWidth: 400,
      width: '100%'
    }}>
      <Typography variant="h5" fontWeight={700} color="#ffffff" mb={3} textTransform="uppercase">
        Sign In
      </Typography>
      <Typography variant="body1" color="#e2e8f0" mb={3}>
        Login form will be implemented here.
      </Typography>
      <Button 
        variant="contained" 
        onClick={onSwitchToRegister} 
        fullWidth
        sx={{ 
          mt: 2,
          backgroundColor: '#dc2626',
          '&:hover': { backgroundColor: '#b91c1c' },
          borderRadius: '0px',
          textTransform: 'uppercase',
          fontWeight: 600
        }}
      >
        Switch to Register
      </Button>
    </Box>
  );
}
