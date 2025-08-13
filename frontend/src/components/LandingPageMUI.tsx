"use client";

import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
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

import { AuthModal, EmailConfirmation } from './auth';
import { useAuth } from '@/contexts/AuthContext';

export default function LandingPageMUI() {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showEmailConfirmation, setShowEmailConfirmation] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
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

  const handleRegistrationSuccess = (email: string) => {
    setPendingEmail(email);
    setAuthModalOpen(false);
    setShowEmailConfirmation(true);
  };

  const handleEmailConfirmed = () => {
    setShowEmailConfirmation(false);
    setPendingEmail('');
    // User will be automatically logged in and redirected
  };

  const handleCloseEmailConfirmation = () => {
    setShowEmailConfirmation(false);
    setPendingEmail('');
    // Clear stored registration data
    sessionStorage.removeItem('pendingRegistration');
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1e3a8a 0%, #581c87 50%, #3730a3 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background Effects */}
      <Box sx={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.2)'
      }} />
      <Box sx={{
        position: 'absolute',
        inset: 0
      }}>
        <Box sx={{
          position: 'absolute',
          top: '25%',
          left: '25%',
          width: 384,
          height: 384,
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '50%',
          filter: 'blur(48px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        }} />
        <Box sx={{
          position: 'absolute',
          bottom: '25%',
          right: '25%',
          width: 384,
          height: 384,
          backgroundColor: 'rgba(168, 85, 247, 0.1)',
          borderRadius: '50%',
          filter: 'blur(48px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          animationDelay: '1s'
        }} />
        <Box sx={{
          position: 'absolute',
          top: '50%',
          right: '33%',
          width: 256,
          height: 256,
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          borderRadius: '50%',
          filter: 'blur(32px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          animationDelay: '0.5s'
        }} />
      </Box>

      {/* Content */}
      <Box sx={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        
        {/* Sign In Button - Floating in top right */}
        <Button
          onClick={handleSignIn}
          variant="outlined"
          sx={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 50,
            border: '1px solid rgba(255, 255, 255, 0.4)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            color: '#ffffff',
            fontWeight: 500,
            backdropFilter: 'blur(4px)',
            borderRadius: '8px',
            px: 3,
            py: 1,
            '&:hover': {
              backgroundColor: '#ffffff',
              color: '#1f2937',
              border: '1px solid rgba(255, 255, 255, 0.8)',
            }
          }}
        >
          Sign In
        </Button>

        {/* Hero Section */}
        <Box sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 3,
          py: 6
        }}>
          <Container maxWidth="lg">
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
              gap: 6,
              alignItems: 'center'
            }}>
              <Box sx={{ textAlign: { xs: 'center', lg: 'left' } }}>
                <Chip
                  icon={<Star sx={{ fontSize: '16px !important', color: '#fbbf24' }} />}
                  label="Trusted by 10K+ traders"
                  sx={{
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(4px)',
                    color: '#ffffff',
                    fontSize: '0.875rem',
                    px: 2,
                    py: 1,
                    borderRadius: '9999px',
                    mb: 3,
                    display: 'inline-flex'
                  }}
                />
                
                {/* Cosine Logo */}
                <Box sx={{ mb: 3, display: 'flex', justifyContent: { xs: 'center', lg: 'flex-start' } }}>
                  <Box 
                    component="img"
                    src="/logo.svg"
                    alt="Cosine"
                    sx={{ 
                      height: { xs: 120, md: 160 },
                      width: 'auto'
                    }} 
                  />
                </Box>
                
                <Typography 
                  variant="body1" 
                  sx={{ 
                    fontSize: { xs: '1.25rem', md: '1.5rem' },
                    color: 'rgba(219, 234, 254, 1)',
                    mb: 4,
                    lineHeight: 1.6
                  }}
                >
                  Experience the future of trading with our advanced AI assistant. Get real-time analysis, 
                  portfolio optimization, and intelligent insights to maximize your trading potential.
                </Typography>
                
                <Box sx={{ mb: 4 }}>
                  <Button
                    onClick={handleGetStarted}
                    size="large"
                    sx={{
                      background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                      color: '#ffffff',
                      px: 4,
                      py: 2,
                      fontSize: '1.125rem',
                      fontWeight: 600,
                      borderRadius: '12px',
                      boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                      textTransform: 'none',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                        boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
                        transform: 'scale(1.05)',
                      }
                    }}
                    endIcon={<ArrowRightIcon />}
                  >
                    Get Started Free
                  </Button>
                </Box>

                {/* Trust Indicators */}
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: { xs: 'center', lg: 'flex-start' },
                  gap: 4,
                  color: 'rgba(255, 255, 255, 0.7)',
                  flexWrap: 'wrap'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ShieldIcon sx={{ fontSize: 20, color: '#10b981' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>Bank-Grade Security</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <UsersIcon sx={{ fontSize: 20, color: '#3b82f6' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>10K+ Users</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DollarSignIcon sx={{ fontSize: 20, color: '#10b981' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>$50M+ Managed</Typography>
                  </Box>
                </Box>
              </Box>

              {/* Feature Preview */}
              <Box sx={{ position: 'relative' }}>
                <Card sx={{
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(16px)',
                  borderRadius: '16px',
                  p: 4,
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                    <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Portfolio Dashboard
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, backgroundColor: '#ef4444', borderRadius: '50%' }} />
                      <Box sx={{ width: 12, height: 12, backgroundColor: '#eab308', borderRadius: '50%' }} />
                      <Box sx={{ width: 12, height: 12, backgroundColor: '#22c55e', borderRadius: '50%' }} />
                    </Box>
                  </Box>
                  
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Card sx={{
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '8px',
                      p: 2,
                      border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.875rem' }}>
                          Total Portfolio Value
                        </Typography>
                        <TrendingUp sx={{ fontSize: 16, color: '#22c55e' }} />
                      </Box>
                      <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 700 }}>
                        $124,567.89
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#22c55e', fontSize: '0.875rem' }}>
                        +12.4% this month
                      </Typography>
                    </Card>
                    
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                      <Card sx={{
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        p: 1.5,
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <BarChart3Icon sx={{ fontSize: 16, color: '#3b82f6' }} />
                          <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                            AI Score
                          </Typography>
                        </Box>
                        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 700 }}>
                          8.7/10
                        </Typography>
                      </Card>
                      <Card sx={{
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        p: 1.5,
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <ActivityIcon sx={{ fontSize: 16, color: '#a855f7' }} />
                          <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                            Risk Level
                          </Typography>
                        </Box>
                        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 700 }}>
                          Moderate
                        </Typography>
                      </Card>
                    </Box>
                    
                    <Card sx={{
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '8px',
                      p: 1.5,
                      border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <BotIcon sx={{ fontSize: 16, color: '#6366f1' }} />
                        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.875rem' }}>
                          AI Recommendation
                        </Typography>
                      </Box>
                      <Typography variant="caption" sx={{ color: '#ffffff', fontSize: '0.75rem' }}>
                        Consider rebalancing your tech allocation. Current weighting is 35% - recommended 28%.
                      </Typography>
                    </Card>
                  </Box>
                </Card>
                
                {/* Floating Elements */}
                <Box sx={{
                  position: 'absolute',
                  top: -16,
                  right: -16,
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  borderRadius: '50%',
                  p: 1.5,
                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                  animation: 'bounce 1s infinite'
                }}>
                  <TrendingUp sx={{ fontSize: 24, color: '#ffffff' }} />
                </Box>
                <Box sx={{
                  position: 'absolute',
                  bottom: -16,
                  left: -16,
                  background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                  borderRadius: '50%',
                  p: 1.5,
                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                }}>
                  <PieChart sx={{ fontSize: 24, color: '#ffffff' }} />
                </Box>
              </Box>
            </Box>
          </Container>
        </Box>

        {/* Features Section */}
        <Box sx={{ px: 3, pb: 6 }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center', mb: 6 }}>
              <Typography variant="h4" sx={{ color: '#ffffff', fontWeight: 700, mb: 2 }}>
                Why Choose Cosine?
              </Typography>
              <Typography variant="h6" sx={{ color: 'rgba(219, 234, 254, 1)' }}>
                Advanced AI technology meets intuitive trading
              </Typography>
            </Box>
            
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              gap: 4
            }}>
              <Card sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                p: 3,
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  transform: 'scale(1.05)',
                }
              }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{
                    width: 64,
                    height: 64,
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    borderRadius: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2
                  }}>
                    <BotIcon sx={{ fontSize: 32, color: '#ffffff' }} />
                  </Box>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, mb: 1.5 }}>
                    AI-Powered Analysis
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(219, 234, 254, 1)' }}>
                    Advanced machine learning algorithms analyze market patterns and provide intelligent trading insights.
                  </Typography>
                </Box>
              </Card>
              
              <Card sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                p: 3,
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  transform: 'scale(1.05)',
                }
              }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{
                    width: 64,
                    height: 64,
                    background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                    borderRadius: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2
                  }}>
                    <ShieldIcon sx={{ fontSize: 32, color: '#ffffff' }} />
                  </Box>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, mb: 1.5 }}>
                    Bank-Grade Security
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(219, 234, 254, 1)' }}>
                    Enterprise-level security with 2FA, encryption, and compliance with financial regulations.
                  </Typography>
                </Box>
              </Card>
              
              <Card sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                p: 3,
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  transform: 'scale(1.05)',
                }
              }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{
                    width: 64,
                    height: 64,
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                    borderRadius: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2
                  }}>
                    <ZapIcon sx={{ fontSize: 32, color: '#ffffff' }} />
                  </Box>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, mb: 1.5 }}>
                    Real-Time Insights
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(219, 234, 254, 1)' }}>
                    Get instant market analysis, portfolio updates, and trading signals powered by live data feeds.
                  </Typography>
                </Box>
              </Card>
            </Box>
          </Container>
        </Box>

        {/* Footer */}
        <Box sx={{ p: 3, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                © 2025 Cosine AI Trading Platform. All rights reserved.
              </Typography>
            </Box>
          </Container>
        </Box>
      </Box>

      {/* Add CSS animations in a style tag */}
      <style>
        {`
          @keyframes bounce {
            0%, 100% {
              transform: translateY(0);
              animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
            }
            50% {
              transform: translateY(-25%);
              animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
            }
          }
          
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
            }
            50% {
              opacity: .5;
            }
          }
        `}
      </style>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultMode={authMode}
        onRegistrationSuccess={handleRegistrationSuccess}
      />

      {showEmailConfirmation && pendingEmail && (
        <EmailConfirmation
          email={pendingEmail}
          onClose={handleCloseEmailConfirmation}
          onConfirmed={handleEmailConfirmed}
        />
      )}
    </Box>
  );
}