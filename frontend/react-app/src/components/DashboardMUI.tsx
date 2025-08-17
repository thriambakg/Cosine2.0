import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Chip,
  Card,
  CardContent,
  Button,
} from '@mui/material';
import {
  SmartToy as BotIcon,
  TrendingUp,
  BarChart as BarChart3Icon,
  PieChart,
  Timeline as ActivityIcon,
  Chat as MessageSquareIcon,
  Upload,
  Settings,
  Notifications as BellIcon,
  AttachMoney as DollarSignIcon,
  Percent,
  Flag as TargetIcon,
  ArrowForward as ArrowRightIcon,
} from '@mui/icons-material';

import { useAuth } from '@/contexts/AuthContext';

// Custom styled components for Wall Street chic
const GlassCard = ({ children, sx = {}, ...props }: any) => (
  <Card
    sx={{
      background: 'rgba(15, 23, 42, 0.95)',
      border: '2px solid #374151',
      borderRadius: '0px',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      ...sx
    }}
    {...props}
  >
    <CardContent sx={{ p: 0 }}>
      {children}
    </CardContent>
  </Card>
);

const MetricCard = ({ title, subtitle, value, icon: Icon, color = 'primary', trend, trendValue }: any) => (
  <Box
    sx={{
      p: 3,
      background: 'rgba(15, 23, 42, 0.8)',
      border: '1px solid #374151',
      borderRadius: '0px',
      position: 'relative',
      overflow: 'hidden',
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        background: color === 'success' ? '#22c55e' : color === 'warning' ? '#dc2626' : '#3b82f6',
      }
    }}
  >
    <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: '0px',
          background: color === 'success' 
            ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
            : color === 'warning'
            ? 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)'
            : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon sx={{ color: 'white', fontSize: 24 }} />
      </Box>
      <Box textAlign="right">
        <Typography variant="h4" fontWeight={700} color="white" sx={{ textTransform: 'uppercase' }}>
          {value}
        </Typography>
        <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase', fontSize: '0.75rem' }}>
          {title}
        </Typography>
      </Box>
    </Box>
    <Typography variant="body2" color="#e2e8f0" mb={1}>
      {subtitle}
    </Typography>
    <Box display="flex" alignItems="center" gap={1}>
      <Typography 
        variant="body2" 
        color={trend === 'up' ? '#22c55e' : trend === 'down' ? '#dc2626' : '#9ca3af'}
        fontWeight={600}
        sx={{ textTransform: 'uppercase' }}
      >
        {trendValue}
      </Typography>
    </Box>
  </Box>
);

const GradientButton = ({ children, sx = {}, ...props }: any) => (
  <Button
    sx={{
      background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
      color: 'white',
      borderRadius: '0px',
      textTransform: 'uppercase',
      fontWeight: 700,
      border: '2px solid #22c55e',
      '&:hover': {
        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
        border: '2px solid #16a34a',
        transform: 'translateY(-1px)',
        boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
      },
      ...sx
    }}
    {...props}
  >
    {children}
  </Button>
);

