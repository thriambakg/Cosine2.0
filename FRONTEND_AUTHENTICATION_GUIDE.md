# Frontend Authentication & Database Integration Guide

## 🎯 Overview

Your infrastructure now supports complete user authentication with AWS Cognito and user data storage with DynamoDB. This guide shows you how to implement the frontend integration.

## 🏗️ Infrastructure Setup

### ✅ What's Already Configured


**Authentication (AWS Cognito):**
- ✅ User Pool with username/email/password authentication
- ✅ Google OAuth integration (requires manual credential setup in console)
- ✅ Microsoft OAuth integration (requires manual credential setup in console)
- ✅ Hosted UI for sign-in/sign-up
- ✅ JWT token validation and refresh

**Database (DynamoDB):**
- ✅ User Profiles table with email GSI for lookups
- ✅ Security Events table for audit logging
- ✅ User Sessions table with TTL for session management
- ✅ Encryption at rest with customer-managed KMS keys

**Container Deployment (ECS):**
- ✅ Fargate service with ALB and WAF protection
- ✅ Environment variables for Cognito and DynamoDB
- ✅ IAM permissions for DynamoDB access
- ✅ CloudWatch logging and monitoring

## 🚀 Frontend Implementation

### Step 1: Build Your Container

Create a `Dockerfile` in your frontend directory:

```dockerfile
# Example Dockerfile for Next.js
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

### Step 2: Environment Variables

Your container automatically receives these environment variables:

```bash
# Cognito Configuration (Public - for browser)
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_COGNITO_DOMAIN=cosine-staging.auth.us-east-1.amazoncognito.com

# DynamoDB Configuration (Server-side only)
USER_PROFILES_TABLE_NAME=cosine-user-profiles-staging
SECURITY_EVENTS_TABLE_NAME=cosine-security-events-staging
USER_SESSIONS_TABLE_NAME=cosine-user-sessions-staging
```

### Step 3: Install AWS SDK and Cognito Libraries

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
npm install @aws-amplify/ui-react aws-amplify
```

### Step 4: Configure Amplify (React/Next.js Example)

```typescript
// lib/amplify-config.ts
import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    region: process.env.NEXT_PUBLIC_AWS_REGION,
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    userPoolWebClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    oauth: {
      domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
      scope: ['email', 'openid', 'profile'],
      redirectSignIn: typeof window !== 'undefined' ? window.location.origin : '',
      redirectSignOut: typeof window !== 'undefined' ? window.location.origin : '',
      responseType: 'code',
    },
  },
};

Amplify.configure(amplifyConfig);
export default amplifyConfig;
```

### Step 5: Authentication Components

```typescript
// components/AuthenticatedApp.tsx
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

function AuthenticatedApp({ signOut, user }) {
  return (
    <div>
      <header>
        <h1>Welcome {user.attributes.email}</h1>
        <button onClick={signOut}>Sign Out</button>
      </header>
      
      <main>
        {/* Your app content */}
      </main>
    </div>
  );
}

export default withAuthenticator(AuthenticatedApp, {
  socialProviders: ['google', 'amazon'], // Microsoft shows as 'amazon' in UI
  hideSignUp: false, // Allow user registration
});
```

### Step 6: DynamoDB Integration (Server-side)

```typescript
// lib/dynamodb.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.NEXT_PUBLIC_AWS_REGION });
const dynamoDb = DynamoDBDocumentClient.from(client);

// User Profile Operations
export async function getUserProfile(userId: string) {
  const command = new GetCommand({
    TableName: process.env.USER_PROFILES_TABLE_NAME,
    Key: { user_id: userId },
  });
  
  const response = await dynamoDb.send(command);
  return response.Item;
}

export async function createUserProfile(userProfile: any) {
  const command = new PutCommand({
    TableName: process.env.USER_PROFILES_TABLE_NAME,
    Item: {
      user_id: userProfile.user_id,
      email: userProfile.email,
      given_name: userProfile.given_name,
      family_name: userProfile.family_name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...userProfile,
    },
  });
  
  await dynamoDb.send(command);
}

// Security Event Logging
export async function logSecurityEvent(event: any) {
  const command = new PutCommand({
    TableName: process.env.SECURITY_EVENTS_TABLE_NAME,
    Item: {
      event_id: crypto.randomUUID(),
      user_id: event.user_id,
      event_type: event.event_type,
      timestamp: new Date().toISOString(),
      ip_address: event.ip_address,
      user_agent: event.user_agent,
      details: event.details,
      expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year TTL
    },
  });
  
  await dynamoDb.send(command);
}

// User Session Management
export async function createUserSession(sessionData: any) {
  const command = new PutCommand({
    TableName: process.env.USER_SESSIONS_TABLE_NAME,
    Item: {
      session_id: crypto.randomUUID(),
      user_id: sessionData.user_id,
      created_at: new Date().toISOString(),
      expires_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      device_info: sessionData.device_info,
      ...sessionData,
    },
  });
  
  await dynamoDb.send(command);
}
```

