"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ChatInterfaceMUI } from '@/components/chat';
import { Box, Typography, Paper, Container } from '@mui/material';
import LoadingPage from '@/components/LoadingPage';

export default function ChatPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    console.log('🔄 ChatPage component mounted');
  }, []);

  useEffect(() => {
    if (!isLoading && !user) {
      console.log('Redirecting unauthenticated user to login from chat page');
      router.replace('/login');
    }
  }, [user, isLoading, router]);

  console.log('🎯 ChatPage render function executing');

  // Show loading while checking auth
  if (isLoading) {
    return <LoadingPage />;
  }

  // Redirect if not authenticated
  if (!user) {
    return <LoadingPage />;
  }

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
