import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  Grid,
  CardContent,
  CardActionArea,
  Avatar,
  Chip,
  IconButton,
  Fade,
  Slide,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  AccountBalance as AccountBalanceIcon,
  SmartToy as BotIcon,
  Add as AddIcon,
  ArrowForward as ArrowRightIcon,
  BarChart as BarChartIcon,
  Security as SecurityIcon,
  Speed as SpeedIcon,
  Star as StarIcon,
  AutoAwesome as AutoAwesomeIcon,
  Chat as ChatIcon,
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';

const WelcomePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const features = [
    {
      id: 'dashboard',
      title: 'Create Dashboard',
      description: 'Build your personalized financial command center with custom tiles',
      icon: <DashboardIcon sx={{ fontSize: 32 }} />,
      color: '#3b82f6',
      gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
      action: () => navigate('/'),
    },
    {
      id: 'chat',
      title: 'AI Chat Assistant',
      description: 'Get instant financial insights and trading advice from our AI',
      icon: <BotIcon sx={{ fontSize: 32 }} />,
      color: '#8b5cf6',
      gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
      action: () => navigate('/chat'),
    },
    {
      id: 'portfolio',
      title: 'Portfolio Analysis',
      description: 'Analyze your investments with advanced risk metrics and optimization',
      icon: <BarChartIcon sx={{ fontSize: 32 }} />,
      color: '#10b981',
      gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      action: () => navigate('/portfolio-risk'),
    },
    {
      id: 'alerts',
      title: 'Stock Alerts',
      description: 'Set up intelligent alerts for price movements and market changes',
      icon: <TrendingUpIcon sx={{ fontSize: 32 }} />,
      color: '#f59e0b',
      gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      action: () => navigate('/stock-alerts'),
    },
  ];

  const quickActions = [
    {
      title: 'Add Crypto Tile',
      description: 'Track Bitcoin, Ethereum, and other cryptocurrencies',
      icon: <TrendingUpIcon />,
      color: '#f59e0b',
    },
    {
      title: 'Add Stock Tile',
      description: 'Monitor your favorite stocks and ETFs',
      icon: <AccountBalanceIcon />,
      color: '#10b981',
    },
    {
      title: 'AI Generated Content',
      description: 'Let AI create custom tiles based on your needs',
      icon: <AutoAwesomeIcon />,
      color: '#8b5cf6',
    },
  ];

  const stats = [
    { label: 'Active Users', value: '10K+', icon: <StarIcon /> },
    { label: 'Assets Tracked', value: '$50M+', icon: <TrendingUpIcon /> },
    { label: 'AI Insights', value: '1M+', icon: <BotIcon /> },
    { label: 'Uptime', value: '99.9%', icon: <SecurityIcon /> },
  ];

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
          top: '20%',
          left: '10%',
          width: 300,
          height: 300,
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '50%',
          filter: 'blur(60px)',
          animation: 'float 6s ease-in-out infinite'
        }} />
        <Box sx={{
          position: 'absolute',
          bottom: '20%',
          right: '10%',
          width: 400,
          height: 400,
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderRadius: '50%',
          filter: 'blur(80px)',
          animation: 'float 8s ease-in-out infinite reverse'
        }} />
      </Box>

      <Container maxWidth="xl" sx={{ position: 'relative', zIndex: 10, py: 6 }}>
        {/* Header */}
        <Fade in timeout={1000}>
          <Box sx={{ textAlign: 'center', mb: 8 }}>
            <Typography 
              variant="h2" 
              sx={{ 
                color: '#ffffff', 
                fontWeight: 800, 
                mb: 2,
                textTransform: 'uppercase',
                letterSpacing: '2px',
                fontSize: { xs: '2.5rem', md: '3.5rem' }
              }}
            >
              Welcome to Cosine
            </Typography>
            <Typography 
              variant="h5" 
              sx={{ 
                color: '#e2e8f0',
                fontWeight: 500,
                mb: 3,
                maxWidth: '600px',
                mx: 'auto'
              }}
            >
              Your AI-powered financial command center is ready. Let's build something amazing together.
            </Typography>
            <Chip
              icon={<StarIcon sx={{ fontSize: '16px !important', color: '#fbbf24' }} />}
              label={`Welcome, ${user?.name || 'Trader'}!`}
              sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                backdropFilter: 'blur(4px)',
                color: '#3b82f6',
                fontSize: '1rem',
                px: 3,
                py: 1,
                borderRadius: '0px',
                fontWeight: 600,
                border: '1px solid #3b82f6'
              }}
            />
          </Box>
        </Fade>

        {/* Stats Section */}
        <Slide direction="up" in timeout={1200}>
          <Box sx={{ mb: 8 }}>
            <Grid container spacing={3} justifyContent="center">
              {stats.map((stat, index) => (
                <Grid item xs={6} sm={3} key={stat.label}>
                  <Card sx={{
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    backdropFilter: 'blur(16px)',
                    border: '2px solid #374151',
                    borderRadius: '0px',
                    p: 2,
                    textAlign: 'center',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      border: '2px solid #3b82f6',
                      boxShadow: '0 20px 40px rgba(59, 130, 246, 0.2)'
                    }
                  }}>
                    <Avatar sx={{
                      backgroundColor: '#3b82f6',
                      width: 48,
                      height: 48,
                      mx: 'auto',
                      mb: 2
                    }}>
                      {stat.icon}
                    </Avatar>
                    <Typography variant="h4" sx={{ color: '#ffffff', fontWeight: 800, mb: 1 }}>
                      {stat.value}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#9ca3af', fontWeight: 600 }}>
                      {stat.label}
                    </Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Slide>

        {/* Main Features */}
        <Slide direction="up" in timeout={1400}>
          <Box sx={{ mb: 8 }}>
            <Typography 
              variant="h4" 
              sx={{ 
                color: '#ffffff', 
                fontWeight: 700, 
                mb: 4, 
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}
            >
              Get Started
            </Typography>
            <Grid container spacing={4}>
              {features.map((feature, index) => (
                <Grid item xs={12} sm={6} md={3} key={feature.id}>
                  <Card 
                    sx={{
                      backgroundColor: 'rgba(15, 23, 42, 0.9)',
                      backdropFilter: 'blur(16px)',
                      border: '2px solid #374151',
                      borderRadius: '0px',
                      height: '100%',
                      transition: 'all 0.3s ease',
                      transform: hoveredCard === feature.id ? 'scale(1.05)' : 'scale(1)',
                      boxShadow: hoveredCard === feature.id 
                        ? `0 20px 40px ${feature.color}20` 
                        : '0 8px 32px rgba(0, 0, 0, 0.3)',
                      borderColor: hoveredCard === feature.id ? feature.color : '#374151',
                    }}
                    onMouseEnter={() => setHoveredCard(feature.id)}
                    onMouseLeave={() => setHoveredCard(null)}
                  >
                    <CardActionArea 
                      onClick={feature.action}
                      sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}
                    >
                      <Box sx={{
                        background: feature.gradient,
                        borderRadius: '0px',
                        p: 2,
                        mb: 3,
                        width: 64,
                        height: 64,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto'
                      }}>
                        {feature.icon}
                      </Box>
                      <Typography 
                        variant="h6" 
                        sx={{ 
                          color: '#ffffff', 
                          fontWeight: 700, 
                          mb: 2,
                          textAlign: 'center',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}
                      >
                        {feature.title}
                      </Typography>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          color: '#e2e8f0',
                          textAlign: 'center',
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        {feature.description}
                      </Typography>
                      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                        <ArrowRightIcon sx={{ color: feature.color }} />
                      </Box>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Slide>

        {/* Quick Actions */}
        <Slide direction="up" in timeout={1600}>
          <Box sx={{ mb: 8 }}>
            <Typography 
              variant="h5" 
              sx={{ 
                color: '#ffffff', 
                fontWeight: 700, 
                mb: 4, 
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}
            >
              Quick Actions
            </Typography>
            <Grid container spacing={3} justifyContent="center">
              {quickActions.map((action, index) => (
                <Grid item xs={12} sm={4} key={action.title}>
                  <Card sx={{
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    backdropFilter: 'blur(16px)',
                    border: '2px solid #374151',
                    borderRadius: '0px',
                    p: 3,
                    textAlign: 'center',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      border: `2px solid ${action.color}`,
                      boxShadow: `0 15px 30px ${action.color}20`
                    }
                  }}>
                    <Box sx={{
                      backgroundColor: action.color,
                      borderRadius: '0px',
                      p: 1.5,
                      mb: 2,
                      width: 48,
                      height: 48,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto'
                    }}>
                      {action.icon}
                    </Box>
                    <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, mb: 1 }}>
                      {action.title}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                      {action.description}
                    </Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Slide>

        {/* Call to Action */}
        <Fade in timeout={1800}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography 
              variant="h6" 
              sx={{ 
                color: '#e2e8f0', 
                mb: 4,
                maxWidth: '600px',
                mx: 'auto'
              }}
            >
              Ready to revolutionize your trading experience? Start by creating your first dashboard.
            </Typography>
            <Button
              onClick={() => navigate('/')}
              size="large"
              sx={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: '#ffffff',
                px: 6,
                py: 2,
                fontSize: '1.25rem',
                fontWeight: 700,
                borderRadius: '0px',
                boxShadow: '0 20px 25px -5px rgb(59 130 246 / 0.3)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                transition: 'all 0.3s ease',
                border: '2px solid #3b82f6',
                '&:hover': {
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  boxShadow: '0 25px 50px -12px rgb(59 130 246 / 0.4)',
                  transform: 'scale(1.05)',
                }
              }}
              endIcon={<DashboardIcon />}
            >
              Create My Dashboard
            </Button>
          </Box>
        </Fade>
      </Container>

      {/* CSS Animations */}
      <style>
        {`
          @keyframes float {
            0%, 100% {
              transform: translateY(0px) rotate(0deg);
            }
            50% {
              transform: translateY(-20px) rotate(180deg);
            }
          }
        `}
      </style>
    </Box>
  );
};

export default WelcomePage;
