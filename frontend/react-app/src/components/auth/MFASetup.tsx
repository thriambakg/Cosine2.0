import React from 'react';
import { Box, Typography, Button } from '@mui/material';

interface MFASetupProps {
  onComplete: () => void;
  onSkip?: () => void;
  isOptional?: boolean;
}

export default function MFASetup({ onComplete, onSkip, isOptional }: MFASetupProps) {
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
        MFA Setup
      </Typography>
      <Typography variant="body1" color="#e2e8f0" mb={3}>
        MFA setup will be implemented here.
      </Typography>
      <Button 
        variant="contained" 
        onClick={onComplete} 
        fullWidth
        sx={{ 
          mt: 2,
          backgroundColor: '#22c55e',
          '&:hover': { backgroundColor: '#16a34a' },
          borderRadius: '0px',
          textTransform: 'uppercase',
          fontWeight: 600
        }}
      >
        Complete Setup
      </Button>
      {isOptional && onSkip && (
        <Button 
          variant="outlined" 
          onClick={onSkip} 
          fullWidth
          sx={{ 
            mt: 2,
            borderColor: '#6b7280',
            color: '#6b7280',
            borderRadius: '0px',
            textTransform: 'uppercase',
            fontWeight: 600
          }}
        >
          Skip for Now
        </Button>
      )}
    </Box>
  );
}
