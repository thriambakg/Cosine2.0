import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';

// Import your existing components (we'll copy them over)
import LandingPageMUI from './components/LandingPageMUI';
import DashboardMUI from './components/DashboardMUI';
import ChatPage from './pages/ChatPage';
import RobinhoodPage from './pages/RobinhoodPage';
import PortfolioRiskPage from './pages/PortfolioRiskPage';
import StockVolatilityPage from './pages/StockVolatilityPage';
import StockAlertsPage from './pages/StockAlertsPage';
import CryptoStatsPage from './pages/CryptoStatsPage';
import OptionPricingPage from './pages/OptionPricingPage';
import HeatmapPage from './pages/HeatmapPage';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import LoadingPage from './components/LoadingPage';

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Main App Component
function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingPage />;
  }

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" replace />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      
      {/* Protected Routes */}
      <Route path="/" element={
        user ? <DashboardMUI /> : <LandingPageMUI />
      } />
      
      <Route path="/chat" element={
        <ProtectedRoute>
          <ChatPage />
        </ProtectedRoute>
      } />
      
      <Route path="/robinhood" element={
        <ProtectedRoute>
          <RobinhoodPage />
        </ProtectedRoute>
      } />
      
      <Route path="/portfolio-risk" element={
        <ProtectedRoute>
          <PortfolioRiskPage />
        </ProtectedRoute>
      } />
      
      <Route path="/stock-volatility" element={
        <ProtectedRoute>
          <StockVolatilityPage />
        </ProtectedRoute>
      } />
      
      <Route path="/stock-alerts" element={
        <ProtectedRoute>
          <StockAlertsPage />
        </ProtectedRoute>
      } />
      
      <Route path="/crypto-stats" element={
        <ProtectedRoute>
          <CryptoStatsPage />
        </ProtectedRoute>
      } />
      
      <Route path="/option-pricing" element={
        <ProtectedRoute>
          <OptionPricingPage />
        </ProtectedRoute>
      } />
      
      <Route path="/heatmap" element={
        <ProtectedRoute>
          <HeatmapPage />
        </ProtectedRoute>
      } />
      
      {/* Catch all route */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Root App Component with Providers
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
