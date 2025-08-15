const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for S3/CloudFront deployment
  output: 'export',
  
  // Remove trailing slash - can cause routing issues with CloudFront
  trailingSlash: false,

  // Disable static optimization that can cause routing issues
  distDir: 'out',

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

  // Disable server-side features that don't work with static export
  experimental: {
    // Disable features that require server-side rendering
    serverComponentsExternalPackages: [],
  },

  // Webpack configuration for external dependencies
  webpack: (config, { isServer }) => {
    // Handle plotly.js imports for react-plotly.js
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'plotly.js/dist/plotly': 'plotly.js-dist',
        'plotly.js': 'plotly.js-dist',
        // Fix path resolution for src directory structure
        '@/lib': path.resolve(__dirname, './src/lib'),
        '@/components': path.resolve(__dirname, './src/components'),
        '@/contexts': path.resolve(__dirname, './src/contexts'),
      };
    }
    return config;
  }
}

module.exports = nextConfig