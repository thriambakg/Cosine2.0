import os
# Set OpenBLAS to use a compatible CPU architecture for Lambda
# This prevents the libopenblas64_p-r0-15028c96.3.21.so error
os.environ['OPENBLAS_CORETYPE'] = 'Haswell'

import json
import yfinance as yf
import numpy as np
import pandas as pd
import logging
from datetime import datetime
import volatility_fetcher as fv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def calculate_correlation(tickers, period="1y"):
    """
    Calculate the correlation coefficient between a list of stock tickers over a specified period.

    Args:
    tickers (list): A list of stock tickers (e.g., ['AAPL', 'GOOGL', 'AMZN']).
    period (str): The period to retrieve the data for, default is "1y" (1 year).

    Returns:
    pd.DataFrame: A correlation matrix of stock returns.
    """
    # Fetch historical data for the given tickers
    stock_data = yf.download(tickers, period=period)['Close']
    
    # Ensure that the data is not empty
    if stock_data.empty:
        raise ValueError(f"Could not retrieve data for {', '.join(tickers)}")

    # Calculate daily returns for each stock
    daily_returns = stock_data.pct_change().dropna()

    # Calculate the correlation matrix for the daily returns
    correlation_matrix = daily_returns.corr()

    return correlation_matrix

def calculate_portfolio_variance(portfolio_weights, annual_volatilities, correlation_matrix):
    """
    Calculate the variance of a portfolio given the weights, volatilities, and correlation matrix.

    Args:
    portfolio_weights (numpy.array): Array of weights of the stocks in the portfolio.
    annual_volatilities (numpy.array): Array of annual volatilities (standard deviations) of the stocks.
    correlation_matrix (pandas.DataFrame): Correlation matrix of stock returns.

    Returns:
    float: Portfolio variance.
    """

    portfolio_weights = np.array(portfolio_weights)
    annual_volatilities = np.array(annual_volatilities)
    correlation_matrix = np.array(correlation_matrix)
    # Convert correlation matrix to a covariance matrix
    # Calculate the covariance matrix using the volatilities and correlation matrix
    cov_matrix = correlation_matrix * np.outer(annual_volatilities, annual_volatilities)

    # Calculate portfolio variance using the formula: w^T * covariance_matrix * w
    portfolio_variance = np.dot(portfolio_weights.T, np.dot(cov_matrix, portfolio_weights))

    return np.sqrt(portfolio_variance)


def calculate_portfolio_metrics(portfolio_tuples, period, risk_free_rate=0.05):
    """
    Calculate portfolio risk and expected return.
    
    Args:
    portfolio_tuples (list): List of tuples with (stock_ticker, number_of_shares, current_price)
    risk_free_rate (float): Annual risk-free rate (default 5%)
    
    Returns:
    dict: Portfolio metrics including total risk, expected return, and individual stock details
    """
    # Validate input
    if not portfolio_tuples:
        raise ValueError("Portfolio cannot be empty")
    
    # Prepare data structures
    stock_tickers = [ticker for ticker, _, _ in portfolio_tuples]
    
    # Calculate total portfolio value
    total_portfolio_value = sum([shares * price for _, shares, price in portfolio_tuples])
    
    # Download historical stock data
    try:
        stock_data = yf.download(stock_tickers, period=period)['Close']
        logger.info(f"Successfully downloaded data for {stock_tickers}")
    except Exception as e:
        logger.error(f"Error downloading stock data: {e}")
        raise ValueError(f"Error downloading stock data: {e}")
    
    # Ensure data is present for all stocks
    if stock_data.empty:
        raise ValueError("No stock data could be retrieved. Check stock tickers.")
    
    # Calculate returns
    returns = stock_data.pct_change().dropna()
    
    # Individual stock analysis
    stock_details = {}
    portfolio_weights = []
    expected_returns = []
    annual_volatilities = []
    
    for ticker, shares, current_price in portfolio_tuples:
        # Skip if data is insufficient
        if ticker not in returns.columns:
            logger.warning(f"No data available for {ticker}")
            continue
        
        # Calculate individual stock metrics
        stock_returns = returns[ticker]
        avg_annual_return = stock_returns.mean() * 252  # Annualized return
        annual_volatility = fv.fetch_volatility(ticker, period=period)
        
        # Calculate portfolio weight
        stock_value = shares * current_price
        weight = stock_value / total_portfolio_value
        portfolio_weights.append(weight)
        expected_returns.append(avg_annual_return)
        annual_volatilities.append(annual_volatility)
        
        # Store stock details
        stock_details[ticker] = {
            'shares': shares,
            'current_price': current_price,
            'total_value': stock_value,
            'annual_return': avg_annual_return,
            'annual_volatility': annual_volatility,
            'weight': weight
        }
    
    # Validate calculations
    if not stock_details:
        raise ValueError("Unable to calculate metrics for any stocks in the portfolio")
    
    # Portfolio expected return (weighted average of individual returns)
    portfolio_expected_return = np.dot(portfolio_weights, expected_returns)
    
    # Portfolio variance calculation (including covariance)
    correlation_matrix = calculate_correlation(stock_tickers,period=period)

    portfolio_volatility = calculate_portfolio_variance(portfolio_weights, annual_volatilities, correlation_matrix)
    
    # Sharpe Ratio calculation
    sharpe_ratio = (portfolio_expected_return - risk_free_rate) / portfolio_volatility
    
    return {
        'total_portfolio_value': total_portfolio_value,
        'portfolio_expected_return': portfolio_expected_return * 100,  # Convert to percentage
        'portfolio_volatility': portfolio_volatility * 100,  # Convert to percentage
        'sharpe_ratio': sharpe_ratio,
        'stock_details': stock_details,
        'individual_stocks': stock_tickers
    }

