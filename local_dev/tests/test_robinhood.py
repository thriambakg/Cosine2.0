"""
Simple Test Script for Robinhood Integration
Tests the core functionality without needing a web server
"""

import sys
import os
import json
from getpass import getpass


# Add the backend modules to the path
current_dir = os.path.dirname(os.path.abspath(__file__))
# Navigate to the backend source directory from local_dev/tests/
backend_path = os.path.join(current_dir, '..', '..', 'backend_app', 'src', 'stocks')
sys.path.append(backend_path)

def test_robinhood_integration():
    """Test the Robinhood integration step by step"""
    
    print("🚀 Robinhood Integration Test")
    print("=" * 50)
    
    try:
        # Import modules
        print("Importing modules...")
        
        # Add the correct path to robinhood integration
        robinhood_path = os.path.join(current_dir, '..', '..', 'backend_app', 'src', 'stocks', 'robinhood_integration', 'app')
        sys.path.append(robinhood_path)
        
        # Add the correct path to stock statistics  
        stats_path = os.path.join(current_dir, '..', '..', 'backend_app', 'src', 'stocks', 'stock_statistics', 'app')
        sys.path.append(stats_path)
        
        from robinhood_service import robinhood_service
        from lambda_function import calculate_portfolio_metrics
        print("Modules imported successfully")
        
    except ImportError as e:
        print(f"Import error: {e}")
        print("\nTo fix this, run:")
        print("pip install robin-stocks")
        return False
    
    # Test authentication
    print("\n🔐 Testing Authentication")
    print("-" * 30)
    
    # Get credentials from user
    username = input("Enter Robinhood username/email: ").strip()
    if not username:
        print("❌ Username is required for testing")
        return False
        
    password = getpass("Enter Robinhood password: ")
    if not password:
        print("❌ Password is required for testing")
        return False
    
    # Attempt authentication
    print("🔄 Attempting to authenticate...")
    auth_result = robinhood_service.authenticate(username, password)
    
    if not auth_result['success']:
        if auth_result.get('requires_mfa'):
            print("📱 MFA code required")
            mfa_code = input("Enter your 6-digit MFA code: ").strip()
            if mfa_code:
                auth_result = robinhood_service.authenticate(username, password, mfa_code)
        
        if not auth_result['success']:
            print(f"❌ Authentication failed: {auth_result.get('message', 'Unknown error')}")
            return False
    
    print("✅ Authentication successful!")
    
    # Test account info
    print("\n📊 Testing Account Info")
    print("-" * 30)
    
    try:
        account_info = robinhood_service.get_account_info()
        print(f"👤 Account: {account_info.get('username', 'N/A')}")
        print(f"💰 Portfolio Value: ${account_info.get('total_portfolio_value', 0):.2f}")
        print(f"📧 Email: {account_info.get('email', 'N/A')}")
        print("✅ Account info retrieved successfully")
        
    except Exception as e:
        print(f"⚠️  Warning: Could not get account info: {e}")
    
    # Test portfolio positions
    print("\n📈 Testing Portfolio Positions")
    print("-" * 30)
    
    try:
        positions = robinhood_service.get_portfolio_positions()
        
        if not positions:
            print("ℹ️  No positions found in account")
            print("   This could mean:")
            print("   - Your account has no stock holdings")
            print("   - All positions are closed")
            print("   - There's an issue with data retrieval")
        else:
            print(f"📋 Found {len(positions)} positions:")
            for ticker, shares, price in positions[:5]:  # Show first 5
                print(f"   {ticker}: {shares} shares @ ${price:.2f}")
            
            if len(positions) > 5:
                print(f"   ... and {len(positions) - 5} more")
        
        print("✅ Portfolio positions retrieved successfully")
        
    except Exception as e:
        print(f"❌ Error getting portfolio positions: {e}")
        return False
    
    # Test portfolio analysis (if positions exist)
    if positions:
        print("\n🔬 Testing Portfolio Analysis")
        print("-" * 30)
        
        try:
            analysis = calculate_portfolio_metrics(positions, period="1y")
            
            print(f"💵 Total Value: ${analysis['total_portfolio_value']:,.2f}")
            print(f"📈 Expected Return: {analysis['portfolio_expected_return']:.2f}%")
            print(f"📊 Volatility: {analysis['portfolio_volatility']:.2f}%")
            print(f"⚡ Sharpe Ratio: {analysis['sharpe_ratio']:.2f}")
            print("✅ Portfolio analysis completed successfully")
            
        except Exception as e:
            print(f"❌ Error in portfolio analysis: {e}")
            print("   This might be due to:")
            print("   - Network issues with Yahoo Finance")
            print("   - Invalid stock tickers")
            print("   - Insufficient historical data")
    
    # Test logout
    print("\n🚪 Testing Logout")
    print("-" * 30)
    
    try:
        robinhood_service.logout()
        print("✅ Logout successful")
        
    except Exception as e:
        print(f"⚠️  Warning: Logout error: {e}")
    
    print("\n🎉 Test completed!")
    return True

def test_mock_data():
    """Test portfolio analysis with mock data (no Robinhood required)"""
    
    print("\nTesting with Mock Data")
    print("=" * 50)
    
    try:
        # Add the correct path to the backend modules from local_dev/tests/
        backend_stocks_path = os.path.join(current_dir, '..', '..', 'backend_app', 'src', 'stocks', 'stock_statistics', 'app')
        sys.path.append(backend_stocks_path)
        
        from lambda_function import calculate_portfolio_metrics
        
        # Mock portfolio data: (ticker, shares, current_price)
        mock_portfolio = [
            ('AAPL', 10, 190.50),
            ('GOOGL', 5, 125.75),
            ('MSFT', 7, 340.20),
            ('TSLA', 3, 240.85)
        ]
        
        print("Testing with mock portfolio:")
        for ticker, shares, price in mock_portfolio:
            print(f"   {ticker}: {shares} shares @ ${price:.2f}")
        
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
        
        print("✅ Mock data test completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Mock data test failed: {e}")
        return False

if __name__ == "__main__":
    print("Robinhood Integration Test Suite")
    print("Choose a test option:")
    print("1. Test with real Robinhood account (requires credentials)")
    print("2. Test with mock data (no credentials required)")
    print("3. Run both tests")
    
    choice = input("\nEnter your choice (1/2/3): ").strip()
    
    if choice == "1":
        test_robinhood_integration()
    elif choice == "2":
        test_mock_data()
    elif choice == "3":
        test_mock_data()
        print("\n" + "="*50)
        if input("\nProceed with Robinhood test? (y/n): ").lower().startswith('y'):
            test_robinhood_integration()
    else:
        print("Invalid choice. Running mock data test...")
        test_mock_data()