export default function DashboardMUI() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications] = useState(3);

  return (
    <Box sx={{ p: 3, background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh' }}>
      {/* Welcome Section */}
      <GlassCard sx={{ p: 4, mb: 4, background: 'rgba(15, 23, 42, 0.9)' }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h3" fontWeight={700} color="white" mb={1} sx={{ textTransform: 'uppercase' }}>
              Welcome back, {user?.firstName}! 👋
            </Typography>
            <Typography variant="h6" color="#22c55e" sx={{ textTransform: 'uppercase' }}>
              Ready to analyze the markets and optimize your portfolio?
            </Typography>
          </Box>
          <Box display={{ xs: 'none', md: 'flex' }} gap={4}>
            <Box textAlign="center">
              <Typography variant="h4" fontWeight={700} color="white" sx={{ textTransform: 'uppercase' }}>
                $124.5K
              </Typography>
              <Typography variant="body2" color="#22c55e" sx={{ textTransform: 'uppercase' }}>
                Portfolio Value
              </Typography>
            </Box>
            <Box textAlign="center">
              <Typography variant="h4" fontWeight={700} color="#22c55e" sx={{ textTransform: 'uppercase' }}>
                +12.4%
              </Typography>
              <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
                This Month
              </Typography>
            </Box>
          </Box>
        </Box>
      </GlassCard>

      {/* Quick Actions */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <GlassCard sx={{ p: 3, textAlign: 'center', cursor: 'pointer' }} onClick={() => navigate('/chat')}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '0px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <MessageSquareIcon sx={{ color: 'white', fontSize: 24 }} />
            </Box>
            <Typography variant="h6" fontWeight={600} color="white" mb={1} sx={{ textTransform: 'uppercase' }}>
              AI Chat
            </Typography>
            <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
              Ask anything
            </Typography>
          </GlassCard>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <GlassCard sx={{ p: 3, textAlign: 'center', cursor: 'pointer' }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '0px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <Upload sx={{ color: 'white', fontSize: 24 }} />
            </Box>
            <Typography variant="h6" fontWeight={600} color="white" mb={1} sx={{ textTransform: 'uppercase' }}>
              Upload Data
            </Typography>
            <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
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
                borderRadius: '0px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <BarChart3Icon sx={{ color: 'white', fontSize: 24 }} />
            </Box>
            <Typography variant="h6" fontWeight={600} color="white" mb={1} sx={{ textTransform: 'uppercase' }}>
              Portfolio
            </Typography>
            <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
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
                borderRadius: '0px',
                background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <Settings sx={{ color: 'white', fontSize: 24 }} />
            </Box>
            <Typography variant="h6" fontWeight={600} color="white" mb={1} sx={{ textTransform: 'uppercase' }}>
              Settings
            </Typography>
            <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
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
              <Typography variant="h5" fontWeight={600} color="white" sx={{ textTransform: 'uppercase' }}>
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
                  color="success"
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
                  color="primary"
                  trend="up"
                  trendValue="Excellent"
                />
              </Grid>
            </Grid>
          </GlassCard>

          {/* Recent Activity */}
          <GlassCard sx={{ p: 4 }}>
            <Typography variant="h5" fontWeight={600} color="white" mb={3} sx={{ textTransform: 'uppercase' }}>
              Recent Activity
            </Typography>
            <Box display="flex" flexDirection="column" gap={2}>
              {[
                { icon: BotIcon, title: 'AI Analysis Complete', desc: 'Portfolio rebalancing recommendations generated', time: '2 hours ago', color: '#22c55e' },
                { icon: TrendingUp, title: 'Market Alert', desc: 'AAPL reached your target price of $180', time: '4 hours ago', color: '#3b82f6' },
                { icon: PieChart, title: 'Portfolio Updated', desc: 'Added 50 shares of MSFT to your portfolio', time: '1 day ago', color: '#dc2626' },
              ].map((activity, index) => (
                <Box key={index} display="flex" alignItems="center" gap={2} p={2} sx={{ 
                  bgcolor: activity.color === '#22c55e' ? 'rgba(34, 197, 94, 0.1)' : 
                          activity.color === '#3b82f6' ? 'rgba(59, 130, 246, 0.1)' : 
                          'rgba(220, 38, 38, 0.1)', 
                  borderRadius: '0px', 
                  border: `1px solid ${activity.color}` 
                }}>
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '0px',
                      bgcolor: activity.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <activity.icon sx={{ color: 'white', fontSize: 20 }} />
                  </Box>
                  <Box flex={1}>
                    <Typography variant="body1" fontWeight={500} color="white" sx={{ textTransform: 'uppercase' }}>
                      {activity.title}
                    </Typography>
                    <Typography variant="body2" color="#9ca3af">
                      {activity.desc}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
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
                  borderRadius: '0px',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <BotIcon sx={{ color: 'white', fontSize: 20 }} />
              </Box>
              <Box>
                <Typography variant="h6" fontWeight={600} color="white" sx={{ textTransform: 'uppercase' }}>
                  AI Assistant
                </Typography>
                <Typography variant="body2" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
                  Ready to help
                </Typography>
              </Box>
            </Box>
            
            <Box sx={{ p: 2, mb: 3, bgcolor: 'rgba(59, 130, 246, 0.1)', border: '1px solid #3b82f6', borderRadius: '0px' }}>
              <Typography variant="body2" fontWeight={500} color="#3b82f6" mb={1} sx={{ textTransform: 'uppercase' }}>
                💡 Suggestion
              </Typography>
              <Typography variant="body2" color="white">
                Consider rebalancing your tech allocation - it's currently 35% vs recommended 28%.
              </Typography>
            </Box>
            
            <GradientButton
              fullWidth
              startIcon={<MessageSquareIcon />}
              sx={{ py: 1.5 }}
              onClick={() => navigate('/chat')}
            >
              Start Conversation
            </GradientButton>
          </GlassCard>

          {/* Market Highlights */}
          <GlassCard sx={{ p: 4, mb: 4 }}>
            <Typography variant="h6" fontWeight={600} color="white" mb={3} sx={{ textTransform: 'uppercase' }}>
              Market Highlights
            </Typography>
            <Box display="flex" flexDirection="column" gap={2}>
              {[
                { name: 'S&P 500', value: '4,185.02', change: '+0.8%', positive: true },
                { name: 'NASDAQ', value: '12,888.85', change: '+1.2%', positive: true },
                { name: 'DOW', value: '33,745.40', change: '+0.3%', positive: true },
              ].map((market, index) => (
                <Box key={index} display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body1" color="#9ca3af" sx={{ textTransform: 'uppercase' }}>
                    {market.name}
                  </Typography>
                  <Box textAlign="right">
                    <Typography variant="body1" fontWeight={500} color="white">
                      {market.value}
                    </Typography>
                    <Typography 
                      variant="body2" 
                      color="#22c55e"
                      fontWeight={500}
                      sx={{ textTransform: 'uppercase' }}
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
              <Typography variant="h6" fontWeight={600} color="white" sx={{ textTransform: 'uppercase' }}>
                Notifications
              </Typography>
              <Box display="flex" alignItems="center" gap={1}>
                <BellIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
                {notifications > 0 && (
                  <Chip
                    label={notifications}
                    size="small"
                    sx={{ 
                      minWidth: 20, 
                      height: 20, 
                      fontSize: 10, 
                      bgcolor: '#22c55e', 
                      color: 'white',
                      borderRadius: '0px'
                    }}
                  />
                )}
              </Box>
            </Box>
            
                          <Box display="flex" flexDirection="column" gap={2}>
                <Box sx={{ p: 2, bgcolor: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', borderRadius: '0px', border: '1px solid #22c55e', borderLeft: '4px solid #22c55e' }}>
                  <Typography variant="body2" fontWeight={500} mb={0.5} sx={{ textTransform: 'uppercase' }}>
                    Price Alert
                  </Typography>
                  <Typography variant="caption" sx={{ textTransform: 'uppercase' }}>
                    TSLA hit your target at $220
                  </Typography>
                </Box>
                
                <Box sx={{ p: 2, bgcolor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626', borderRadius: '0px', border: '1px solid #dc2626', borderLeft: '4px solid #dc2626' }}>
                  <Typography variant="body2" fontWeight={500} mb={0.5} sx={{ textTransform: 'uppercase' }}>
                    Portfolio Milestone
                  </Typography>
                  <Typography variant="caption" sx={{ textTransform: 'uppercase' }}>
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
