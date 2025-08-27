// Global type definitions for runtime configuration

interface CosineConfig {
  apiGatewayUrl: string;
  websocketUrl?: string;
  awsRegion: string;
  environment: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  cognitoDomain?: string;
  redirectSignIn?: string;
  redirectSignOut?: string;
  buildTimestamp?: string;
  version?: string;
  commitSha?: string;
}

declare global {
  interface Window {
    COSINE_CONFIG: CosineConfig;
    getConfig: (key: string, defaultValue?: any) => any;
    isConfigLoaded: () => boolean;
  }
}

export {};
