# Robinhood Integration Setup Guide

This guide explains how to integrate Robinhood's API with your investment website to allow users to connect their Robinhood accounts and analyze their portfolios using your existing analytics tools.

## ⚠️ Important Legal Notice

**This integration uses an unofficial Robinhood API through the `robin-stocks` Python library. Please be aware that:**
- This may violate Robinhood's Terms of Service
- Robinhood may block or restrict accounts using unofficial APIs
- There are no guarantees of continued functionality
- Use at your own risk

**Recommended Alternative:** Consider using official brokerage APIs from providers like:
- Alpaca Trading API
- Interactive Brokers API
- TD Ameritrade API
- E*TRADE API

## Architecture Overview

The integration consists of:

1. **Backend Lambda Function** (`robinhood_integration/app/lambda_function.py`)
   - Handles authentication with Robinhood
   - Retrieves portfolio positions
   - Integrates with your existing portfolio analysis logic

2. **Frontend React Component** (`components/robinhood-integration.tsx`)
   - Provides UI for Robinhood login
   - Displays portfolio analysis results
   - Handles MFA authentication

3. **Infrastructure** (Terraform in `infra/main.tf`)
   - AWS Lambda function for backend processing
   - API Gateway for frontend-backend communication
   - Proper CORS configuration

## Setup Instructions

### 1. Local Development Setup (Recommended First)

Before deploying to AWS, set up and test the integration locally:

```powershell
# Quick setup (from project root)
.\local_dev\setup_local_dev.ps1

# Or manual setup
.\local_dev\scripts\setup_full_local.ps1
```

This will:
- Install all dependencies including `robin-stocks`
- Set up backend and frontend for local testing
- Create test scripts for validation

**Test locally first:**
```powershell
# Test portfolio analysis (offline)
python local_dev\tests\test_portfolio.py

# Test Robinhood integration (requires real credentials)
python local_dev\tests\test_robinhood.py

# Start local development servers
.\local_dev\scripts\start_local_dev.ps1
```

**Local URLs:**
- Frontend: http://localhost:3000
- Robinhood page: http://localhost:3000/robinhood
- Backend API: http://localhost:5000/robinhood

See `local_dev/LOCAL_DEVELOPMENT_GUIDE.md` for detailed local setup instructions.

### 2. Install Dependencies (For Manual Setup)

Add to your `requirements.txt`:
```
robin-stocks==3.0.1
```

Install in your development environment:
```bash
pip install robin-stocks
```

### 3. Deploy Backend Infrastructure

1. **Prepare Lambda Package** (Windows):
   ```powershell
   cd infra
   .\setup_lambda_package.ps1
   ```

   Or (Linux/Mac):
   ```bash
   cd infra
   ./setup_lambda_package.sh
   ```

2. **Deploy with Terraform**:
   ```bash
   cd infra
   terraform init
   terraform plan
   terraform apply
   ```

3. **Get API Endpoint**:
   After deployment, note the `robinhood_api_url` output from Terraform.

### 4. Configure Frontend

1. **Set Environment Variable**:
   Create/update `.env.local` in your frontend directory:
   ```
   NEXT_PUBLIC_ROBINHOOD_API_URL=YOUR_LAMBDA_API_GATEWAY_URL
   ```

2. **Build and Deploy Frontend**:
   ```bash
   cd frontend/app
   npm run build
   npm start
   ```

### 5. Access the Integration

1. Navigate to `/robinhood` in your web application
2. Enter Robinhood credentials
3. Complete MFA if required
4. View portfolio analysis results

## API Endpoints

The Lambda function supports these actions:

### Authentication
```json
POST /robinhood
{
  "action": "authenticate",
  "username": "your_username",
  "password": "your_password",
  "mfa_code": "123456"  // Optional, if MFA is enabled
}
```

### Get Portfolio Analysis
```json
POST /robinhood
{
  "action": "get_portfolio_analysis",
  "period": "1y"  // Optional: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
}
```

### Get Account Info
```json
POST /robinhood
{
  "action": "get_account_info"
}
```

### Logout
```json
POST /robinhood
{
  "action": "logout"
}
```

## Features

### Portfolio Analysis Integration
- **Automatic Position Retrieval**: Fetches current holdings from Robinhood
- **Risk Analysis**: Uses your existing `calculate_portfolio_metrics` function
- **Correlation Analysis**: Calculates correlations between holdings
- **Sharpe Ratio**: Computes risk-adjusted returns
- **Volatility Analysis**: Provides individual stock and portfolio volatility

### Security Features
- **Session Management**: Handles Robinhood authentication sessions
- **MFA Support**: Supports two-factor authentication
- **CORS Configuration**: Proper cross-origin request handling
- **Error Handling**: Comprehensive error handling and logging

### User Experience
- **Real-time Updates**: Live portfolio data from Robinhood
- **Responsive Design**: Works on desktop and mobile
- **Time Frame Selection**: Analyze different time periods
- **Detailed Breakdown**: Individual stock analysis

## Customization Options

### 1. Add Additional Metrics
Extend the `calculate_portfolio_metrics` function to include:
- Value at Risk (VaR)
- Maximum Drawdown
- Beta calculations
- Alpha calculations

### 2. Integrate with Alerts System
Modify the alert creation system to work with Robinhood positions:
```python
# In alert_creation/app/lambda_function.py
def create_alerts_for_robinhood_positions(positions):
    for ticker, shares, price in positions:
        # Create price alerts for each position
        create_alert(user_email, ticker, price * 0.95, comparison_mode=0)  # 5% loss alert
```

### 3. Add Historical Performance
Integrate with the `get_historical_portfolio` method:
```python
historical_data = robinhood_service.get_historical_portfolio(period="year")
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify credentials are correct
   - Check if MFA is enabled on account
   - Ensure Robinhood account is not locked

2. **Import Errors**
   - Ensure `robin-stocks` is installed: `pip install robin-stocks`
   - Check Python version compatibility (3.7+)

3. **API Gateway CORS Issues**
   - Verify CORS headers in Lambda response
   - Check API Gateway configuration

4. **Lambda Timeout**
   - Increase timeout in Terraform configuration
   - Optimize API calls

### Debug Mode

Enable debug logging in the Lambda function:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## Alternative Integration Options

### Option 1: Alpaca API (Recommended)
- Official API with proper documentation
- Free tier available
- Good for paper trading and real accounts

### Option 2: Interactive Brokers API
- Professional-grade API
- Extensive market data
- Complex setup but very powerful

### Option 3: Manual Portfolio Import
- Allow users to upload CSV files
- Parse common brokerage export formats
- Safer but less convenient

## Security Considerations

1. **Never Store Credentials**: Don't save Robinhood passwords
2. **Use HTTPS**: Always use secure connections
3. **Rate Limiting**: Implement API rate limiting
4. **Session Timeout**: Set reasonable session timeouts
5. **Audit Logging**: Log all API access for security monitoring

## Legal Considerations

1. **Terms of Service**: Review Robinhood's ToS regularly
2. **User Disclaimers**: Inform users of risks
3. **Data Privacy**: Handle user data according to privacy laws
4. **Compliance**: Ensure compliance with financial regulations

## Support and Maintenance

- Monitor for `robin-stocks` library updates
- Watch for Robinhood API changes
- Implement proper error handling and fallbacks
- Consider building migration path to official APIs

---

**Note**: This integration is provided as an educational example. Always prioritize official APIs and legal compliance in production environments.
