import React from 'react';
import { Box, Typography, Paper, Container } from '@mui/material';

const CryptoStatsPage: React.FC = () => {
  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ p: 2 }}>
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography variant="h4" gutterBottom>
            Crypto Statistics
          </Typography>
          <Typography variant="body1">
            Crypto statistics will be implemented here.
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
};

export default CryptoStatsPage;
