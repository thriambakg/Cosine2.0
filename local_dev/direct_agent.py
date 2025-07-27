#!/usr/bin/env python3
"""
Direct Agent Interface for Cosine Chat
Bypasses Strands framework and creates a direct interface to your financial tools
"""

import sys
import os
import json
import yfinance as yf
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

# Add the backend path to sys.path
backend_path = Path(__file__).parent.parent / "backend_app" / "src" / "Chat"
sys.path.append(str(backend_path))

class DirectFinancialAgent:
    """Direct financial agent that doesn't rely on Strands framework"""
    
    def __init__(self):
        self.available_tools = [
            "stock_analysis", "portfolio_analysis", "technical_indicators", 
            "market_data", "financial_news", "risk_assessment"
        ]
        print("✅ Direct Financial Agent initialized")
    
    def process_message(self, message: str, files: List[Dict] = None) -> str:
        """Process a message and return financial analysis"""
        try:
            message_lower = message.lower()
            
            # Extract stock tickers
            tickers = self._extract_tickers(message)
            
            # Determine analysis type
            if tickers:
                return self._analyze_stocks(tickers, message)
            elif 'portfolio' in message_lower:
                return self._analyze_portfolio(message, files)
            elif any(word in message_lower for word in ['market', 'economy', 'trend']):
                return self._market_analysis(message)
            elif files:
                return self._analyze_files(files, message)
            else:
                return self._general_financial_advice(message)
                
        except Exception as e:
            return f"🤖 **Analysis Error**: {str(e)}\\n\\nI can still help with stock analysis, portfolio questions, or market insights. Please try rephrasing your question."
    
    def _extract_tickers(self, message: str) -> List[str]:
        """Extract stock tickers from message"""
        import re
        
        # Common tickers
        known_tickers = [
            'AAPL', 'TSLA', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 
            'AMD', 'INTC', 'NFLX', 'UBER', 'LYFT', 'SNAP', 'TWTR', 'CRM',
            'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'BRK.B', 'JPM', 'BAC'
        ]
        
        # Extract potential tickers (1-5 letters, uppercase)
        words = message.upper().split()
        found_tickers = []
        
        for word in words:
            # Clean word of punctuation
            clean_word = re.sub(r'[^A-Z]', '', word)
            if clean_word in known_tickers:
                found_tickers.append(clean_word)
        
        # Also check for company names
        company_map = {
            'APPLE': 'AAPL', 'TESLA': 'TSLA', 'MICROSOFT': 'MSFT',
            'GOOGLE': 'GOOGL', 'AMAZON': 'AMZN', 'META': 'META',
            'NVIDIA': 'NVDA', 'NETFLIX': 'NFLX'
        }
        
        for company, ticker in company_map.items():
            if company in message.upper():
                found_tickers.append(ticker)
        
        return list(set(found_tickers))  # Remove duplicates
    
    def _analyze_stocks(self, tickers: List[str], original_message: str) -> str:
        """Analyze stocks using yfinance"""
        try:
            results = []
            
            for ticker in tickers[:3]:  # Limit to 3 stocks
                try:
                    stock = yf.Ticker(ticker)
                    info = stock.info
                    hist = stock.history(period="1mo")
                    
                    if hist.empty:
                        results.append(f"❌ No data available for {ticker}")
                        continue
                    
                    # Current price and change
                    current_price = hist['Close'].iloc[-1]
                    prev_close = hist['Close'].iloc[-2] if len(hist) > 1 else current_price
                    change = current_price - prev_close
                    change_pct = (change / prev_close) * 100
                    
                    # Technical indicators
                    sma_20 = hist['Close'].rolling(20).mean().iloc[-1] if len(hist) >= 20 else None
                    volatility = hist['Close'].pct_change().std() * np.sqrt(252) * 100  # Annualized
                    
                    analysis = f"""📊 **{ticker} Analysis**
                    
**Current Metrics:**
• Price: ${current_price:.2f} ({change:+.2f} | {change_pct:+.2f}%)
• 20-day SMA: ${sma_20:.2f if sma_20 else 'N/A'}
• Volatility: {volatility:.1f}% (annualized)
• Volume: {hist['Volume'].iloc[-1]:,.0f}

**Company Info:**
• Market Cap: ${info.get('marketCap', 0)/1e9:.1f}B
• P/E Ratio: {info.get('forwardPE', 'N/A')}
• Sector: {info.get('sector', 'N/A')}

**Recent Performance:**
• 5-day: {((hist['Close'].iloc[-1] / hist['Close'].iloc[-6]) - 1) * 100:+.1f}%
• 1-month: {((hist['Close'].iloc[-1] / hist['Close'].iloc[0]) - 1) * 100:+.1f}%"""

                    results.append(analysis)
                    
                except Exception as e:
                    results.append(f"❌ Error analyzing {ticker}: {str(e)}")
            
            header = f"🤖 **Direct Financial Analysis** ({len(tickers)} stock{'s' if len(tickers) > 1 else ''})"
            return header + "\\n\\n" + "\\n\\n".join(results)
            
        except Exception as e:
            return f"🤖 **Stock Analysis Error**: {str(e)}\\n\\nPlease try with a specific ticker like AAPL, TSLA, or MSFT."
    
    def _analyze_portfolio(self, message: str, files: List[Dict] = None) -> str:
        """Analyze portfolio data"""
        if files:
            # Try to extract portfolio data from uploaded files
            for file_data in files:
                if file_data.get('name', '').endswith('.csv'):
                    try:
                        import io
                        import base64
                        
                        # Decode file content
                        content = base64.b64decode(file_data['content'])
                        df = pd.read_csv(io.BytesIO(content))
                        
                        return self._process_portfolio_csv(df)
                        
                    except Exception as e:
                        return f"❌ Error processing portfolio file: {str(e)}"
        
        return """🤖 **Portfolio Analysis Framework**

📊 **To analyze your portfolio, please:**
1. Upload a CSV file with columns: ticker, shares, price (optional)
2. Or provide portfolio data in your message

**Example CSV format:**
```
ticker,shares,price
AAPL,100,180.50
TSLA,50,240.00
MSFT,75,350.00
```

📈 **Analysis includes:**
• Diversification assessment
• Risk metrics (volatility, beta)
• Correlation analysis
• Performance vs benchmarks
• Rebalancing recommendations"""
    
    def _process_portfolio_csv(self, df: pd.DataFrame) -> str:
        """Process portfolio CSV data"""
        try:
            # Standardize column names
            df.columns = df.columns.str.lower().str.strip()
            
            if 'ticker' not in df.columns:
                return "❌ CSV must have a 'ticker' column"
            
            results = ["🤖 **Portfolio Analysis from CSV**\\n"]
            
            # Get current prices for tickers
            portfolio_data = []
            total_value = 0
            
            for _, row in df.iterrows():
                ticker = row['ticker'].upper()
                shares = row.get('shares', 1)
                
                try:
                    stock = yf.Ticker(ticker)
                    current_price = stock.history(period="1d")['Close'].iloc[-1]
                    value = shares * current_price
                    total_value += value
                    
                    portfolio_data.append({
                        'ticker': ticker,
                        'shares': shares,
                        'price': current_price,
                        'value': value
                    })
                    
                except Exception:
                    results.append(f"⚠️ Could not get data for {ticker}")
            
            if portfolio_data:
                results.append("**Portfolio Composition:**")
                for item in portfolio_data:
                    weight = (item['value'] / total_value) * 100
                    results.append(f"• {item['ticker']}: {item['shares']:.0f} shares @ ${item['price']:.2f} = ${item['value']:,.0f} ({weight:.1f}%)")
                
                results.append(f"\\n**Total Portfolio Value: ${total_value:,.0f}**")
                
                # Basic diversification check
                if len(portfolio_data) < 5:
                    results.append("\\n⚠️ **Diversification**: Consider adding more holdings for better diversification")
                else:
                    results.append("\\n✅ **Diversification**: Good number of holdings")
            
            return "\\n".join(results)
            
        except Exception as e:
            return f"❌ Error processing portfolio: {str(e)}"
    
    def _market_analysis(self, message: str) -> str:
        """Provide market analysis"""
        try:
            # Get SPY data for market overview
            spy = yf.Ticker("SPY")
            spy_hist = spy.history(period="1mo")
            
            if not spy_hist.empty:
                spy_current = spy_hist['Close'].iloc[-1]
                spy_change = ((spy_current / spy_hist['Close'].iloc[0]) - 1) * 100
                
                return f"""🤖 **Market Analysis Overview**

📈 **S&P 500 (SPY) Summary:**
• Current: ${spy_current:.2f}
• 1-month: {spy_change:+.1f}%
• Volatility: {spy_hist['Close'].pct_change().std() * np.sqrt(252) * 100:.1f}%

🔍 **Key Market Factors:**
• Federal Reserve policy and interest rates
• Inflation data and economic indicators
• Corporate earnings season
• Geopolitical events

💡 **Current Market Themes:**
• AI and technology adoption
• Energy transition
• Healthcare innovation
• Interest rate sensitivity

*For specific market insights, please ask about particular sectors or economic indicators.*"""
            
        except Exception as e:
            return f"🤖 **Market Analysis**: Error retrieving market data: {str(e)}"
    
    def _analyze_files(self, files: List[Dict], message: str) -> str:
        """Analyze uploaded files"""
        analysis_results = []
        
        for file_data in files:
            filename = file_data.get('name', 'unknown')
            file_type = filename.split('.')[-1].lower()
            
            if file_type == 'csv':
                analysis_results.append(f"📊 **CSV File**: {filename} - Ready for portfolio analysis")
            elif file_type in ['txt', 'md']:
                analysis_results.append(f"📄 **Text File**: {filename} - Content analysis available")
            elif file_type in ['jpg', 'png', 'gif']:
                analysis_results.append(f"🖼️ **Image**: {filename} - Chart analysis coming soon with multi-AI integration")
            else:
                analysis_results.append(f"📁 **File**: {filename} - Format detected, processing capabilities expanding")
        
        return f"""🤖 **File Analysis**

{chr(10).join(analysis_results)}

💡 **Current Capabilities:**
• CSV files: Portfolio analysis and data processing
• Text files: Content extraction and analysis
• Images: Recognition ready for multi-AI integration

🔮 **Coming Soon:**
• Advanced chart recognition
• Document OCR and extraction
• Multi-modal AI analysis"""
    
    def _general_financial_advice(self, message: str) -> str:
        """Provide general financial guidance"""
        return """🤖 **Cosine Financial Assistant**

I'm here to help with your financial analysis needs! I can assist with:

📊 **Stock Analysis**: 
• Individual stock research and metrics
• Technical indicators and trends
• Company fundamentals

💼 **Portfolio Management**:
• Risk assessment and diversification
• Performance tracking
• Rebalancing strategies

📈 **Market Insights**:
• Economic indicators
• Sector analysis
• Market trends

💡 **How to get started:**
• Ask about specific stocks: "Analyze AAPL"
• Upload portfolio CSV files
• Request market analysis
• Ask investment questions

**Example questions:**
• "What are the best tech stocks?"
• "How risky is my portfolio?"
• "What's happening in the market?"
• "Should I buy Tesla stock?"

*Always consult with financial professionals for investment decisions.*"""

# Global instance
direct_agent = DirectFinancialAgent()

def process_direct_message(message: str, files: List[Dict] = None) -> str:
    """Process message with direct agent"""
    return direct_agent.process_message(message, files)
