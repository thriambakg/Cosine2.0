import React, { createContext, useContext } from 'react';

interface DemoDashboardContextValue {
  isDemo: boolean;
}

const DemoDashboardContext = createContext<DemoDashboardContextValue>({ isDemo: false });

export function DemoDashboardProvider({
  children,
  isDemo = true,
}: {
  children: React.ReactNode;
  isDemo?: boolean;
}) {
  return (
    <DemoDashboardContext.Provider value={{ isDemo }}>
      {children}
    </DemoDashboardContext.Provider>
  );
}

export function useDemoDashboard(): DemoDashboardContextValue {
  return useContext(DemoDashboardContext);
}
