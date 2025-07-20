import json
import yfinance as yf
import numpy as np

def lambda_handler(event, context):
    """
    AWS Lambda handler to fetch volatility (standard deviation of returns) for a stock using yfinance.
    
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
        ticker = event.get('ticker')
        period = event.get('period', '1y')
        
        # Validate required parameters
        if not ticker:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
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
            'calculation_method': 'log_returns_std_dev'
        }
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
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
                'Access-Control-Allow-Origin': '*'
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
    stock = yf.Ticker(ticker)
    df = stock.history(period=period)
    
    if df.empty:
        raise ValueError(f"No data found for ticker {ticker}")
    
    # Calculate log returns
    df['log_return'] = np.log(df['Close'] / df['Close'].shift(1))
    
    # Calculate annualized volatility (252 trading days in a year)
    volatility = df['log_return'].std() * np.sqrt(252)
    
    return volatility
