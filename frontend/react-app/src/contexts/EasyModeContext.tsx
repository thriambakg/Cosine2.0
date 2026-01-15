import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface EasyModeContextType {
  isEasyMode: boolean;
  toggleEasyMode: () => void;
  setEasyMode: (enabled: boolean) => void;
}

const EasyModeContext = createContext<EasyModeContextType | undefined>(undefined);

export const useEasyMode = () => {
  const context = useContext(EasyModeContext);
  if (!context) {
    throw new Error('useEasyMode must be used within an EasyModeProvider');
  }
  return context;
};

interface EasyModeProviderProps {
  children: ReactNode;
}

export const EasyModeProvider: React.FC<EasyModeProviderProps> = ({ children }) => {
  // Load from localStorage, default to false (normal mode)
  const [isEasyMode, setIsEasyMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('easyMode');
    return saved === 'true';
  });

  useEffect(() => {
    // Save to localStorage whenever mode changes
    localStorage.setItem('easyMode', String(isEasyMode));
  }, [isEasyMode]);

  const toggleEasyMode = () => {
    setIsEasyMode(prev => !prev);
  };

  const setEasyMode = (enabled: boolean) => {
    setIsEasyMode(enabled);
  };

  return (
    <EasyModeContext.Provider value={{ isEasyMode, toggleEasyMode, setEasyMode }}>
      {children}
    </EasyModeContext.Provider>
  );
};








