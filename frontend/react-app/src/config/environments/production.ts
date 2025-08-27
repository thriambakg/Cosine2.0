// Production Environment Configuration
// This file contains production-specific configuration

export const PRODUCTION_CONFIG = {
  environment: 'production' as const,
  apiGatewayUrl: 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production',
  websocketUrl: 'wss://xem3y35uzd.execute-api.us-east-1.amazonaws.com/production',
  awsRegion: 'us-east-1',
  projectName: 'cosine-production',
  
  // Add your actual production API Gateway URL here
  // You can get this from Terraform outputs or AWS Console
  // Example: 'https://xyz789abc.execute-api.us-east-1.amazonaws.com/production'
  // WebSocket URL example: 'wss://abc123def.execute-api.us-east-1.amazonaws.com/production'
};

export default PRODUCTION_CONFIG;
