// Development Environment Configuration
// This file contains development-specific configuration

export const DEVELOPMENT_CONFIG = {
  environment: 'development' as const,
  apiGatewayUrl: 'https://your-actual-development-api-gateway-id.execute-api.us-east-1.amazonaws.com/development',
  websocketUrl: 'wss://your-actual-development-websocket-api-id.execute-api.us-east-1.amazonaws.com/development',
  secSearchWebSocketUrl: undefined, // Will be set from Terraform outputs or environment variable
  awsRegion: 'us-east-1',
  projectName: 'cosine-development',
  
  // Add your actual development API Gateway URL here
  // You can get this from Terraform outputs or AWS Console
  // Example: 'https://ghi789jkl.execute-api.us-east-1.amazonaws.com/development'
  // WebSocket URL example: 'wss://jkl012mno.execute-api.us-east-1.amazonaws.com/development'
  // SEC Search WebSocket URL: Get from terraform output sec_search_websocket_api
};

export default DEVELOPMENT_CONFIG;
