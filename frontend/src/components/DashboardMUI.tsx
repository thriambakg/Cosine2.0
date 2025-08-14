"use client";

import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Chip,
} from '@mui/material';
import {
  TrendingUp,
  BarChart as BarChart3Icon,
  PieChart,
  Timeline as ActivityIcon,
  Chat as MessageSquareIcon,
  Upload,
  Settings,
  AttachMoney as DollarSignIcon,
  Percent,
  Flag as TargetIcon,
  ArrowForward as ArrowRightIcon,
} from '@mui/icons-material';

import { GlassCard, GradientButton, MetricCard } from './mui';
import AuthStatusBanner from './AuthStatusBanner';
import RouteHandler from './RouteHandler';
import Link from 'next/link';

export default function DashboardMUI() {

  return (
    <Box>
        {/* Route Handler and Auth Banner */}
        <RouteHandler />
        <AuthStatusBanner />
        
        {/* Welcome Section */}
        <GlassCard sx={{ p: 4, mb: 4, background: 'linear-gradient(135deg, #3B82F650 0%, #8B5CF650 100%)' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Box>
              <Typography variant="h3" fontWeight={700} color="text.primary" mb={1}>
                Welcome back, {user?.firstName}! 👋
              </Typography>
              <Typography variant="h6" color="primary.light">
                Ready to analyze the markets and optimize your portfolio?
              </Typography>
            </Box>
            <Box display={{ xs: 'none', md: 'flex' }} gap={4}>
              <Box textAlign="center">
                <Typography variant="h4" fontWeight={700} color="text.primary">
                  $124.5K
                </Typography>
                <Typography variant="body2" color="primary.light">
                  Portfolio Value
                </Typography>
              </Box>
              <Box textAlign="center">
                <Typography variant="h4" fontWeight={700} color="success.main">
                  +12.4%
                </Typography>
                <Typography variant="body2" color="primary.light">
                  This Month
                </Typography>
              </Box>
            </Box>
          </Box>
        </GlassCard>

        {/* Quick Actions */}
        <Grid container spacing={3} mb={4}>
          <Grid item xs={12} sm={6} md={3}>
            <Link href="/chat" style={{ textDecoration: 'none' }}>
              <GlassCard sx={{ p: 3, textAlign: 'center', cursor: 'pointer' }}>
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2,
                  }}
                >
                  <MessageSquareIcon sx={{ color: 'white', fontSize: 24 }} />
                </Box>
                <Typography variant="h6" fontWeight={600} color="text.primary" mb={1}>
                  AI Chat
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Ask anything
                </Typography>
              </GlassCard>
            </Link>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlassCard sx={{ p: 3, textAlign: 'center', cursor: 'pointer' }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mx: 'auto',
                  mb: 2,
                }}
              >
                <Upload sx={{ color: 'white', fontSize: 24 }} />
              </Box>
              <Typography variant="h6" fontWeight={600} color="text.primary" mb={1}>
                Upload Data
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Analyze files
              </Typography>
            </GlassCard>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlassCard sx={{ p: 3, textAlign: 'center', cursor: 'pointer' }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mx: 'auto',
                  mb: 2,
                }}
              >
                <BarChart3Icon sx={{ color: 'white', fontSize: 24 }} />
              </Box>
              <Typography variant="h6" fontWeight={600} color="text.primary" mb={1}>
                Portfolio
              </Typography>
              <Typography variant="body2" color="text.secondary">
                View holdings
              </Typography>
            </GlassCard>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <GlassCard sx={{ p: 3, textAlign: 'center', cursor: 'pointer' }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mx: 'auto',
                  mb: 2,
                }}
              >
                <Settings sx={{ color: 'white', fontSize: 24 }} />
              </Box>
              <Typography variant="h6" fontWeight={600} color="text.primary" mb={1}>
                Settings
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Preferences
              </Typography>
            </GlassCard>
          </Grid>
        </Grid>

        {/* Dashboard Content */}
        <Grid container spacing={4}>
          {/* Main Content */}
          <Grid item xs={12} lg={8}>
            {/* Portfolio Overview */}
            <GlassCard sx={{ p: 4, mb: 4 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h5" fontWeight={600} color="text.primary">
                  Portfolio Overview
                </Typography>
                <GradientButton
                  variant="outlined"
                  endIcon={<ArrowRightIcon />}
                  sx={{ px: 3 }}
                >
                  View Details
                </GradientButton>
              </Box>
              
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <MetricCard
                    title="Total Value"
                    subtitle="Current portfolio"
                    value="$124,567"
                    icon={DollarSignIcon}
                    color="success"
                    trend="up"
                    trendValue="+$13,425 today"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <MetricCard
                    title="Returns"
                    subtitle="This month"
                    value="+12.4%"
                    icon={Percent}
                    color="primary"
                    trend="up"
                    trendValue="vs +8.2% S&P 500"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <MetricCard
                    title="Risk Score"
                    subtitle="Current level"
                    value="7.2/10"
                    icon={ActivityIcon}
                    color="warning"
                    trend="neutral"
                    trendValue="Moderate"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <MetricCard
                    title="AI Score"
                    subtitle="Optimization"
                    value="8.7/10"
                    icon={TargetIcon}
                    color="secondary"
                    trend="up"
                    trendValue="Excellent"
                  />
                </Grid>
              </Grid>
            </GlassCard>

            {/* Recent Activity */}
            <GlassCard sx={{ p: 4 }}>
              <Typography variant="h5" fontWeight={600} color="text.primary" mb={3}>
                Recent Activity
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                {[
                  { icon: BotIcon, title: 'AI Analysis Complete', desc: 'Portfolio rebalancing recommendations generated', time: '2 hours ago', color: 'primary' },
                  { icon: TrendingUp, title: 'Market Alert', desc: 'AAPL reached your target price of $180', time: '4 hours ago', color: 'success' },
                  { icon: PieChart, title: 'Portfolio Updated', desc: 'Added 50 shares of MSFT to your portfolio', time: '1 day ago', color: 'secondary' },
                ].map((activity, index) => (
                  <Box key={index} display="flex" alignItems="center" gap={2} p={2} sx={{ bgcolor: 'rgba(255, 255, 255, 0.05)', borderRadius: 2 }}>
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '10px',
                        bgcolor: `${activity.color}.main`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <activity.icon sx={{ color: 'white', fontSize: 20 }} />
                    </Box>
                    <Box flex={1}>
                      <Typography variant="body1" fontWeight={500} color="text.primary">
                        {activity.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {activity.desc}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {activity.time}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </GlassCard>
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} lg={4}>
            {/* AI Assistant */}
            <GlassCard sx={{ p: 4, mb: 4 }}>
              <Box display="flex" alignItems="center" gap={2} mb={3}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <BotIcon sx={{ color: 'white', fontSize: 20 }} />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={600} color="text.primary">
                    AI Assistant
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Ready to help
                  </Typography>
                </Box>
              </Box>
              
              <GlassCard glassTint="light" sx={{ p: 2, mb: 3 }}>
                <Typography variant="body2" fontWeight={500} color="primary.main" mb={1}>
                  💡 Suggestion
                </Typography>
                <Typography variant="body2" color="text.primary">
                  Consider rebalancing your tech allocation - it's currently 35% vs recommended 28%.
                </Typography>
              </GlassCard>
              
              <Link href="/chat" style={{ textDecoration: 'none' }}>
                <GradientButton
                  fullWidth
                  startIcon={<MessageSquareIcon />}
                  sx={{ py: 1.5 }}
                >
                  Start Conversation
                </GradientButton>
              </Link>
            </GlassCard>

            {/* Market Highlights */}
            <GlassCard sx={{ p: 4, mb: 4 }}>
              <Typography variant="h6" fontWeight={600} color="text.primary" mb={3}>
                Market Highlights
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                {[
                  { name: 'S&P 500', value: '4,185.02', change: '+0.8%', positive: true },
                  { name: 'NASDAQ', value: '12,888.85', change: '+1.2%', positive: true },
                  { name: 'DOW', value: '33,745.40', change: '-0.3%', positive: false },
                ].map((market, index) => (
                  <Box key={index} display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="body1" color="text.secondary">
                      {market.name}
                    </Typography>
                    <Box textAlign="right">
                      <Typography variant="body1" fontWeight={500} color="text.primary">
                        {market.value}
                      </Typography>
                      <Typography 
                        variant="body2" 
                        color={market.positive ? 'success.main' : 'error.main'}
                        fontWeight={500}
                      >
                        {market.change}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </GlassCard>

            {/* Notifications */}
            <GlassCard sx={{ p: 4 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h6" fontWeight={600} color="text.primary">
                  Notifications
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <BellIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  {notifications > 0 && (
                    <Chip
                      label={notifications}
                      size="small"
                      color="error"
                      sx={{ minWidth: 20, height: 20, fontSize: 10 }}
                    />
                  )}
                </Box>
              </Box>
              
              <Box display="flex" flexDirection="column" gap={2}>
                <Box sx={{ p: 2, bgcolor: 'warning.main', color: 'warning.contrastText', borderRadius: 2, borderLeft: '4px solid', borderLeftColor: 'warning.dark' }}>
                  <Typography variant="body2" fontWeight={500} mb={0.5}>
                    Price Alert
                  </Typography>
                  <Typography variant="caption">
                    TSLA hit your stop loss at $220
                  </Typography>
                </Box>
                
                <Box sx={{ p: 2, bgcolor: 'success.main', color: 'success.contrastText', borderRadius: 2, borderLeft: '4px solid', borderLeftColor: 'success.dark' }}>
                  <Typography variant="body2" fontWeight={500} mb={0.5}>
                    Portfolio Milestone
                  </Typography>
                  <Typography variant="caption">
                    Reached $125K total value!
                  </Typography>
                </Box>
              </Box>
            </GlassCard>
          </Grid>
        </Grid>
    </Box>
  );
}
