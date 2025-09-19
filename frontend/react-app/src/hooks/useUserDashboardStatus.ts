import { useState, useEffect } from 'react';
import { useTabManagement } from './useTabManagement';
import { useAuth } from '../contexts/AuthContext';

interface UserDashboardStatus {
  hasDashboards: boolean;
  hasTabs: boolean;
  hasTiles: boolean;
  isLoading: boolean;
  isEmpty: boolean; // True if user has no content at all
}

/**
 * Hook to determine if a user has any dashboard content
 * Used to decide whether to show welcome page or dashboard
 */
export const useUserDashboardStatus = (): UserDashboardStatus => {
  const { user } = useAuth();
  const [status, setStatus] = useState<UserDashboardStatus>({
    hasDashboards: false,
    hasTabs: false,
    hasTiles: false,
    isLoading: true,
    isEmpty: true
  });

  // Use tab management to get current state
  const tabManagement = useTabManagement({ 
    userId: user?.id || undefined 
  });

  useEffect(() => {
    if (!user) {
      setStatus({
        hasDashboards: false,
        hasTabs: false,
        hasTiles: false,
        isLoading: false,
        isEmpty: true
      });
      return;
    }

    // Check if we have any content
    const hasTabs = (tabManagement.tabs?.length || 0) > 0;
    const hasTiles = tabManagement.tabs?.some(tab => (tab.tiles?.length || 0) > 0) || false;
    
    // For now, we'll consider tabs as dashboards since that's how the new system works
    const hasDashboards = hasTabs;
    const isEmpty = !hasDashboards && !hasTiles;

    setStatus({
      hasDashboards,
      hasTabs,
      hasTiles,
      isLoading: false,
      isEmpty
    });
  }, [user, tabManagement.tabs]);

  return status;
};
