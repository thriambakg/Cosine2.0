import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface DualScreenModeContextType {
  isDualScreenMode: boolean;
  toggleDualScreenMode: () => void;
  setDualScreenMode: (enabled: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
}

const DualScreenModeContext = createContext<DualScreenModeContextType | undefined>(undefined);

export const useDualScreenMode = () => {
  const context = useContext(DualScreenModeContext);
  if (!context) {
    throw new Error('useDualScreenMode must be used within a DualScreenModeProvider');
  }
  return context;
};

interface DualScreenModeProviderProps {
  children: React.ReactNode;
}

export const DualScreenModeProvider: React.FC<DualScreenModeProviderProps> = ({ children }) => {
  const [isDualScreenMode, setIsDualScreenMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('dual-screen-mode');
    return saved ? JSON.parse(saved) : false;
  });

  const [sidebarWidth, setSidebarWidthState] = useState<number>(() => {
    const saved = localStorage.getItem('dual-screen-sidebar-width');
    if (saved) {
      return JSON.parse(saved);
    }
    // Default to half screen width, but ensure it's within bounds
    const defaultWidth = window.innerWidth / 2;
    const minWidth = 300;
    const maxWidth = window.innerWidth * 0.7;
    return Math.max(minWidth, Math.min(maxWidth, defaultWidth));
  });

  // Save to localStorage when mode changes
  useEffect(() => {
    localStorage.setItem('dual-screen-mode', JSON.stringify(isDualScreenMode));
  }, [isDualScreenMode]);

  // Save to localStorage when width changes
  useEffect(() => {
    if (isDualScreenMode) {
      localStorage.setItem('dual-screen-sidebar-width', JSON.stringify(sidebarWidth));
    }
  }, [sidebarWidth, isDualScreenMode]);

  const toggleDualScreenMode = useCallback(() => {
    setIsDualScreenMode(prev => !prev);
  }, []);

  const setDualScreenMode = useCallback((enabled: boolean) => {
    setIsDualScreenMode(enabled);
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    // Clamp width between 300px and 70% of screen width
    const minWidth = 300;
    const maxWidth = window.innerWidth * 0.7;
    const clampedWidth = Math.max(minWidth, Math.min(maxWidth, width));
    setSidebarWidthState(clampedWidth);
  }, []);

  return (
    <DualScreenModeContext.Provider
      value={{
        isDualScreenMode,
        toggleDualScreenMode,
        setDualScreenMode,
        sidebarWidth,
        setSidebarWidth,
      }}
    >
      {children}
    </DualScreenModeContext.Provider>
  );
};

