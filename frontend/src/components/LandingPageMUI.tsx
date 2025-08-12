"use client";

import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Grid,
  Chip,
} from '@mui/material';
import {
  SmartToy as BotIcon,
  TrendingUp,
  Security as ShieldIcon,
  Bolt as ZapIcon,
  BarChart as BarChart3Icon,
  PieChart,
  Timeline as ActivityIcon,
  ArrowForward as ArrowRightIcon,
  Star,
  People as UsersIcon,
  AttachMoney as DollarSignIcon,
} from '@mui/icons-material';

import { GradientBackground, GlassCard, GradientButton, FeatureCard, MetricCard } from './mui';
import { AuthModal } from './auth';
import { useAuth } from '@/contexts/AuthContext';

export default function LandingPageMUI() {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      window.location.href = '/chat';
    }
  }, [isAuthenticated]);

  const handleGetStarted = () => {
    setAuthMode('register');
    setAuthModalOpen(true);
  };

  const handleSignIn = () => {
    setAuthMode('login');
    setAuthModalOpen(true);
  };

  return (
    <GradientBackground variant="default" animated>
      {/* Sign In Button - Floating in top right */}
      <Box
        sx={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 1000,
        }}
      >
        <GradientButton onClick={handleSignIn} sx={{ px: 3 }}>
          Sign In
        </GradientButton>
      </Box>

      {/* Hero Section */}
      <Container maxWidth="xl" sx={{ pt: 8, pb: 8 }}>
        <Grid container spacing={6} alignItems="center" minHeight="80vh">
          <Grid item xs={12} lg={6}>
            <Box textAlign={{ xs: 'center', lg: 'left' }}>
              <Chip
                icon={<Star sx={{ color: '#FCD34D !important' }} />}
                label="Trusted by 10K+ traders"
                sx={{
                  mb: 4,
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'text.primary',
                  '& .MuiChip-icon': {
                    color: '#FCD34D',
                  },
                }}
              />
              
              {/* Main Logo */}
              <Box display="flex" justifyContent={{ xs: 'center', lg: 'flex-start' }} mb={4}>
                <Box
                  component="img"
                  src="/logo.svg"
                  alt="Cosine - AI Trading Intelligence"
                  sx={{
                    height: { xs: 120, md: 160 },
                    width: 'auto',
                    filter: 'brightness(1.1) drop-shadow(0 8px 16px rgba(0, 0, 0, 0.3))',
                  }}
                />
              </Box>
              
              {/* Description and Dashboard side by side */}
              <Grid container spacing={4} alignItems="center">
                {/* Description Text */}
                <Grid item xs={12} lg={6}>
                  <Typography variant="h6" color="primary.light" sx={{ mb: 4, lineHeight: 1.6 }}>
                    Experience the future of trading with our advanced AI assistant. Get real-time analysis, 
                    portfolio optimization, and intelligent insights to maximize your trading potential.
                  </Typography>
                  
                  <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={2} mb={4}>
                    <GradientButton
                      onClick={handleGetStarted}
                      size="large"
                      endIcon={<ArrowRightIcon />}
                      sx={{
                        px: 4,
                        py: 2,
                        fontSize: '1.1rem',
                        fontWeight: 600,
                      }}
                    >
                      Get Started Free
                    </GradientButton>
                  </Box>

                  {/* Trust Indicators */}
                  <Box 
                    display="flex" 
                    justifyContent={{ xs: 'center', lg: 'flex-start' }} 
                    flexWrap="wrap"
                    gap={3}
                    color="text.secondary"
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <ShieldIcon sx={{ color: 'success.main', fontSize: 20 }} />
                      <Typography variant="body2">Bank-Grade Security</Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <UsersIcon sx={{ color: 'primary.light', fontSize: 20 }} />
                      <Typography variant="body2">10K+ Users</Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <DollarSignIcon sx={{ color: 'success.main', fontSize: 20 }} />
                      <Typography variant="body2">$50M+ Managed</Typography>
                    </Box>
                  </Box>
                </Grid>

                {/* Dashboard Preview */}
                <Grid item xs={12} lg={6}>
            <GlassCard sx={{ p: 4, position: 'relative' }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
                <Typography variant="h6" fontWeight={600} color="text.primary">
                  Portfolio Dashboard
                </Typography>
                <Box display="flex" gap={1}>
                  <Box width={12} height={12} borderRadius="50%" bgcolor="#EF4444" />
                  <Box width={12} height={12} borderRadius="50%" bgcolor="#F59E0B" />
                  <Box width={12} height={12} borderRadius="50%" bgcolor="#10B981" />
                </Box>
              </Box>
              
              <Box mb={3}>
                <GlassCard glassTint="light" sx={{ p: 3 }}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                    <Typography variant="body2" color="text.secondary">
                      Total Portfolio Value
                    </Typography>
                    <TrendingUp sx={{ color: 'success.main', fontSize: 16 }} />
                  </Box>
                  <Typography variant="h4" fontWeight={700} color="text.primary">
                    $124,567.89
                  </Typography>
                  <Typography variant="body2" color="success.main">
                    +12.4% this month
                  </Typography>
                </GlassCard>
              </Box>
              
              <Grid container spacing={2} mb={3}>
                <Grid item xs={6}>
                  <MetricCard
                    title="AI Score"
                    value="8.7/10"
                    icon={BarChart3Icon}
                    color="primary"
                  />
                </Grid>
                <Grid item xs={6}>
                  <MetricCard
                    title="Risk Level"
                    value="Moderate"
                    icon={ActivityIcon}
                    color="secondary"
                  />
                </Grid>
              </Grid>
              
              <GlassCard glassTint="light" sx={{ p: 2 }}>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <BotIcon sx={{ color: 'primary.light', fontSize: 16 }} />
                  <Typography variant="body2" color="text.secondary">
                    AI Recommendation
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.primary">
                  Consider rebalancing your tech allocation. Current weighting is 35% - recommended 28%.
                </Typography>
              </GlassCard>
              
              {/* Floating Elements */}
              <Box
                sx={{
                  position: 'absolute',
                  top: -16,
                  right: -16,
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: 'bounce 2s infinite',
                  boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)',
                }}
              >
                <TrendingUp sx={{ color: 'white', fontSize: 24 }} />
              </Box>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: -16,
                  left: -16,
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: 'pulse 2s infinite',
                  boxShadow: '0 4px 16px rgba(139, 92, 246, 0.3)',
                }}
              >
                <PieChart sx={{ color: 'white', fontSize: 24 }} />
              </Box>
            </GlassCard>
                </Grid>
              </Grid>
            </Box>
          </Grid>
        </Grid>
      </Container>

      {/* Features Section */}
      <Container maxWidth="xl" sx={{ py: 8 }}>
        <Box textAlign="center" mb={8}>
          <Typography variant="h2" fontWeight={700} color="text.primary" mb={2}>
            Why Choose Cosine?
          </Typography>
          <Typography variant="h6" color="primary.light">
            Advanced AI technology meets intuitive trading
          </Typography>
        </Box>
        
        <Grid container spacing={4}>
          <Grid item xs={12} md={4}>
            <FeatureCard
              title="AI-Powered Analysis"
              description="Advanced machine learning algorithms analyze market patterns and provide intelligent trading insights."
              icon={BotIcon}
              gradient="linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%)"
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <FeatureCard
              title="Bank-Grade Security"
              description="Enterprise-level security with 2FA, encryption, and compliance with financial regulations."
              icon={ShieldIcon}
              gradient="linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)"
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <FeatureCard
              title="Real-Time Insights"
              description="Get instant market analysis, portfolio updates, and trading signals powered by live data feeds."
              icon={ZapIcon}
              gradient="linear-gradient(135deg, #10B981 0%, #059669 100%)"
            />
          </Grid>
        </Grid>
      </Container>

      {/* Footer */}
      <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', py: 4 }}>
        <Container maxWidth="xl">
          <Typography variant="body2" color="text.secondary" textAlign="center">
            © 2025 Cosine AI Trading Platform. All rights reserved.
          </Typography>
        </Container>
      </Box>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultMode={authMode}
      />
    </GradientBackground>
  );
}
