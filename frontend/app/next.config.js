const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for S3/CloudFront deployment
  output: 'export',
  
  // Add trailing slash for better S3 compatibility
  trailingSlash: true,

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

  // Ensure all routes are treated as static pages for export
  exportPathMap: async function() {
    return {
      '/': { page: '/' },
      '/login': { page: '/login' },
      '/chat': { page: '/chat' },
      '/crypto-stats': { page: '/crypto-stats' },
      '/heatmap': { page: '/heatmap' },
      '/option-pricing': { page: '/option-pricing' },
      '/portfolio-risk': { page: '/portfolio-risk' },
      '/robinhood': { page: '/robinhood' },
      '/stock-alerts': { page: '/stock-alerts' },
      '/stock-volatility': { page: '/stock-volatility' },
      '/auth/callback': { page: '/auth/callback' }
    };
  }
}

module.exports = nextConfig