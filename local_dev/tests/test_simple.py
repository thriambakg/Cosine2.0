"""
Simple Test Script for Portfolio Analysis
Tests just the portfolio analysis without Robinhood integration
"""

import sys
import os

# Add paths for our modules
current_dir = os.path.dirname(os.path.abspath(__file__))
# Navigate to the backend source directory from local_dev/tests/
stats_path = os.path.join(current_dir, '..', '..', 'backend_app', 'src', 'stocks', 'stock_statistics', 'app')
sys.path.insert(0, stats_path)

def test_portfolio_analysis():
    """Test portfolio analysis with mock data"""
    
    print("Testing Portfolio Analysis...")
    print("=" * 40)
    
    try:
        # Import the portfolio analysis function
        from lambda_function import calculate_portfolio_metrics
        print("Successfully imported portfolio analysis module")
        
        # Mock portfolio data: (ticker, shares, current_price)
        mock_portfolio = [
            ('AAPL', 10, 190.50),
            ('GOOGL', 5, 125.75),
            ('MSFT', 7, 340.20),
            ('TSLA', 3, 240.85)
        ]
        
        print("\nTesting with mock portfolio:")
        total_value = 0
        for ticker, shares, price in mock_portfolio:
            value = shares * price
            total_value += value
            print(f"   {ticker}: {shares} shares @ ${price:.2f} = ${value:,.2f}")
        print(f"   Total Portfolio Value: ${total_value:,.2f}")
        
        print("\nCalculating portfolio metrics...")
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
        
        print("\nTest completed successfully!")
        return True
        
    except ImportError as e:
        print(f"Import error: {e}")
        print("Make sure you've installed all dependencies:")
        print("pip install -r requirements.txt")
        return False
        
    except Exception as e:
        print(f"Error during portfolio analysis: {e}")
        print("This might be due to:")
        print("- Network issues with Yahoo Finance")
        print("- Invalid stock tickers")
        print("- Missing dependencies")
        return False

def test_individual_components():
    """Test individual components separately"""
    
    print("\nTesting Individual Components...")
    print("=" * 40)
    
    try:
        # Test yfinance import
        import yfinance as yf
        print("yfinance: OK")
        
        # Test numpy import
        import numpy as np
        print("numpy: OK")
        
        # Test pandas import
        import pandas as pd
        print("pandas: OK")
        
        # Test a simple stock data fetch
        print("\nTesting stock data fetch...")
        stock = yf.Ticker("AAPL")
        data = stock.history(period="5d")
        if not data.empty:
            print(f"Successfully fetched AAPL data (last price: ${data['Close'].iloc[-1]:.2f})")
        else:
            print("Warning: No data received from Yahoo Finance")
        
        return True
        
    except Exception as e:
        print(f"Component test failed: {e}")
        return False

if __name__ == "__main__":
    print("Portfolio Analysis Test Suite")
    print("Choose a test option:")
    print("1. Test portfolio analysis")
    print("2. Test individual components")
    print("3. Run both tests")
    
    choice = input("\nEnter your choice (1/2/3): ").strip()
    
    if choice == "1":
        test_portfolio_analysis()
    elif choice == "2":
        test_individual_components()
    elif choice == "3":
        test_individual_components()
        print("\n" + "="*50)
        test_portfolio_analysis()
    else:
        print("Invalid choice. Running component tests...")
        test_individual_components()
