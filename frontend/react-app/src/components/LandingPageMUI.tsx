import React from 'react';
import { Box, Typography, Paper, Container } from '@mui/material';

const LandingPageMUI: React.FC = () => {
  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ p: 2 }}>
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography variant="h4" gutterBottom>
            Welcome to Cosine
          </Typography>
          <Typography variant="body1">
            Investment Analytics Platform
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
};

export default LandingPageMUI;