def lambda_handler(event, context):
    """
    AWS Lambda handler for portfolio analysis
    
    Supports two use cases:
    1. Robinhood Integration: Receives portfolio data from Robinhood lambda
    2. Standalone Tool: Receives manual portfolio configuration from frontend
    
    Args:
        event: API Gateway event containing portfolio data
        context: Lambda context object
        
    Returns:
        dict: HTTP response with portfolio analysis or error
    """
    try:
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        # CORS headers
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        }
        
        # Handle preflight requests
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': ''
            }
        
        # Validate input
        portfolio_data = body.get('portfolio_data')
        period = body.get('period', '1y')
        analysis_type = body.get('analysis_type', 'standalone')  # 'robinhood' or 'standalone'
        
        if not portfolio_data:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Portfolio data is required',
                    'details': 'Provide portfolio_data as list of [ticker, shares, price] tuples'
                })
            }
        
        # Validate portfolio data format
        if not isinstance(portfolio_data, list):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Portfolio data must be a list',
                    'details': 'Expected format: [["AAPL", 10, 190.50], ["GOOGL", 5, 125.75]]'
                })
            }
        
        # Validate each portfolio entry
        portfolio_tuples = []
        for i, entry in enumerate(portfolio_data):
            if not isinstance(entry, list) or len(entry) != 3:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Invalid portfolio entry at index {i}',
                        'details': 'Each entry must be [ticker, shares, price]'
                    })
                }
            
            ticker, shares, price = entry
            try:
                shares = float(shares)
                price = float(price)
                portfolio_tuples.append((str(ticker).upper(), shares, price))
            except (ValueError, TypeError):
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Invalid data types at index {i}',
                        'details': 'Shares and price must be numbers'
                    })
                }
        
        # Calculate portfolio metrics
        logger.info(f"Analyzing portfolio with {len(portfolio_tuples)} positions, period: {period}")
        portfolio_metrics = calculate_portfolio_metrics(portfolio_tuples, period)
        
        if portfolio_metrics is None:
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Failed to calculate portfolio metrics',
                    'details': 'Check that all stock tickers are valid and data is available'
                })
            }
        
        # Prepare response
        response_data = {
            'success': True,
            'analysis_type': analysis_type,
            'period': period,
            'portfolio_metrics': portfolio_metrics,
            'timestamp': datetime.now().isoformat()
        }
        
        # Add metadata based on analysis type
        if analysis_type == 'robinhood':
            response_data['source'] = 'robinhood_integration'
            response_data['positions_count'] = len(portfolio_tuples)
        else:
            response_data['source'] = 'standalone_tool'
            response_data['positions_count'] = len(portfolio_tuples)
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(response_data)
        }
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Invalid JSON in request body',
                'details': str(e)
            })
        }
    except Exception as e:
        logger.error(f"Lambda handler error: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'details': str(e)
            })
        }

def lambda_function(portfolio_tuples, period="1y"):
    """
    Legacy function for direct portfolio analysis (used by Robinhood integration)
    
    Args:
    portfolio_tuples (list): List of tuples with (stock_ticker, number_of_shares, current_price)
    period (str): Analysis period
    """
    try:
        # Calculate portfolio metrics
        portfolio_metrics = calculate_portfolio_metrics(portfolio_tuples, period)
        
        return portfolio_metrics
    
    except Exception as e:
        logger.error(f"Portfolio calculation failed: {e}")
        return None

# Allow direct script execution for testing
if __name__ == "__main__":
    # Test the lambda handler with a sample portfolio
    test_event = {
        'httpMethod': 'POST',
        'body': json.dumps({
            'portfolio_data': [
                ['AAPL', 10, 190.50],  # ticker, shares, current price
                ['GOOGL', 5, 125.75],
                ['MSFT', 7, 340.20]
            ],
            'period': '1y',
            'analysis_type': 'standalone'
        })
    }
    
    # Test standalone analysis
    print("Testing Standalone Portfolio Analysis:")
    print("=" * 50)
    result = lambda_handler(test_event, None)
    print(f"Status Code: {result['statusCode']}")
    if result['statusCode'] == 200:
        response_body = json.loads(result['body'])
        metrics = response_body['portfolio_metrics']
        print(f"Total Portfolio Value: ${metrics['total_portfolio_value']:,.2f}")
        print(f"Expected Return: {metrics['portfolio_expected_return']:.2f}%")
        print(f"Volatility: {metrics['portfolio_volatility']:.2f}%")
        print(f"Sharpe Ratio: {metrics['sharpe_ratio']:.2f}")
    else:
        print(f"Error: {result['body']}")
    
    # Test Robinhood analysis type
    print("\nTesting Robinhood Integration Format:")
    print("=" * 50)
    test_event['body'] = json.dumps({
        'portfolio_data': [
            ['TSLA', 3, 240.85],
            ['AMZN', 2, 145.30]
        ],
        'period': '6mo',
        'analysis_type': 'robinhood'
    })
    
    result = lambda_handler(test_event, None)
    print(f"Status Code: {result['statusCode']}")
    if result['statusCode'] == 200:
        response_body = json.loads(result['body'])
        print(f"Analysis Type: {response_body['analysis_type']}")
        print(f"Source: {response_body['source']}")
        print(f"Positions: {response_body['positions_count']}")
    else:
        print(f"Error: {result['body']}")
