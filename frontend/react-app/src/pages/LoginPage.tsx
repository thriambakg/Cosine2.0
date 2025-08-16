import React from 'react';
import { Box, Typography, Paper, Container } from '@mui/material';

const LoginPage: React.FC = () => {
  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Box sx={{ p: 2 }}>
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography variant="h4" gutterBottom>
            Login
          </Typography>
          <Typography variant="body1">
            Login form will be implemented here.
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
};

export default LoginPage;
