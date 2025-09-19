import React from 'react';
import { useUserDashboardStatus } from '../hooks/useUserDashboardStatus';
import WelcomePage from '../pages/WelcomePage';
import UnifiedDashboardPage from '../pages/UnifiedDashboardPage';
import LoadingPage from './LoadingPage';

/**
 * Component that routes users to either the welcome page or dashboard
 * based on whether they have any existing dashboard content
 */
const DashboardRouter: React.FC = () => {
  const { isEmpty, isLoading } = useUserDashboardStatus();

  // Show loading while determining user status
  if (isLoading) {
    return <LoadingPage />;
  }

  // Show welcome page if user has no dashboard content
  if (isEmpty) {
    return <WelcomePage />;
  }

  // Show dashboard if user has existing content
  return <UnifiedDashboardPage />;
};

export default DashboardRouter;
