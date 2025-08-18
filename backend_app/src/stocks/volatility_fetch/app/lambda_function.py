import json
# import yfinance as yf  # TODO: Uncomment when lambda layer is available
# import numpy as np     # TODO: Uncomment when lambda layer is available
import random
import math

def lambda_handler(event, context):
    """
    AWS Lambda handler to fetch volatility (standard deviation of returns) for a stock using yfinance.
    
    NOTE: Currently using mock implementation due to missing lambda layer.
    TODO: Uncomment real implementation when lambda layer is available.
    
    Expected event format:
    {
        "ticker": "AAPL",
        "period": "1y"  # optional, defaults to "1y"
    }
    
    Returns:
    {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": {
            "ticker": "AAPL",
            "period": "1y",
            "volatility": 0.25,
            "volatility_percentage": "25.00%"
        }
    }
    """
    try:
        # Parse the event to get parameters
        if isinstance(event, str):
            event = json.loads(event)
        
        # Extract parameters from event
        # For GET requests, API Gateway passes query parameters in event['queryStringParameters']
        # For POST requests, parameters are in event['body']
        if event.get('queryStringParameters'):
            # GET request with query parameters
            ticker = event['queryStringParameters'].get('ticker')
            period = event['queryStringParameters'].get('period', '1y')
        elif event.get('body'):
            # POST request with body
            body = event['body']
            if isinstance(body, str):
                body = json.loads(body)
            ticker = body.get('ticker')
            period = body.get('period', '1y')
        else:
            # Direct event parameters (fallback)
            ticker = event.get('ticker')
            period = event.get('period', '1y')
        
                # Validate required parameters
        if not ticker:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Force-Preflight,X-Requested-With,X-Cache-Buster',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
                },
                'body': json.dumps({
                    'error': 'Missing required parameter: ticker',
                    'message': 'Please provide a stock ticker symbol'
                })
            }
        
        # Fetch volatility
        volatility = calculate_volatility(ticker, period)
        
        # Format response
        response_body = {
            'ticker': ticker.upper(),
            'period': period,
            'volatility': round(volatility, 4),
            'volatility_percentage': f"{volatility * 100:.2f}%",
            'annualized': True,
            'calculation_method': 'log_returns_std_dev',  # Will be accurate when real implementation is enabled
            'note': 'Currently using mock data. Real market data will be available when lambda layer is integrated.'
        }
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Force-Preflight,X-Requested-With,X-Cache-Buster',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            'body': json.dumps(response_body)
        }
        
    except Exception as e:
        print(f"Error calculating volatility: {str(e)}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Force-Preflight,X-Requested-With,X-Cache-Buster',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e),
                'ticker': event.get('ticker', 'unknown') if isinstance(event, dict) else 'unknown'
            })
        }

def calculate_volatility(ticker, period="1y"):
    """
    Calculate volatility (standard deviation of returns) for a stock using yfinance.
    
    Args:
        ticker (str): Stock ticker symbol
        period (str): Time period for historical data
        
    Returns:
        float: Annualized volatility
    """
    # TODO: Uncomment this real implementation when lambda layer is available
    # stock = yf.Ticker(ticker)
    # df = stock.history(period=period)
    # 
    # if df.empty:
    #     raise ValueError(f"No data found for ticker {ticker}")
    # 
    # # Calculate log returns
    # df['log_return'] = np.log(df['Close'] / df['Close'].shift(1))
    # 
    # # Calculate annualized volatility (252 trading days in a year)
    # volatility = df['log_return'].std() * np.sqrt(252)
    # 
    # return volatility
    
    # TEMPORARY MOCK IMPLEMENTATION - Remove when real implementation is enabled
    # Mock volatility calculation - returns realistic volatility values
    # Based on typical stock volatilities: tech stocks 20-40%, stable stocks 10-25%
    
    # Set random seed based on ticker for consistent results
    random.seed(hash(ticker) % 1000)
    
    # Different volatility ranges for different types of stocks
    high_vol_tickers = ['TSLA', 'GME', 'AMC', 'NVDA', 'BITCOIN', 'BTC']
    low_vol_tickers = ['MSFT', 'AAPL', 'JNJ', 'PG', 'KO', 'WMT']
    
    if ticker.upper() in high_vol_tickers:
        # High volatility stocks: 25-50%
        base_volatility = 0.25 + random.random() * 0.25
    elif ticker.upper() in low_vol_tickers:
        # Low volatility stocks: 10-25%
        base_volatility = 0.10 + random.random() * 0.15
    else:
        # Average volatility stocks: 15-35%
        base_volatility = 0.15 + random.random() * 0.20
    
    # Add some period-based adjustment
    period_multiplier = {
        '1d': 0.5,   # Short term less volatile
        '5d': 0.7,
        '1mo': 0.8,
        '3mo': 0.9,
        '6mo': 0.95,
        '1y': 1.0,   # Base case
        '2y': 1.1,
        '5y': 1.2,   # Longer term more volatile
        '10y': 1.3,
        'max': 1.4
    }.get(period, 1.0)
    
    return base_volatility * period_multiplier
