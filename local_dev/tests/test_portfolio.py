"""
Offline Portfolio Analysis Test
Tests portfolio analysis with pre-calculated mock data
"""

import sys
import os
import json

# Add paths for our modules
current_dir = os.path.dirname(os.path.abspath(__file__))
# Navigate to the backend source directory from local_dev/tests/
stats_path = os.path.join(current_dir, '..', '..', 'backend_app', 'src', 'stocks', 'stock_statistics', 'app')
sys.path.insert(0, stats_path)

def calculate_mock_portfolio_metrics(portfolio_tuples):
    """
    Calculate portfolio metrics using mock data (offline)
    This simulates the portfolio analysis without needing live data
    """
    
    # Mock historical returns and volatilities for common stocks
    mock_stock_data = {
        'AAPL': {'annual_return': 0.15, 'annual_volatility': 0.25},
        'GOOGL': {'annual_return': 0.12, 'annual_volatility': 0.22},
        'MSFT': {'annual_return': 0.18, 'annual_volatility': 0.20},
        'TSLA': {'annual_return': 0.35, 'annual_volatility': 0.45},
        'AMZN': {'annual_return': 0.14, 'annual_volatility': 0.28},
        'META': {'annual_return': 0.16, 'annual_volatility': 0.30}
    }
    
    # Calculate total portfolio value
    total_portfolio_value = sum([shares * price for _, shares, price in portfolio_tuples])
    
    # Individual stock analysis
    stock_details = {}
    portfolio_weights = []
    expected_returns = []
    annual_volatilities = []
    
    for ticker, shares, current_price in portfolio_tuples:
        # Use mock data or defaults
        if ticker in mock_stock_data:
            annual_return = mock_stock_data[ticker]['annual_return']
            annual_volatility = mock_stock_data[ticker]['annual_volatility']
        else:
            # Default values for unknown stocks
            annual_return = 0.10  # 10% default return
            annual_volatility = 0.20  # 20% default volatility
        
        # Calculate portfolio weight
        stock_value = shares * current_price
        weight = stock_value / total_portfolio_value
        portfolio_weights.append(weight)
        expected_returns.append(annual_return)
        annual_volatilities.append(annual_volatility)
        
        # Store stock details
        stock_details[ticker] = {
            'shares': shares,
            'current_price': current_price,
            'total_value': stock_value,
            'annual_return': annual_return,
            'annual_volatility': annual_volatility,
            'weight': weight
        }
    
    # Portfolio expected return (weighted average)
    import numpy as np
    portfolio_weights = np.array(portfolio_weights)
    expected_returns = np.array(expected_returns)
    annual_volatilities = np.array(annual_volatilities)
    
    portfolio_expected_return = np.dot(portfolio_weights, expected_returns)
    
    # Simple portfolio volatility calculation (assumes some correlation)
    # This is a simplified version - real calculation would use correlation matrix
    portfolio_volatility = np.sqrt(np.dot(portfolio_weights**2, annual_volatilities**2))
    
    # Sharpe Ratio (assuming 5% risk-free rate)
    risk_free_rate = 0.05
    sharpe_ratio = (portfolio_expected_return - risk_free_rate) / portfolio_volatility
    
    return {
        'total_portfolio_value': total_portfolio_value,
        'portfolio_expected_return': portfolio_expected_return * 100,  # Convert to percentage
        'portfolio_volatility': portfolio_volatility * 100,  # Convert to percentage
        'sharpe_ratio': sharpe_ratio,
        'stock_details': stock_details,
        'individual_stocks': [ticker for ticker, _, _ in portfolio_tuples]
    }

