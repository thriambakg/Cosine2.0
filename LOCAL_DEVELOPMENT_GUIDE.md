# 🚀 Local Development Setup Guide

This guide will help you run your Robinhood integration locally for testing before deploying to AWS.

## Prerequisites

- Python 3.8+ with virtual environment activated
- Node.js 16+ and npm
- Backend server running on port 5000

## Quick Start

### 1. Backend Setup (if not already running)

```powershell
# From the root directory (Cosine2.0)
.\setup_simple.ps1

# Start the backend server
python backend_app/local_server.py
```

You should see:
```
Starting Robinhood Integration Local Server...
Server will be available at: http://localhost:5000
```

### 2. Frontend Setup

```powershell
# Navigate to frontend directory
cd frontend\app

# Run the frontend setup script
.\setup_frontend_local.ps1

# Start the development server
npm run dev
```

You should see:
```
ready - started server on 0.0.0.0:3000, url: http://localhost:3000
```

### 3. Test the Integration

1. Open your browser to: http://localhost:3000
2. Navigate to: http://localhost:3000/robinhood
3. Test the Robinhood integration interface

## Development URLs

- **Frontend**: http://localhost:3000
- **Robinhood Page**: http://localhost:3000/robinhood
- **Backend API**: http://localhost:5000/robinhood
- **Backend Health**: http://localhost:5000/health

## Testing the Full Flow

### Step 1: Backend Health Check
```powershell
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "robinhood-integration-local"
}
```

### Step 2: Test Portfolio Analysis (Mock Data)
```powershell
python test_portfolio.py
# Choose option 1 for offline test
```

### Step 3: Test Frontend Communication
1. Go to http://localhost:3000/robinhood
2. Try the mock authentication (won't actually connect to Robinhood)
3. Or use real credentials (at your own risk)

## File Structure

Your local development setup uses these files:

```
frontend/app/
├── .env.local                    # Local environment variables (DO NOT COMMIT)
├── setup_frontend_local.ps1      # Frontend setup script
└── components/
    └── robinhood-integration.tsx  # Main Robinhood component

backend_app/
├── local_server.py              # Local Flask server (mimics Lambda)
└── src/stocks/robinhood_integration/

test_portfolio.py                # Portfolio testing (offline/online)
setup_simple.ps1                # Backend setup script
```

## Environment Variables

### Local Development (.env.local)
```env
NEXT_PUBLIC_ROBINHOOD_API_URL=http://localhost:5000/robinhood
NODE_ENV=development
NEXT_PUBLIC_DEBUG=true
```

### AWS Deployment (for later)
```env
NEXT_PUBLIC_ROBINHOOD_API_URL=https://your-api-gateway-url/robinhood
NODE_ENV=production
```

## Troubleshooting

### Common Issues

1. **Port 3000 already in use**
   ```powershell
   # Use a different port
   npm run dev -- -p 3001
   ```

2. **Backend not responding**
   - Make sure `python backend_app/local_server.py` is running
   - Check http://localhost:5000/health

3. **CORS errors**
   - Ensure Flask-CORS is installed: `pip install flask-cors`
   - Check that backend includes CORS headers

4. **Import errors in backend**
   - Make sure virtual environment is activated
   - Run `pip install -r requirements.txt`

### Network Testing

Test the API directly:
```powershell
# Test authentication endpoint
$body = @{
    action = "authenticate"
    username = "test_user"
    password = "test_pass"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5000/robinhood" -Method POST -Body $body -ContentType "application/json"
```

## Deployment Preparation

When you're ready to deploy to AWS:

1. **Backend**: Use the Terraform configuration in `infra/`
2. **Frontend**: Update environment variables to use AWS API Gateway URL
3. **Keep local files**: All local development files are separate from deployment

## Security Notes

⚠️ **Important for Local Development**:
- `.env.local` contains local URLs only
- Never commit real Robinhood credentials
- Use test/demo accounts when possible
- Local server has CORS enabled for development

## Next Steps

1. Test locally with mock data
2. Test with real Robinhood account (optional, at your own risk)
3. Deploy backend to AWS using Terraform
4. Update frontend environment for production
5. Deploy frontend to your hosting platform

Happy developing! 🎉
