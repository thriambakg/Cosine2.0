/**
 * API Client with Authentication
 * Automatically includes API key in all requests
 */

import { useApiAuth } from '../contexts/ApiAuthContext';

interface ApiRequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
  statusCode: number;
}

export const useApiClient = () => {
  const { apiKey, isApiKeyValid } = useApiAuth();

  const apiRequest = async <T,>(
    endpoint: string,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> => {
    if (!isApiKeyValid()) {
      return {
        error: 'API key not configured',
        statusCode: 401
      };
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey!,
        ...options.headers
      };

      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          error: data.error || 'Request failed',
          statusCode: response.status
        };
      }

      return {
        data,
        statusCode: response.status
      };
    } catch (error) {
      console.error('API request error:', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 0
      };
    }
  };

  const get = async <T,>(endpoint: string) => {
    return apiRequest<T>(endpoint, { method: 'GET' });
  };

  const post = async <T,>(endpoint: string, body: any) => {
    return apiRequest<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  };

  const put = async <T,>(endpoint: string, body: any) => {
    return apiRequest<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  };

  const del = async <T,>(endpoint: string) => {
    return apiRequest<T>(endpoint, { method: 'DELETE' });
  };

  return {
    apiRequest,
    get,
    post,
    put,
    delete: del,
    isAuthenticated: isApiKeyValid()
  };
};
