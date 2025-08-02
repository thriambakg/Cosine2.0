const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker containerization
  output: 'standalone',
  
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },

  // Environment variables available to the client
  env: {
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    NEXT_PUBLIC_COGNITO_DOMAIN: process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
    NEXT_PUBLIC_API_GATEWAY_URL: process.env.NEXT_PUBLIC_API_GATEWAY_URL,
  },

  // Image optimization for containers
  images: {
    unoptimized: true,
  },

  // Skip linting during build (for faster builds)
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Skip TypeScript type checking during build (optional - faster builds)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Webpack configuration for external dependencies
  webpack: (config, { isServer }) => {
    // Handle plotly.js imports for react-plotly.js
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'plotly.js/dist/plotly': 'plotly.js-dist',
        'plotly.js': 'plotly.js-dist',
        // Fix path resolution for lib directory
        '@/lib': path.resolve(__dirname, './lib'),
        '@/components': path.resolve(__dirname, './components'),
        '@/contexts': path.resolve(__dirname, './contexts'),
      };
    }
    return config;
  },
}

module.exports = nextConfig
