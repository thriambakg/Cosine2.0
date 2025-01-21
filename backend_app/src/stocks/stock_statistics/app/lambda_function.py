import yfinance as yf
import numpy as np
import pandas as pd
import logging
import fetch_volatility as fv
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
    stock_data = yf.download(tickers, period=period)['Adj Close']
    
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
        stock_data = yf.download(stock_tickers, period=period)['Adj Close']
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
        annual_volatility = fv(ticker, period=period)
        
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

def lambda_function(portfolio_tuples,period="1y"):
    """
    Main function to process portfolio tuples and print results.
    
    Args:
    portfolio_tuples (list): List of tuples with (stock_ticker, number_of_shares, current_price)
    """
    try:
        # Calculate portfolio metrics
        portfolio_metrics = calculate_portfolio_metrics(portfolio_tuples,period)
        
        # # Print formatted results
        # print("\n--- Portfolio Analysis ---")
        # print(f"Total Portfolio Value: ${portfolio_metrics['total_portfolio_value']:,.2f}")
        # print(f"Portfolio Expected Annual Return: {portfolio_metrics['portfolio_expected_return']:.2f}%")
        # print(f"Portfolio Volatility (Risk): {portfolio_metrics['portfolio_volatility']:.2f}%")
        # print(f"Sharpe Ratio: {portfolio_metrics['sharpe_ratio']:.2f}")
        
        # print("\nIndividual Stock Details:")
        # for ticker, details in portfolio_metrics['stock_details'].items():
        #     print(f"\n{ticker}:")
        #     print(f"  Shares: {details['shares']}")
        #     print(f"  Current Price: ${details['current_price']:.2f}")
        #     print(f"  Total Value: ${details['shares'] * details['current_price']:,.2f}")
        #     print(f"  Weight: {details['weight']*100:.2f}%")
        #     print(f"  Annual Return: {details['annual_return']*100:.2f}%")
        #     print(f"  Annual Volatility: {details['annual_volatility']*100:.2f}%")
        
        return portfolio_metrics
    
    except Exception as e:
        print(f"Error calculating portfolio metrics: {e}")
        logger.error(f"Portfolio calculation failed: {e}")
        return None

# # Allow direct script execution for testing
# if __name__ == "__main__":
#     # Example usage for testing
#     test_portfolio = [
#         ('AAPL', 10, 190.50),  # ticker, shares, current price
#         ('GOOGL', 5, 125.75),
#         ('MSFT', 7, 340.20)
#     ]
#     main(test_portfolio)
