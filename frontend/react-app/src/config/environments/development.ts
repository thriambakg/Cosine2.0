// Development Environment Configuration
// This file contains development-specific configuration

export const DEVELOPMENT_CONFIG = {
  environment: 'development' as const,
  // Use production API Gateway for development testing
  apiGatewayUrl: 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production',
  awsRegion: 'us-east-1',
  projectName: 'cosine-dev',
  
  // For local development, you can:
  // 1. Use production API Gateway (current setup)
  // 2. Run a local API server on localhost:3001
  // 3. Use staging API Gateway for testing
};

export default DEVELOPMENT_CONFIG;
