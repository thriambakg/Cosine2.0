# Backend Implementation Guide

## Overview

This document outlines the backend infrastructure implementation for the Cosine investment analytics platform, including AWS Lambda functions, API Gateway, and frontend integration.

## Architecture

### Backend Components

1. **AWS Lambda Functions** - Serverless compute for various financial calculations
2. **API Gateway** - RESTful API endpoints for frontend communication
3. **DynamoDB** - User data storage and session management
4. **Secrets Manager** - Secure storage for API keys and sensitive data
5. **CloudWatch** - Logging and monitoring

### Lambda Functions

| Function | Purpose | Endpoint | Method |
|----------|---------|----------|--------|
| `chat-lambda` | AI chat functionality | `/chat` | POST |
| `stock-volatility-lambda` | Stock volatility calculations | `/stocks/volatility` | GET |
| `portfolio-analysis-lambda` | Portfolio risk analysis | `/portfolio` | POST |
| `crypto-stats-lambda` | Cryptocurrency statistics | `/crypto` | GET |
| `option-pricing-lambda` | Option pricing calculations | `/options` | POST |
| `stock-alerts-lambda` | Stock alert management | `/alerts` | POST |

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. Terraform installed (version >= 1.0)
3. Python 3.11+ for Lambda functions
4. Base infrastructure deployed (Cognito, DynamoDB, etc.)

### Deployment Steps

1. **Deploy Base Infrastructure** (if not already deployed):
   ```bash
   cd terraform
   terraform init
   terraform plan -var-file="environments/staging.auto.tfvars"
   terraform apply -var-file="environments/staging.auto.tfvars"
   ```

2. **Deploy Backend Infrastructure**:
   ```bash
   cd terraform
   terraform init
   terraform plan -var-file="environments/staging.auto.tfvars"
   terraform apply -var-file="environments/staging.auto.tfvars"
   ```

3. **Get API Gateway URL**:
   ```bash
   terraform output api_gateway
   ```

## API Endpoints

### Stock Volatility API

**Endpoint**: `GET /stocks/volatility`

**Query Parameters**:
- `ticker` (required): Stock ticker symbol (e.g., "AAPL")
- `period` (optional): Time period for analysis (default: "1y")

**Supported Periods**:
- `1d`, `5d`, `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `10y`, `max`

**Response**:
```json
{
  "ticker": "AAPL",
  "period": "1y",
  "volatility": 0.2345,
  "volatility_percentage": "23.45%",
  "annualized": true,
  "calculation_method": "log_returns_std_dev",
  "note": "Currently using mock data. Real market data will be available when lambda layer is integrated."
}
```

### Portfolio Analysis API

**Endpoint**: `POST /portfolio`

**Request Body**:
```json
{
  "stocks": [
    {
      "ticker": "AAPL",
      "shares": 100,
      "purchasePrice": 150.00
    }
  ],
  "riskTolerance": "medium"
}
```

**Response**:
```json
{
  "totalValue": 15000.00,
  "totalReturn": 500.00,
  "totalReturnPercentage": 3.33,
  "portfolioRisk": 0.18,
  "sharpeRatio": 1.2,
  "maxDrawdown": -0.05,
  "diversificationScore": 0.75,
  "recommendations": ["Consider adding more defensive stocks"],
  "stockAnalysis": [...]
}
```

### Crypto Statistics API

**Endpoint**: `GET /crypto`

**Query Parameters**:
- `symbols` (optional): Comma-separated list of crypto symbols
- `timeframe` (optional): Analysis timeframe

**Response**:
```json
{
  "timestamp": "2024-01-01T00:00:00Z",
  "data": [
    {
      "symbol": "BTC",
      "name": "Bitcoin",
      "price": 45000.00,
      "change24h": 2.5,
      "changePercentage24h": 5.88,
      "marketCap": 850000000000,
      "volume24h": 25000000000,
      "volatility": 0.35
    }
  ],
  "summary": {
    "totalMarketCap": 2000000000000,
    "totalVolume24h": 100000000000,
    "averageVolatility": 0.28
  }
}
```

### Option Pricing API

**Endpoint**: `POST /options`

**Request Body**:
```json
{
  "underlyingPrice": 100.00,
  "strikePrice": 105.00,
  "timeToExpiry": 0.25,
  "riskFreeRate": 0.02,
  "volatility": 0.25,
  "optionType": "call"
}
```

**Response**:
```json
{
  "optionPrice": 3.45,
  "delta": 0.65,
  "gamma": 0.02,
  "theta": -0.15,
  "vega": 0.12,
  "rho": 0.08,
  "impliedVolatility": 0.25,
  "intrinsicValue": 0.00,
  "timeValue": 3.45,
  "calculationMethod": "black_scholes"
}
```

### Stock Alerts API

**Endpoint**: `POST /alerts`

**Request Body**:
```json
{
  "ticker": "AAPL",
  "alertType": "price_above",
  "threshold": 200.00,
  "userId": "user123",
  "notificationEmail": "user@example.com"
}
```

**Response**:
```json
{
  "alertId": "alert_123",
  "status": "active",
  "message": "Alert created successfully",
  "createdAt": "2024-01-01T00:00:00Z",
  "triggerConditions": {
    "ticker": "AAPL",
    "alertType": "price_above",
    "threshold": 200.00
  }
}
```

### Chat API

**Endpoint**: `POST /chat`

**Request Body**:
```json
{
  "message": "What's the volatility of AAPL?",
  "userId": "user123",
  "context": {
    "currentPage": "dashboard",
    "portfolioData": {...},
    "previousMessages": [...]
  }
}
```

**Response**:
```json
{
  "response": "AAPL has a current volatility of 23.45% based on 1-year historical data...",
  "suggestions": ["Check portfolio risk", "View detailed analysis"],
  "confidence": 0.95,
  "processingTime": 1.2,
  "context": {
    "relevantData": {...},
    "recommendations": [...]
  }
}
```

## Frontend Integration

### API Service

The frontend uses a centralized API service (`src/services/api.ts`) that provides:

- Type-safe API calls
- Error handling
- Request/response interfaces
- CORS support

### React Hooks

Custom React hooks (`src/hooks/useAPI.ts`) provide:

- Loading states
- Error handling
- Caching
- Request cancellation
- Polling support

### Usage Example

```typescript
import { useStockVolatility } from '../hooks/useAPI';

