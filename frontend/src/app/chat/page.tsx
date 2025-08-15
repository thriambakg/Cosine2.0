"use client";

import { useEffect } from 'react';
import { ChatInterfaceMUI } from '@/components/chat';
import { Box, Typography, Paper, Container } from '@mui/material';

export default function ChatPage() {
  useEffect(() => {
    console.log('🔄 ChatPage component mounted');
  }, []);

  console.log('🎯 ChatPage render function executing');

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ p: 2 }}>
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography variant="h4" gutterBottom>
            Chat Page Test
          </Typography>
          <Typography variant="body1">
            If you can see this, the page is rendering correctly.
          </Typography>
        </Paper>
        <ChatInterfaceMUI />
      </Box>
    </Container>
  );
}
