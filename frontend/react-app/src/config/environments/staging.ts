// Staging Environment Configuration
// This file contains staging-specific configuration

export const STAGING_CONFIG = {
  environment: 'staging' as const,
  // Use production API Gateway for now since staging doesn't exist yet
  apiGatewayUrl: 'https://34pfnubl80.execute-api.us-east-1.amazonaws.com/production',
  awsRegion: 'us-east-1',
  projectName: 'cosine-staging',
  
  // TODO: Add your actual staging API Gateway URL here when staging environment is created
  // You can get this from Terraform outputs or AWS Console
  // Example: 'https://abc123def.execute-api.us-east-1.amazonaws.com/staging'
};

export default STAGING_CONFIG;
