"""
Robinhood Integration Service
Provides authentication and portfolio data retrieval from Robinhood accounts
"""

import robin_stocks.robinhood as rh
import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RobinhoodService:
    def __init__(self):
        self.is_authenticated = False
        self.user_credentials = None
    
    def authenticate(self, username: str, password: str, mfa_code: Optional[str] = None) -> Dict:
        """
        Authenticate user with Robinhood
        
        Args:
            username (str): Robinhood username/email
            password (str): Robinhood password
            mfa_code (str, optional): MFA code if enabled
            
        Returns:
            dict: Authentication result
        """
        try:
            if mfa_code:
                login_result = rh.login(username, password, mfa_code=mfa_code)
            else:
                login_result = rh.login(username, password)
            
            if login_result:
                self.is_authenticated = True
                logger.info("Successfully authenticated with Robinhood")
                return {
                    "success": True,
                    "message": "Authentication successful",
                    "requires_mfa": False
                }
            else:
                return {
                    "success": False,
                    "message": "Authentication failed",
                    "requires_mfa": False
                }
                
        except Exception as e:
            error_msg = str(e)
            if "mfa" in error_msg.lower() or "two-factor" in error_msg.lower():
                return {
                    "success": False,
                    "message": "MFA code required",
                    "requires_mfa": True
                }
            else:
                logger.error(f"Authentication error: {e}")
                return {
                    "success": False,
                    "message": f"Authentication error: {error_msg}",
                    "requires_mfa": False
                }
    
    def get_portfolio_positions(self) -> List[Tuple[str, float]]:
        """
        Get current portfolio positions from Robinhood
        
        Returns:
            List[Tuple]: List of (ticker, shares) tuples
            Note: Current prices will be fetched automatically by the Portfolio Analysis Lambda
        """
        if not self.is_authenticated:
            raise ValueError("User not authenticated. Please login first.")
        
        try:
            positions = rh.get_open_stock_positions()
            portfolio_data = []
            
            for position in positions:
                if float(position['quantity']) > 0:  # Only include positions with shares
                    # Get stock info
                    instrument_url = position['instrument']
                    stock_info = rh.get_instrument_by_url(instrument_url)
                    ticker = stock_info['symbol']
                    
                    shares = float(position['quantity'])
                    
                    # Return only ticker and shares - current price will be fetched by Portfolio Analysis Lambda
                    portfolio_data.append((ticker, shares))
                    
            logger.info(f"Retrieved {len(portfolio_data)} positions from Robinhood (prices will be fetched automatically)")
            return portfolio_data
            
        except Exception as e:
            logger.error(f"Error retrieving portfolio positions: {e}")
            raise ValueError(f"Failed to retrieve portfolio: {e}")
    
    def get_account_info(self) -> Dict:
        """
        Get account information including total portfolio value
        
        Returns:
            dict: Account information
        """
        if not self.is_authenticated:
            raise ValueError("User not authenticated. Please login first.")
        
        try:
            # Get account info
            user_info = rh.get_user()
            account_info = rh.get_account()
            portfolio_info = rh.get_portfolio()
            
            return {
                "user_id": user_info.get('id'),
                "username": user_info.get('username'),
                "email": user_info.get('email'),
                "account_number": account_info.get('account_number'),
                "total_portfolio_value": float(portfolio_info.get('total_return_today', 0)),
                "day_change": float(portfolio_info.get('total_return_today', 0)),
                "day_change_percent": float(portfolio_info.get('total_return_today_percent', 0))
            }
            
        except Exception as e:
            logger.error(f"Error retrieving account info: {e}")
            raise ValueError(f"Failed to retrieve account info: {e}")
    
    def get_historical_portfolio(self, period: str = "year") -> Dict:
        """
        Get historical portfolio performance
        
        Args:
            period (str): Time period for historical data
            
        Returns:
            dict: Historical portfolio data
        """
        if not self.is_authenticated:
            raise ValueError("User not authenticated. Please login first.")
        
        try:
            historical_data = rh.get_historical_portfolio(period)
            return {
                "period": period,
                "historical_data": historical_data
            }
            
        except Exception as e:
            logger.error(f"Error retrieving historical data: {e}")
            raise ValueError(f"Failed to retrieve historical data: {e}")
    
    def logout(self):
        """Logout from Robinhood"""
        try:
            rh.logout()
            self.is_authenticated = False
            logger.info("Successfully logged out from Robinhood")
        except Exception as e:
            logger.error(f"Error during logout: {e}")

# Global service instance
robinhood_service = RobinhoodService()
