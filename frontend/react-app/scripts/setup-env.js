#!/usr/bin/env node

/**
 * Environment Setup Script
 * This script helps set up environment variables for different environments
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENV_TEMPLATE = `# Environment Configuration
# Copy this file to .env.local and update with your actual values

# Environment (development, staging, production)
VITE_ENVIRONMENT=staging

# API Gateway URL (get this from Terraform outputs)
VITE_API_GATEWAY_URL=https://your-actual-api-gateway-id.execute-api.us-east-1.amazonaws.com/staging

# AWS Configuration
VITE_AWS_REGION=us-east-1

# Cognito Configuration (if using authentication)
VITE_COGNITO_USER_POOL_ID=your-user-pool-id
VITE_COGNITO_CLIENT_ID=your-client-id
VITE_COGNITO_DOMAIN=your-domain.auth.us-east-1.amazoncognito.com
`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_LOCAL_PATH = path.join(__dirname, '..', '.env.local');

function createEnvFile() {
  console.log('🔧 Setting up environment configuration...');
  
  if (fs.existsSync(ENV_LOCAL_PATH)) {
    console.log('⚠️  .env.local already exists. Backing up to .env.local.backup');
    fs.copyFileSync(ENV_LOCAL_PATH, ENV_LOCAL_PATH + '.backup');
  }
  
  fs.writeFileSync(ENV_LOCAL_PATH, ENV_TEMPLATE);
  console.log('✅ Created .env.local template');
  console.log('📝 Please edit .env.local with your actual API Gateway URL');
  console.log('');
  console.log('To get your API Gateway URL, run:');
  console.log('  cd ../../terraform');
  console.log('  terraform output api_gateway');
  console.log('');
  console.log('Then update VITE_API_GATEWAY_URL in .env.local');
}

function showHelp() {
  console.log('Environment Setup Script');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/setup-env.js');
  console.log('');
  console.log('This will create a .env.local file with template values.');
  console.log('You need to update the API Gateway URL with your actual deployed URL.');
}

// Main execution
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
} else {
  createEnvFile();
}
