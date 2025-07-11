"""
Local Development Server for Robinhood Integration
Flask app that mimics the Lambda function for local testing
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import logging
import sys
import os
import importlib.util

# Add the backend modules to the path
current_dir = os.path.dirname(os.path.abspath(__file__))
# Navigate to the backend source directory from local_dev/backend/
backend_base = os.path.join(current_dir, '..', '..', 'backend_app', 'src')
backend_stocks = os.path.join(backend_base, 'stocks')

# Add multiple paths to ensure all modules can be found
sys.path.extend([
    backend_base,
    backend_stocks,
    os.path.join(backend_stocks, 'robinhood_integration', 'app'),
    os.path.join(backend_stocks, 'stock_statistics', 'app'),
    os.path.join(backend_stocks, 'volatility_fetch', 'app'),
    os.path.join(backend_stocks, 'alert_creation', 'app'),
    os.path.join(backend_stocks, 'alert_trigger', 'app')
])

try:
    # Import robinhood service
    robinhood_app_path = os.path.join(backend_stocks, 'robinhood_integration', 'app')
    sys.path.insert(0, robinhood_app_path)
    from robinhood_service import robinhood_service
    
    # Import portfolio metrics from stock statistics
    stats_app_path = os.path.join(backend_stocks, 'stock_statistics', 'app')
    sys.path.insert(0, stats_app_path)
    
    # Import the specific module for portfolio metrics
    import importlib.util
    stats_spec = importlib.util.spec_from_file_location("stats_lambda", os.path.join(stats_app_path, "lambda_function.py"))
    stats_module = importlib.util.module_from_spec(stats_spec)
    stats_spec.loader.exec_module(stats_module)
    calculate_portfolio_metrics = stats_module.calculate_portfolio_metrics
    
    print("Successfully imported backend modules")
    
except ImportError as e:
    print(f"Import error: {e}")
    print("Please make sure all dependencies are installed and paths are correct")
except Exception as e:
    print(f"Module loading error: {e}")
    print("Backend modules not available - some features may not work")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

@app.route('/robinhood', methods=['POST', 'OPTIONS'])
def robinhood_handler():
    """Handle Robinhood API requests"""
    
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 200
    
    try:
        data = request.get_json()
        action = data.get('action')
        
        if action == 'authenticate':
            return handle_authentication(data)
        elif action == 'get_portfolio_analysis':
            return handle_portfolio_analysis(data)
        elif action == 'get_account_info':
            return handle_account_info()
        elif action == 'logout':
            return handle_logout()
        else:
            return jsonify({
                'error': 'Invalid action. Supported actions: authenticate, get_portfolio_analysis, get_account_info, logout'
            }), 400
            
    except Exception as e:
        logger.error(f"Request handler error: {e}")
        return jsonify({
            'error': f'Internal server error: {str(e)}'
        }), 500

def handle_authentication(data):
    """Handle Robinhood authentication"""
    try:
        username = data.get('username')
        password = data.get('password')
        mfa_code = data.get('mfa_code')
        
        if not username or not password:
            return jsonify({
                'error': 'Username and password are required'
            }), 400
        
        # Authenticate with Robinhood
        auth_result = robinhood_service.authenticate(username, password, mfa_code)
        
        if auth_result['success']:
            # Get basic account info after successful authentication
            try:
                account_info = robinhood_service.get_account_info()
                return jsonify({
                    'message': 'Authentication successful',
                    'account_info': account_info
                })
            except Exception as e:
                logger.warning(f"Authentication successful but failed to get account info: {e}")
                return jsonify({
                    'message': 'Authentication successful',
                    'account_info': None
                })
        else:
            status_code = 401 if not auth_result.get('requires_mfa') else 202
            return jsonify(auth_result), status_code
            
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        return jsonify({
            'error': f'Authentication failed: {str(e)}'
        }), 500

def handle_portfolio_analysis(data):
    """Handle portfolio analysis using Robinhood data"""
    try:
        if not robinhood_service.is_authenticated:
            return jsonify({
                'error': 'User not authenticated with Robinhood'
            }), 401
        
        # Get portfolio positions from Robinhood
        portfolio_positions = robinhood_service.get_portfolio_positions()
        
        if not portfolio_positions:
            # Provide helpful response for empty portfolios
            return jsonify({
                'message': 'No positions found in Robinhood account',
                'empty_portfolio': True,
                'suggestions': {
                    'reason': 'Your Robinhood account appears to have no stock positions.',
                    'options': [
                        'This is normal for new or empty accounts',
                        'You can test the portfolio analysis with mock data',
                        'Or add some stocks to your Robinhood account first'
                    ],
                    'mock_data_available': True
                },
                'mock_portfolio_analysis': generate_mock_portfolio_analysis(),
                'portfolio_analysis': None
            })
        
        # Get analysis period from request (default to 1 year)
        period = data.get('period', '1y')
        
        # Use existing portfolio analysis logic
        portfolio_analysis = calculate_portfolio_metrics(portfolio_positions, period)
        
        # Get account info for additional context
        account_info = robinhood_service.get_account_info()
        
        return jsonify({
            'portfolio_analysis': portfolio_analysis,
            'account_info': account_info,
            'positions_count': len(portfolio_positions),
            'analysis_period': period
        })
        
    except Exception as e:
        logger.error(f"Portfolio analysis error: {e}")
        return jsonify({
            'error': f'Portfolio analysis failed: {str(e)}'
        }), 500

def handle_account_info():
    """Handle account info request"""
    try:
        if not robinhood_service.is_authenticated:
            return jsonify({
                'error': 'User not authenticated with Robinhood'
            }), 401
        
        account_info = robinhood_service.get_account_info()
        
        return jsonify({
            'account_info': account_info
        })
        
    except Exception as e:
        logger.error(f"Account info error: {e}")
        return jsonify({
            'error': f'Failed to get account info: {str(e)}'
        }), 500

def handle_logout():
    """Handle logout request"""
    try:
        robinhood_service.logout()
        
        return jsonify({
            'message': 'Successfully logged out'
        })
        
    except Exception as e:
        logger.error(f"Logout error: {e}")
        return jsonify({
            'error': f'Logout failed: {str(e)}'
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'robinhood-integration-local'
    })

def generate_mock_portfolio_analysis():
    """Generate a mock portfolio analysis for demonstration purposes"""
    return {
        'total_portfolio_value': 10000.00,
        'portfolio_expected_return': 15.25,
        'portfolio_volatility': 18.50,
        'sharpe_ratio': 0.85,
        'stock_details': {
            'AAPL': {
                'shares': 10,
                'current_price': 190.50,
                'total_value': 1905.00,
                'annual_return': 15.0,
                'annual_volatility': 25.0,
                'weight': 19.05
            },
            'GOOGL': {
                'shares': 5,
                'current_price': 125.75,
                'total_value': 628.75,
                'annual_return': 12.0,
                'annual_volatility': 22.0,
                'weight': 6.29
            },
            'MSFT': {
                'shares': 15,
                'current_price': 340.20,
                'total_value': 5103.00,
                'annual_return': 18.0,
                'annual_volatility': 20.0,
                'weight': 51.03
            },
            'TSLA': {
                'shares': 8,
                'current_price': 240.85,
                'total_value': 1926.80,
                'annual_return': 25.0,
                'annual_volatility': 35.0,
                'weight': 19.27
            },
            'AMZN': {
                'shares': 3,
                'current_price': 145.50,
                'total_value': 436.50,
                'annual_return': 14.0,
                'annual_volatility': 28.0,
                'weight': 4.36
            }
        },
        'individual_stocks': ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN'],
        'analysis_notes': [
            'This is mock data for demonstration purposes',
            'Your actual portfolio will show real holdings and calculations',
            'Add stocks to your Robinhood account to see live analysis'
        ]
    }

@app.route('/robinhood/mock', methods=['POST', 'OPTIONS'])
def mock_portfolio_handler():
    """Handle mock portfolio analysis for testing purposes"""
    
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 200
    
    try:
        data = request.get_json()
        period = data.get('period', '1y')
        
        # Generate mock portfolio analysis
        mock_analysis = generate_mock_portfolio_analysis()
        
        return jsonify({
            'portfolio_analysis': mock_analysis,
            'account_info': {
                'user_id': 'demo_user_123',
                'username': 'demo_user',
                'email': 'demo@example.com',
                'account_number': 'DEMO123456',
                'total_portfolio_value': mock_analysis['total_portfolio_value'],
                'day_change': 125.50,
                'day_change_percent': 1.27,
                'is_mock_data': True
            },
            'positions_count': len(mock_analysis['individual_stocks']),
            'analysis_period': period,
            'message': 'Mock portfolio analysis generated successfully'
        })
        
    except Exception as e:
        logger.error(f"Mock portfolio analysis error: {e}")
        return jsonify({
            'error': f'Mock portfolio analysis failed: {str(e)}'
        }), 500

if __name__ == '__main__':
    print("Starting Robinhood Integration Local Server...")
    print("Server will be available at: http://localhost:5000")
    print("Health check: http://localhost:5000/health")
    print("API endpoint: http://localhost:5000/robinhood")
    
    app.run(debug=True, host='0.0.0.0', port=5000)
