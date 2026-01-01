import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';
import { Provider } from 'react-redux';
import { store } from './store/store';

// Import components from organized structure
import { LandingPageMUI, AppLayout, LoadingPage } from './components';
import ChatPage from './pages/ChatPage';
import FilesPage from './pages/FilesPage';
import UnifiedDashboardPage from './pages/UnifiedDashboardPage';
import Robinhood from './pages/Robinhood';
import PortfolioRisk from './pages/PortfolioRisk';
import StockVolatilityPage from './pages/StockVolatilityPage';
import StockAlertsPage from './pages/StockAlertsPage';
import OptionPricingPage from './pages/OptionPricingPage';
import HeatmapPage from './pages/HeatmapPage';
import SECSearchPage from './pages/SECSearchPage';
import PoliticianTradesSearchPage from './pages/PoliticianTradesSearchPage';
import NewsSearchPage from './pages/NewsSearchPage';
import GovtContractsSearchPage from './pages/GovtContractsSearchPage';
import CongressBillsSearchPage from './pages/CongressBillsSearchPage';
import LDASearchPage from './pages/LDASearchPage';
import StockScreenerSearchPage from './pages/StockScreenerSearchPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import SupportMePage from './pages/SupportMePage';
import { ConfirmDialog } from './components/tiles/common';
import { DialogManagerProvider } from './contexts/DialogManagerContext';

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
      
      {/* Protected Routes with persistent AppLayout */}
      <Route path="/*" element={
        user ? (
          <AppLayout>
            <Routes>
              <Route path="/" element={<UnifiedDashboardPage />} />
              <Route path="/chat" element={
                <ProtectedRoute>
                  <ChatPage />
                </ProtectedRoute>
              } />
              <Route path="/files" element={
                <ProtectedRoute>
                  <FilesPage />
                </ProtectedRoute>
              } />
              <Route path="/robinhood" element={
                <ProtectedRoute>
                  <Robinhood />
                </ProtectedRoute>
              } />
              <Route path="/portfolio-risk" element={
                <ProtectedRoute>
                  <PortfolioRisk />
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
              <Route path="/sec-search" element={
                <ProtectedRoute>
                  <SECSearchPage />
                </ProtectedRoute>
              } />
              <Route path="/politician-trades-search" element={
                <ProtectedRoute>
                  <PoliticianTradesSearchPage />
                </ProtectedRoute>
              } />
              <Route path="/news-search" element={
                <ProtectedRoute>
                  <NewsSearchPage />
                </ProtectedRoute>
              } />
              <Route path="/govt-contracts-search" element={
                <ProtectedRoute>
                  <GovtContractsSearchPage />
                </ProtectedRoute>
              } />
              <Route path="/congress-bills-search" element={
                <ProtectedRoute>
                  <CongressBillsSearchPage />
                </ProtectedRoute>
              } />
              <Route path="/lda-search" element={
                <ProtectedRoute>
                  <LDASearchPage />
                </ProtectedRoute>
              } />
              <Route path="/stock-screener-search" element={
                <ProtectedRoute>
                  <StockScreenerSearchPage />
                </ProtectedRoute>
              } />
              <Route path="/support" element={
                <ProtectedRoute>
                  <SupportMePage />
                </ProtectedRoute>
              } />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppLayout>
        ) : <LandingPageMUI />
      } />
    </Routes>
  );
}

// Root App Component with Providers
function App() {
  return (
    <Provider store={store}>
      <AuthProvider>
        <DialogManagerProvider>
          <AppContent />
          <ConfirmDialog />
        </DialogManagerProvider>
      </AuthProvider>
    </Provider>
  );
}

export default App;
