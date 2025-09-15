import React from 'react';
import { Box, Typography, Container } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { OverhauledTabManager } from '../components/OverhauledTabManager';

export default function OverhauledDashboardPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '100vh',
          bgcolor: 'background.default'
        }}
      >
        <Container maxWidth="sm">
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h4" component="h2" gutterBottom color="primary">
              Authentication Required
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Please log in to access the dashboard.
            </Typography>
          </Box>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <OverhauledTabManager userId={user.id} />
    </Box>
  );
}
