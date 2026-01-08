import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  ArrowForward as ArrowRightIcon,
  Star,
  People as UsersIcon,
  TrendingDown,
  Gavel as GavelIcon,
  Description as DescriptionIcon,
  Article as ArticleIcon,
} from '@mui/icons-material';

import { AuthModal } from '../auth';
import { useAuth } from '@/contexts/AuthContext';

export default function LandingPageMUI() {
  // Use localStorage to persist modal state across component remounts
  const [authModalOpen, setAuthModalOpenRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('authModalOpen');
      return saved === 'true';
    }
    return false;
  });
  const [authMode, setAuthModeRaw] = useState<'login' | 'register'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('authMode');
      return (saved as 'login' | 'register') || 'login';
    }
    return 'login';
  });
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();

  // Wrapper functions to log where state is being changed from AND persist to localStorage
  const setAuthModalOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    const stack = new Error().stack || '';
    const caller = stack.split('\n')[2] || 'unknown';
    console.log(`🏠 LandingPage: setAuthModalOpen(${value}) called from:`, caller);
    setAuthModalOpenRaw(prevValue => {
      const newValue = typeof value === 'function' ? value(prevValue) : value;
      if (typeof window !== 'undefined') {
        localStorage.setItem('authModalOpen', String(newValue));
      }
      return newValue;
    });
  };

  const setAuthMode = (mode: 'login' | 'register' | ((prev: 'login' | 'register') => 'login' | 'register')) => {
    const stack = new Error().stack || '';
    const caller = stack.split('\n')[2] || 'unknown';
    console.log(`🏠 LandingPage: setAuthMode(${mode}) called from:`, caller);
    setAuthModeRaw(prevMode => {
      const newMode = typeof mode === 'function' ? mode(prevMode) : mode;
      if (typeof window !== 'undefined') {
        localStorage.setItem('authMode', newMode);
      }
      return newMode;
    });
  };

  // Log auth modal state changes
  useEffect(() => {
    console.log('🏠 LandingPage: useEffect [authModalOpen, authMode] fired with:', { authModalOpen, authMode });
    console.log('🏠 LandingPage: Dependencies changed - checking what changed');
  }, [authModalOpen, authMode]);

  useEffect(() => {
    if (isAuthenticated && typeof window !== 'undefined' && !authModalOpen) {
      console.log('🏠 LandingPage: User authenticated and modal not open - redirecting to /chat');
      window.location.href = '/chat';
    }
  }, [isAuthenticated, authModalOpen]);

  // Check for error parameters and automatically open auth modal
  useEffect(() => {
    const error = searchParams.get('error');
    console.log('🏠 LandingPage: searchParams effect running, error param:', error, 'searchParams:', Object.fromEntries(searchParams));
    if (error) {
      console.log('🏠 LandingPage: Error param detected, opening login modal:', error);
      setAuthMode('login');
      setAuthModalOpen(true);
    }
  }, [searchParams]);

  const handleGetStarted = () => {
    console.log('🏠 LandingPage: handleGetStarted called');
    setAuthMode('register');
    setAuthModalOpen(true);
  };

  const handleSignIn = () => {
    console.log('🏠 LandingPage: handleSignIn called');
    setAuthMode('login');
    setAuthModalOpen(true);
  };

  const handleRegistrationSuccess = () => {
    console.log('🏠 LandingPage: handleRegistrationSuccess called - CLOSING MODAL');
    setAuthModalOpen(false);
    // Show success message - user will get email with verification link
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background Effects */}
      <Box sx={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)'
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
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderRadius: '0%',
          filter: 'blur(48px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        }} />
        <Box sx={{
          position: 'absolute',
          bottom: '25%',
          right: '25%',
          width: 384,
          height: 384,
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          borderRadius: '0%',
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
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '0%',
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
            border: '2px solid #dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            color: '#dc2626',
            fontWeight: 600,
            backdropFilter: 'blur(4px)',
            borderRadius: '0px',
            px: 3,
            py: 1.5,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            '&:hover': {
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: '2px solid #dc2626',
              transform: 'scale(1.05)',
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
                  label="Transparency & Research Platform"
                  sx={{
                    backgroundColor: 'rgba(220, 38, 38, 0.2)',
                    backdropFilter: 'blur(4px)',
                    color: '#dc2626',
                    fontSize: '0.875rem',
                    px: 2,
                    py: 1,
                    borderRadius: '0px',
                    mb: 3,
                    display: 'inline-flex',
                    fontWeight: 600,
                    border: '1px solid #dc2626'
                  }}
                />
                
                {/* Cosine Logo */}
                <Box sx={{ mb: 3, display: 'flex', justifyContent: { xs: 'center', lg: 'flex-start' } }}>
                  <Box 
                    component="img"
                    src="/logo-dark.svg"
                    alt="Cosine"
                    sx={{ 
                      height: { xs: 120, md: 160 },
                      width: 'auto',
                      filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))',
                    }} 
                  />
                </Box>
                
                <Typography 
                  variant="body1" 
                  sx={{ 
                    fontSize: { xs: '1.25rem', md: '1.5rem' },
                    color: '#e2e8f0',
                    mb: 4,
                    lineHeight: 1.6,
                    fontWeight: 500
                  }}
                >
                  Research government disclosures, track political influence, analyze financial data, and get AI-powered insights. 
                  Access SEC filings, lobbying disclosures, Congress bills, politician trades, government contracts, and more in one unified platform.
                </Typography>
                
                <Box sx={{ mb: 4 }}>
                  <Button
                    onClick={handleGetStarted}
                    size="large"
                    sx={{
                      background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                      color: '#ffffff',
                      px: 4,
                      py: 2,
                      fontSize: '1.125rem',
                      fontWeight: 700,
                      borderRadius: '0px',
                      boxShadow: '0 20px 25px -5px rgb(220 38 38 / 0.3), 0 8px 10px -6px rgb(220 38 38 / 0.2)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      transition: 'all 0.3s ease',
                      border: '2px solid #dc2626',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)',
                        boxShadow: '0 25px 50px -12px rgb(220 38 38 / 0.4)',
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
                    <ShieldIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.875rem', fontWeight: 600 }}>Secure & Private</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <UsersIcon sx={{ fontSize: 20, color: '#3b82f6' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.875rem', fontWeight: 600 }}>Open Data Access</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ZapIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.875rem', fontWeight: 600 }}>AI-Powered Research</Typography>
                  </Box>
                </Box>
              </Box>

              {/* Feature Preview */}
              <Box sx={{ position: 'relative' }}>
                <Card sx={{
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  backdropFilter: 'blur(16px)',
                  borderRadius: '0px',
                  p: 4,
                  border: '2px solid #374151',
                  boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.5)'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                    <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 700, textTransform: 'uppercase' }}>
                      Research Dashboard
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, backgroundColor: '#dc2626', borderRadius: '0%' }} />
                      <Box sx={{ width: 12, height: 12, backgroundColor: '#fbbf24', borderRadius: '0%' }} />
                      <Box sx={{ width: 12, height: 12, backgroundColor: '#22c55e', borderRadius: '0%' }} />
                    </Box>
                  </Box>
                  
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Card sx={{
                      backgroundColor: 'rgba(31, 41, 55, 0.8)',
                      borderRadius: '0px',
                      p: 2,
                      border: '1px solid #4b5563'
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.875rem', fontWeight: 600 }}>
                          SEC Filings Found
                        </Typography>
                        <DescriptionIcon sx={{ fontSize: 16, color: '#3b82f6' }} />
                      </Box>
                      <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 800 }}>
                        1,247
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#3b82f6', fontSize: '0.875rem', fontWeight: 600 }}>
                        Last 30 days
                      </Typography>
                    </Card>
                    
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                      <Card sx={{
                        backgroundColor: 'rgba(31, 41, 55, 0.8)',
                        borderRadius: '0px',
                        p: 1.5,
                        border: '1px solid #4b5563'
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <GavelIcon sx={{ fontSize: 16, color: '#dc2626' }} />
                          <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)', fontWeight: 600 }}>
                            LDA Disclosures
                          </Typography>
                        </Box>
                        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 800 }}>
                          856
                        </Typography>
                      </Card>
                      <Card sx={{
                        backgroundColor: 'rgba(31, 41, 55, 0.8)',
                        borderRadius: '0px',
                        p: 1.5,
                        border: '1px solid #4b5563'
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <ArticleIcon sx={{ fontSize: 16, color: '#22c55e' }} />
                          <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)', fontWeight: 600 }}>
                            Congress Bills
                          </Typography>
                        </Box>
                        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 800 }}>
                          342
                        </Typography>
                      </Card>
                    </Box>
                    
                    <Card sx={{
                      backgroundColor: 'rgba(31, 41, 55, 0.8)',
                      borderRadius: '0px',
                      p: 1.5,
                      border: '1px solid #4b5563'
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <BotIcon sx={{ fontSize: 16, color: '#6366f1' }} />
                        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.875rem', fontWeight: 600 }}>
                          AI Research Assistant
                        </Typography>
                      </Box>
                      <Typography variant="caption" sx={{ color: '#ffffff', fontSize: '0.75rem' }}>
                        Ask questions about government data, analyze relationships, and get insights powered by AI.
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
                  borderRadius: '0%',
                  p: 1.5,
                  boxShadow: '0 10px 15px -3px rgb(34 197 94 / 0.3)',
                  animation: 'bounce 1s infinite',
                  border: '2px solid #16a34a'
                }}>
                  <TrendingUp sx={{ fontSize: 24, color: '#ffffff' }} />
                </Box>
                <Box sx={{
                  position: 'absolute',
                  bottom: -16,
                  left: -16,
                  background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                  borderRadius: '0%',
                  p: 1.5,
                  boxShadow: '0 10px 15px -3px rgb(220 38 38 / 0.3)',
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  border: '2px solid #b91c1c'
                }}>
                  <TrendingDown sx={{ fontSize: 24, color: '#ffffff' }} />
                </Box>
              </Box>
            </Box>
          </Container>
        </Box>

        {/* Features Section */}
        <Box sx={{ px: 3, pb: 6 }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center', mb: 6 }}>
              <Typography variant="h4" sx={{ color: '#ffffff', fontWeight: 800, mb: 2, textTransform: 'uppercase' }}>
                Powerful Research Tools
              </Typography>
              <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                Access government data, track political influence, and analyze financial disclosures
              </Typography>
            </Box>
            
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              gap: 4
            }}>
              <Card sx={{
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(16px)',
                border: '2px solid #374151',
                p: 3,
                transition: 'all 0.3s ease',
                borderRadius: '0px',
                '&:hover': {
                  backgroundColor: 'rgba(31, 41, 55, 0.9)',
                  transform: 'scale(1.05)',
                  border: '2px solid #dc2626',
                }
              }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{
                    width: 64,
                    height: 64,
                    background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                    borderRadius: '0px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2,
                    border: '2px solid #b91c1c'
                  }}>
                    <BotIcon sx={{ fontSize: 32, color: '#ffffff' }} />
                  </Box>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 700, mb: 1.5, textTransform: 'uppercase' }}>
                    Government Data Search
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    Search SEC filings, lobbying disclosures, Congress bills, politician trades, and government contracts with advanced filtering.
                  </Typography>
                </Box>
              </Card>
              
              <Card sx={{
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(16px)',
                border: '2px solid #374151',
                p: 3,
                transition: 'all 0.3s ease',
                borderRadius: '0px',
                '&:hover': {
                  backgroundColor: 'rgba(31, 41, 55, 0.9)',
                  transform: 'scale(1.05)',
                  border: '2px solid #22c55e',
                }
              }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{
                    width: 64,
                    height: 64,
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                    borderRadius: '0px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2,
                    border: '2px solid #16a34a'
                  }}>
                    <ShieldIcon sx={{ fontSize: 32, color: '#ffffff' }} />
                  </Box>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 700, mb: 1.5, textTransform: 'uppercase' }}>
                    AI Research Assistant
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    Get intelligent answers about government data, analyze relationships between entities, and discover insights with AI-powered chat.
                  </Typography>
                </Box>
              </Card>
              
              <Card sx={{
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(16px)',
                border: '2px solid #374151',
                p: 3,
                transition: 'all 0.3s ease',
                borderRadius: '0px',
                '&:hover': {
                  backgroundColor: 'rgba(31, 41, 55, 0.9)',
                  transform: 'scale(1.05)',
                  border: '2px solid #3b82f6',
                }
              }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{
                    width: 64,
                    height: 64,
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    borderRadius: '0px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2,
                    border: '2px solid #2563eb'
                  }}>
                    <ZapIcon sx={{ fontSize: 32, color: '#ffffff' }} />
                  </Box>
                  <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 700, mb: 1.5, textTransform: 'uppercase' }}>
                    Comprehensive Data
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    Access news articles, stock data, portfolio analysis, and organize your research with our integrated filesystem.
                  </Typography>
                </Box>
              </Card>
            </Box>
          </Container>
        </Box>

        {/* Footer */}
        <Box sx={{ p: 3, borderTop: '2px solid #374151' }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: 600 }}>
                © 2025 Cosine Research Platform. All rights reserved.
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
        onClose={() => {
          console.log('🏠 LandingPage: AuthModal onClose callback triggered');
          console.trace('🏠 LandingPage: onClose call stack');
          setAuthModalOpen(false);
        }}
        defaultMode={authMode}
        onRegistrationSuccess={handleRegistrationSuccess}
      />
    </Box>
  );
}
