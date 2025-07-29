"use client";

import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';

export default function AuthTestComponent() {
  const { user, isLoading, isAuthenticated, login, logout, loginWithProvider } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('Attempting login...');
    
    try {
      const result = await login(email, password);
      if (result.success) {
        setMessage('Login successful!');
      } else {
        setMessage(`Login failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      setMessage(`Login error: ${error.message}`);
    }
  };

  const handleProviderLogin = async (provider: 'Google' | 'Microsoft') => {
    setMessage(`Attempting ${provider} login...`);
    
    try {
      await loginWithProvider(provider);
      setMessage(`${provider} login initiated`);
    } catch (error: any) {
      setMessage(`${provider} login error: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setMessage('Logged out successfully');
    } catch (error: any) {
      setMessage(`Logout error: ${error.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4 text-center">Authentication Test</h2>
      
      {/* Authentication Status */}
      <div className="mb-4 p-3 rounded-md bg-gray-100">
        <p><strong>Status:</strong> {isAuthenticated ? 'Authenticated' : 'Not authenticated'}</p>
        {user && (
          <div className="mt-2">
            <p><strong>User:</strong> {user.email}</p>
            <p><strong>Name:</strong> {user.firstName} {user.lastName}</p>
            <p><strong>Role:</strong> {user.role}</p>
          </div>
        )}
      </div>

      {/* Message Display */}
      {message && (
        <div className="mb-4 p-3 rounded-md bg-blue-50 border border-blue-200">
          <p className="text-blue-800">{message}</p>
        </div>
      )}

      {!isAuthenticated ? (
        <div className="space-y-4">
          {/* Email/Password Login */}
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="test@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="password"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Login with Email
            </button>
          </form>

          {/* Provider Login Buttons */}
          <div className="space-y-2">
            <button
              onClick={() => handleProviderLogin('Google')}
              className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Login with Google
            </button>
            <button
              onClick={() => handleProviderLogin('Microsoft')}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Login with Microsoft
            </button>
          </div>

          <div className="text-sm text-gray-600 text-center">
            Note: This is a test component. Federated authentication requires proper Cognito configuration.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={handleLogout}
            className="w-full bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