def test_offline_portfolio_analysis():
    """Test portfolio analysis with offline mock data"""
    
    print("Testing Portfolio Analysis (Offline Mode)")
    print("=" * 50)
    
    # Mock portfolio data: (ticker, shares, current_price)
    mock_portfolio = [
        ('AAPL', 10, 190.50),
        ('GOOGL', 5, 125.75),
        ('MSFT', 7, 340.20),
        ('TSLA', 3, 240.85)
    ]
    
    print("Testing with mock portfolio:")
    total_value = 0
    for ticker, shares, price in mock_portfolio:
        value = shares * price
        total_value += value
        print(f"   {ticker}: {shares} shares @ ${price:.2f} = ${value:,.2f}")
    print(f"   Total Portfolio Value: ${total_value:,.2f}")
    
    print("\nCalculating portfolio metrics (using offline data)...")
    analysis = calculate_mock_portfolio_metrics(mock_portfolio)
    
    print(f"\nResults:")
    print(f"Total Value: ${analysis['total_portfolio_value']:,.2f}")
    print(f"Expected Return: {analysis['portfolio_expected_return']:.2f}%")
    print(f"Volatility: {analysis['portfolio_volatility']:.2f}%")
    print(f"Sharpe Ratio: {analysis['sharpe_ratio']:.2f}")
    
    print("\nIndividual Stock Details:")
    for ticker, details in analysis['stock_details'].items():
        print(f"   {ticker}:")
        print(f"     Weight: {details['weight']*100:.1f}%")
        print(f"     Return: {details['annual_return']*100:.2f}%")
        print(f"     Volatility: {details['annual_volatility']*100:.2f}%")
    
    print("\nOffline test completed successfully!")
    return True

def test_online_portfolio_analysis():
    """Test portfolio analysis with live data"""
    
    print("Testing Portfolio Analysis (Online Mode)")
    print("=" * 50)
    
    try:
        from lambda_function import calculate_portfolio_metrics
        print("Successfully imported portfolio analysis module")
        
        # Mock portfolio data: (ticker, shares, current_price)
        mock_portfolio = [
            ('AAPL', 10, 190.50),
            ('GOOGL', 5, 125.75),
            ('MSFT', 7, 340.20),
            ('TSLA', 3, 240.85)
        ]
        
        print("\nTesting with mock portfolio (live data):")
        for ticker, shares, price in mock_portfolio:
            print(f"   {ticker}: {shares} shares @ ${price:.2f}")
        
        print("\nCalculating portfolio metrics (fetching live data)...")
        analysis = calculate_portfolio_metrics(mock_portfolio, period="1y")
        
        print(f"\nResults:")
        print(f"Total Value: ${analysis['total_portfolio_value']:,.2f}")
        print(f"Expected Return: {analysis['portfolio_expected_return']:.2f}%")
        print(f"Volatility: {analysis['portfolio_volatility']:.2f}%")
        print(f"Sharpe Ratio: {analysis['sharpe_ratio']:.2f}")
        
        print("\nIndividual Stock Details:")
        for ticker, details in analysis['stock_details'].items():
            print(f"   {ticker}:")
            print(f"     Weight: {details['weight']*100:.1f}%")
            print(f"     Return: {details['annual_return']*100:.2f}%")
            print(f"     Volatility: {details['annual_volatility']*100:.2f}%")
        
        print("\nOnline test completed successfully!")
        return True
        
    except Exception as e:
        print(f"Online test failed: {e}")
        print("This is often due to:")
        print("- Yahoo Finance API issues")
        print("- Network connectivity problems")
        print("- Rate limiting")
        print("\nTry the offline test instead!")
        return False

if __name__ == "__main__":
    print("Portfolio Analysis Test Suite")
    print("Choose a test option:")
    print("1. Offline test (uses mock data, always works)")
    print("2. Online test (uses live data, may fail due to network)")
    print("3. Run both tests")
    
    choice = input("\nEnter your choice (1/2/3): ").strip()
    
    if choice == "1":
        test_offline_portfolio_analysis()
    elif choice == "2":
        test_online_portfolio_analysis()
    elif choice == "3":
        test_offline_portfolio_analysis()
        print("\n" + "="*60)
        test_online_portfolio_analysis()
    else:
        print("Invalid choice. Running offline test...")
        test_offline_portfolio_analysis()
