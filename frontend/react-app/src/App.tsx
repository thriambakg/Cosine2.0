import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';
import { Provider } from 'react-redux';
import { store } from './store/store';

// Import your existing components (we'll copy them over)
import LandingPageMUI from './components/LandingPageMUI';
import AppLayout from './components/AppLayout';
import ChatPage from './pages/ChatPage';
import Robinhood from './pages/Robinhood';
import PortfolioRisk from './pages/PortfolioRisk';
import StockVolatilityPage from './pages/StockVolatilityPage';
import StockAlertsPage from './pages/StockAlertsPage';
import CryptoStatsPage from './pages/CryptoStatsPage';
import UnifiedDashboardPage from './pages/UnifiedDashboardPage';
import OptionPricingPage from './pages/OptionPricingPage';
import HeatmapPage from './pages/HeatmapPage';

import AuthCallbackPage from './pages/AuthCallbackPage';
import LoadingPage from './components/LoadingPage';

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!user) {
    return <Navigate to="/" replace />;
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
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      
      {/* Protected Routes */}
      <Route path="/" element={
        user ? (
          <AppLayout>
            <UnifiedDashboardPage />
          </AppLayout>
        ) : <LandingPageMUI />
      } />
      
      <Route path="/chat" element={
        <ProtectedRoute>
          <AppLayout>
            <ChatPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/robinhood" element={
        <ProtectedRoute>
          <AppLayout>
            <Robinhood />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/portfolio-risk" element={
        <ProtectedRoute>
          <AppLayout>
            <PortfolioRisk />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/stock-volatility" element={
        <ProtectedRoute>
          <AppLayout>
            <StockVolatilityPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/stock-alerts" element={
        <ProtectedRoute>
          <AppLayout>
            <StockAlertsPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/crypto-stats" element={
        <ProtectedRoute>
          <AppLayout>
            <CryptoStatsPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/option-pricing" element={
        <ProtectedRoute>
          <AppLayout>
            <OptionPricingPage />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/heatmap" element={
        <ProtectedRoute>
          <AppLayout>
            <HeatmapPage />
          </AppLayout>
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
    <Provider store={store}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Provider>
  );
}

export default App;
