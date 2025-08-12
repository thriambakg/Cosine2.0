"use client";

import { useAuth } from '@/contexts/AuthContext';

export default function AuthStatusBanner() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <div className="flex items-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600 mr-3"></div>
          <span className="text-yellow-800">Loading authentication...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-blue-800 font-medium">Authentication Test Mode</h3>
            <p className="text-blue-600 text-sm">You are currently in demo mode. Authentication features are ready for testing.</p>
          </div>
          <div className="flex space-x-2">
            <a 
              href="/login" 
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              Test Login
            </a>
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs">Demo Mode</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-green-800 font-medium">✅ Authenticated as {user?.firstName} {user?.lastName}</h3>
          <p className="text-green-600 text-sm">Email: {user?.email} | Role: {user?.role}</p>
        </div>
        <div className="flex space-x-2">
          <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs">Authenticated</span>
          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs">{user?.subscription?.plan || 'free'}</span>
        </div>
      </div>
    </div>
  );
}
