# Frontend Encoding Fix

This update fixes Unicode character encoding issues that were causing container startup failures.

## Changes Made:
- Added `NO_COLOR=1` and `CI=true` environment variables to disable Unicode/emoji output
- Added Node.js memory limit option  
- Enhanced locale settings for better UTF-8 support

## Health Check Status:
- ALB health check optimized: 30s interval, 20s timeout, 3 failure threshold
- Container health check aligned with ALB settings
- Separate pipeline triggers only on frontend changes

Date: 2025-08-03