function StockVolatilityComponent() {
  const { data, loading, error, execute } = useStockVolatility();

  const handleFetch = async () => {
    await execute({ ticker: 'AAPL', period: '1y' });
  };

  return (
    <div>
      <button onClick={handleFetch} disabled={loading}>
        {loading ? 'Loading...' : 'Fetch Volatility'}
      </button>
      {error && <div>Error: {error}</div>}
      {data && (
        <div>
          Volatility: {data.volatility_percentage}
        </div>
      )}
    </div>
  );
}
```

## Environment Configuration

### Environment Variables

Set these environment variables in your frontend:

```bash
NEXT_PUBLIC_API_GATEWAY_URL=https://your-api-gateway-url.amazonaws.com/staging
NEXT_PUBLIC_ENVIRONMENT=staging
```

### Configuration File

The API configuration is managed in `src/config/api.ts`:

```typescript
export const API_CONFIG = {
  BASE_URL: process.env.NEXT_PUBLIC_API_GATEWAY_URL,
  ENDPOINTS: {
    STOCK_VOLATILITY: '/stocks/volatility',
    // ... other endpoints
  },
  // ... other config
};
```

## Security

### Authentication

- API Gateway supports Cognito JWT tokens
- Lambda functions validate user authentication
- DynamoDB access controlled by IAM policies

### CORS

API Gateway is configured with CORS support for frontend integration:

```json
{
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
}
```

## Monitoring

### CloudWatch Logs

All Lambda functions log to CloudWatch with structured logging:

```python
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    logger.info(f"Processing request: {event}")
    # ... function logic
    logger.info(f"Request completed successfully")
```

### Metrics

Key metrics to monitor:

- Lambda function duration
- API Gateway response times
- Error rates
- Request volume

## Development

### Local Testing

1. **Test Lambda Functions Locally**:
   ```bash
   cd backend_app/src/stocks/volatility_fetch/app
   python lambda_function.py
   ```

2. **Test API Endpoints**:
   ```bash
   curl "https://your-api-gateway-url.amazonaws.com/staging/stocks/volatility?ticker=AAPL&period=1y"
   ```

### Adding New Endpoints

1. Create Lambda function in `backend_app/src/`
2. Add Terraform configuration in `terraform/main.tf`
3. Update API service in `frontend/react-app/src/services/api.ts`
4. Create React hook in `frontend/react-app/src/hooks/useAPI.ts`
5. Update frontend components

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure API Gateway CORS is configured correctly
2. **Lambda Timeout**: Increase timeout in Terraform configuration
3. **Permission Errors**: Check IAM policies and roles
4. **API Gateway 500**: Check Lambda function logs in CloudWatch

### Debug Commands

```bash
# Check Lambda function logs
aws logs tail /aws/lambda/cosine-stock-volatility-staging --follow

# Test API Gateway endpoint
curl -X GET "https://your-api-gateway-url.amazonaws.com/staging/stocks/volatility?ticker=AAPL"

# Check Terraform state
terraform output api_gateway
```

## Next Steps

1. **Real Data Integration**: Replace mock implementations with real market data APIs
2. **Authentication**: Implement JWT token validation in Lambda functions
3. **Rate Limiting**: Add API Gateway usage plans
4. **Caching**: Implement Redis for frequently accessed data
5. **Real-time Updates**: Add WebSocket support for live data
6. **Advanced Analytics**: Implement machine learning models for predictions
