# Multi-stage build for Next.js frontend
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure public directory exists
RUN mkdir -p ./public

# Accept build arguments
ARG NEXT_PUBLIC_AWS_REGION=us-east-1
ARG NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_TEMP12345
ARG NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=TEMPTEMPTEMPTEMP123456
ARG NEXT_PUBLIC_COGNITO_DOMAIN=temp-domain.auth.us-east-1.amazoncognito.com
ARG NEXT_PUBLIC_API_GATEWAY_URL=https://api.example.com

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# Set environment variables for build with defaults
ENV NODE_ENV=production
ENV NEXT_PUBLIC_AWS_REGION=${NEXT_PUBLIC_AWS_REGION}
ENV NEXT_PUBLIC_COGNITO_USER_POOL_ID=${NEXT_PUBLIC_COGNITO_USER_POOL_ID}
ENV NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=${NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID}
ENV NEXT_PUBLIC_COGNITO_DOMAIN=${NEXT_PUBLIC_COGNITO_DOMAIN}
ENV NEXT_PUBLIC_API_GATEWAY_URL=${NEXT_PUBLIC_API_GATEWAY_URL}

# Build the application
RUN echo "=== Starting Next.js build ===" && \
    echo "Environment variables:" && \
    env | grep NEXT_PUBLIC || true && \
    echo "Running npm run build with detailed output..." && \
    npm run build || (echo "=== BUILD FAILED - Debugging ===" && \
                      echo "Package.json scripts:" && \
                      cat package.json | grep -A 10 '"scripts"' && \
                      echo "=== Checking for common issues ===" && \
                      echo "Next.js config:" && \
                      cat next.config.js && \
                      echo "=== TypeScript config ===" && \
                      cat tsconfig.json && \
                      echo "=== Directory structure ===" && \
                      find . -name "*.tsx" -o -name "*.ts" | head -20 && \
                      echo "=== Checking imports in layout.tsx ===" && \
                      head -15 app/layout.tsx && \
                      false)

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Disable Next.js startup logs that contain Unicode characters
ENV NEXT_DISABLE_SWC_WASM=true
# Set locale to handle Unicode properly  
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
# Disable verbose Next.js output
ENV NEXT_PRIVATE_DEBUG_OUTPUT=false
# Force UTF-8 encoding for Node.js
ENV NODE_OPTIONS="--max-old-space-size=512"
# Disable emoji and unicode in npm/node output
ENV NO_COLOR=1
ENV CI=true

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy the public folder
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
# Use exec form to avoid shell and potential encoding issues
CMD ["node", "server.js"]
