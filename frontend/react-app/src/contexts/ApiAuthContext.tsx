/**
 * API Authentication Context
 * Manages API key storage and validation for authenticated requests
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ApiAuthContextType {
  apiKey: string | null;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  isApiKeyValid: () => boolean;
  saveApiKeyToStorage: (key: string) => void;
  loadApiKeyFromStorage: () => string | null;
}

const ApiAuthContext = createContext<ApiAuthContextType | undefined>(undefined);

const API_KEY_STORAGE_KEY = 'cosine_api_key';

export const ApiAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [apiKey, setApiKeyState] = useState<string | null>(null);

  const setApiKey = useCallback((key: string) => {
    // Validate format
    if (!key.startsWith('sk_') || key.length < 60) {
      console.error('Invalid API key format');
      return;
    }
    setApiKeyState(key);
  }, []);

  const clearApiKey = useCallback(() => {
    setApiKeyState(null);
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }, []);

  const isApiKeyValid = useCallback(() => {
    if (!apiKey) return false;
    return apiKey.startsWith('sk_') && apiKey.length > 60;
  }, [apiKey]);

  const saveApiKeyToStorage = useCallback((key: string) => {
    if (key.startsWith('sk_')) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
      setApiKey(key);
    }
  }, [setApiKey]);

  const loadApiKeyFromStorage = useCallback(() => {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (stored && stored.startsWith('sk_')) {
      setApiKeyState(stored);
      return stored;
    }
    return null;
  }, []);

  const value: ApiAuthContextType = {
    apiKey,
    setApiKey,
    clearApiKey,
    isApiKeyValid,
    saveApiKeyToStorage,
    loadApiKeyFromStorage
  };

  return (
    <ApiAuthContext.Provider value={value}>
      {children}
    </ApiAuthContext.Provider>
  );
};

export const useApiAuth = () => {
  const context = useContext(ApiAuthContext);
  if (!context) {
    throw new Error('useApiAuth must be used within ApiAuthProvider');
  }
  return context;
};
