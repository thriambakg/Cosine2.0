// Staging Environment Configuration
// This file contains staging-specific configuration

export const STAGING_CONFIG = {
  environment: 'staging' as const,
  apiGatewayUrl: 'https://your-actual-staging-api-gateway-id.execute-api.us-east-1.amazonaws.com/staging',
  websocketUrl: 'wss://your-actual-staging-websocket-api-id.execute-api.us-east-1.amazonaws.com/staging',
  awsRegion: 'us-east-1',
  projectName: 'cosine-staging',
  
  // Add your actual staging API Gateway URL here
  // You can get this from Terraform outputs or AWS Console
  // Example: 'https://abc123def.execute-api.us-east-1.amazonaws.com/staging'
  // WebSocket URL example: 'wss://def456ghi.execute-api.us-east-1.amazonaws.com/staging'
};

export default STAGING_CONFIG;
