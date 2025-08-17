// Configuration Loader
// This utility loads environment-specific configuration dynamically

import { ENV_CONFIG, logEnvironmentConfig } from './environment';

export interface ConfigLoaderOptions {
  environment?: string;
  configPath?: string;
  overrideApiUrl?: string;
}

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: any = {};
  private loaded = false;

  private constructor() {}

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  // Load configuration from environment variables and files
  async loadConfig(options: ConfigLoaderOptions = {}): Promise<void> {
    if (this.loaded) {
      return;
    }

    console.log('🔄 Loading configuration...');

    // Load environment-specific configuration
    const environment = options.environment || ENV_CONFIG.environment;
    
    // Override API URL if provided
    if (options.overrideApiUrl) {
      this.config.apiGatewayUrl = options.overrideApiUrl;
      console.log(`🔧 Overriding API Gateway URL to: ${options.overrideApiUrl}`);
    } else {
      this.config.apiGatewayUrl = ENV_CONFIG.apiGatewayUrl;
    }

    this.config.environment = environment;
    this.config.awsRegion = ENV_CONFIG.awsRegion;
    this.config.projectName = ENV_CONFIG.projectName;
    this.config.cognitoUserPoolId = ENV_CONFIG.cognitoUserPoolId;
    this.config.cognitoClientId = ENV_CONFIG.cognitoClientId;
    this.config.cognitoDomain = ENV_CONFIG.cognitoDomain;

    this.loaded = true;
    
    console.log('✅ Configuration loaded successfully');
    logEnvironmentConfig();
  }

  // Get configuration value
  get(key: string): any {
    return this.config[key];
  }

  // Get all configuration
  getAll(): any {
    return { ...this.config };
  }

  // Update configuration dynamically
  update(key: string, value: any): void {
    this.config[key] = value;
    console.log(`🔧 Updated config: ${key} = ${value}`);
  }

  // Reload configuration
  async reload(): Promise<void> {
    this.loaded = false;
    this.config = {};
    await this.loadConfig();
  }

  // Validate configuration
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!this.config.apiGatewayUrl) {
      errors.push('API Gateway URL is not configured');
    }
    
    if (this.config.apiGatewayUrl && this.config.apiGatewayUrl.includes('your-')) {
      errors.push('API Gateway URL contains placeholder values');
    }
    
    if (!this.config.environment) {
      errors.push('Environment is not configured');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Export configuration for debugging
  export(): string {
    return JSON.stringify(this.config, null, 2);
  }
}

// Convenience functions
export const loadConfig = async (options?: ConfigLoaderOptions): Promise<void> => {
  return ConfigLoader.getInstance().loadConfig(options);
};

export const getConfig = (key: string): any => {
  return ConfigLoader.getInstance().get(key);
};

export const getAllConfig = (): any => {
  return ConfigLoader.getInstance().getAll();
};

export const updateConfig = (key: string, value: any): void => {
  ConfigLoader.getInstance().update(key, value);
};

export const validateConfig = (): { isValid: boolean; errors: string[] } => {
  return ConfigLoader.getInstance().validate();
};

export default ConfigLoader;