### Step 7: API Routes with Authentication

```typescript
// pages/api/user/profile.ts (Next.js API route)
import { NextApiRequest, NextApiResponse } from 'next';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { getUserProfile, createUserProfile } from '../../../lib/dynamodb';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Verify JWT token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const payload = await verifier.verify(token);
    const userId = payload.sub;
    
    if (req.method === 'GET') {
      const profile = await getUserProfile(userId);
      res.json(profile);
    } else if (req.method === 'POST') {
      await createUserProfile({ ...req.body, user_id: userId });
      res.json({ success: true });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
```

## 🔐 Authentication UI Examples

### Simple Sign-In Component

```typescript
// components/SignInOptions.tsx
import { Auth } from 'aws-amplify';

export function SignInOptions() {
  const handleGoogleSignIn = () => {
    Auth.federatedSignIn({ provider: 'Google' });
  };
  
  const handleMicrosoftSignIn = () => {
    Auth.federatedSignIn({ provider: 'Amazon' }); // Microsoft appears as Amazon
  };
  
  return (
    <div className="sign-in-options">
      <h2>Sign In to Cosine</h2>
      
      {/* Traditional Username/Password */}
      <div className="auth-section">
        <h3>Email & Password</h3>
        {/* Use Amplify UI components or custom form */}
      </div>
      
      {/* Federated Providers */}
      <div className="auth-section">
        <h3>Or sign in with:</h3>
        <button onClick={handleGoogleSignIn} className="google-btn">
          Sign in with Google
        </button>
        <button onClick={handleMicrosoftSignIn} className="microsoft-btn">
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
```

## 📦 Deployment Steps

### 1. Deploy Infrastructure

```bash
# Deploy base infrastructure first (if not already done)
cd Cosine-Base-Infra/terraform
terraform apply -var-file="environments/staging.auto.tfvars"

# Deploy frontend infrastructure
cd Cosine2.0/terraform
terraform apply -var-file="environments/staging.auto.tfvars"
```

### 2. Build and Push Container

```bash
# Get ECR login command
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <your-account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and tag image
docker build -t cosine-frontend-staging .
docker tag cosine-frontend-staging:latest <your-account-id>.dkr.ecr.us-east-1.amazonaws.com/cosine-frontend-staging:latest

# Push to ECR
docker push <your-account-id>.dkr.ecr.us-east-1.amazonaws.com/cosine-frontend-staging:latest
```

### 3. Configure OAuth Credentials

1. Go to AWS Secrets Manager in the console
2. Find the secret named `cosine-oauth-credentials-staging`
3. Update the secret value with your actual OAuth credentials:

```json
{
  "google_client_id": "your-google-client-id",
  "google_client_secret": "your-google-client-secret",
  "microsoft_client_id": "your-microsoft-client-id",
  "microsoft_client_secret": "your-microsoft-client-secret"
}
```

### 4. Update OAuth Redirect URIs

Update your Google and Microsoft OAuth applications with the Cognito redirect URI:
- **Redirect URI**: `https://cosine-staging.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`

## 🛡️ Security Best Practices

1. **Environment Variables**: Never expose DynamoDB table names to the browser
2. **JWT Validation**: Always verify tokens on the server side
3. **Error Logging**: Log security events to the security_events table
4. **Session Management**: Use the user_sessions table for active session tracking
5. **Input Validation**: Validate all user inputs before storing in DynamoDB

## 🔧 Troubleshooting

### Common Issues:

1. **OAuth Not Working**: Check redirect URIs in Google/Microsoft consoles
2. **DynamoDB Access Denied**: Verify ECS task role has DynamoDB permissions
3. **Token Validation Failed**: Ensure JWT verifier configuration matches Cognito settings
4. **Container Won't Start**: Check CloudWatch logs for startup errors

### Useful Commands:

```bash
# Check ECS service status
aws ecs describe-services --cluster cosine-cluster-staging --services cosine-frontend-service-staging

# View container logs
aws logs tail /ecs/cosine-frontend-staging --follow

# Test DynamoDB connectivity
aws dynamodb describe-table --table-name cosine-user-profiles-staging
```

## 📚 Next Steps

1. Implement user profile management UI
2. Add user preference storage
3. Implement role-based access control
4. Add user analytics and metrics
5. Implement user data export/deletion for GDPR compliance

## 🆘 Support

For infrastructure questions, check:
- Terraform outputs: `terraform output`
- CloudWatch logs: AWS Console → CloudWatch → Log Groups
- DynamoDB tables: AWS Console → DynamoDB → Tables
- Cognito configuration: AWS Console → Cognito → User Pools
