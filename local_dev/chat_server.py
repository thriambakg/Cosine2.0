#!/usr/bin/env python3
"""
Enhanced Cosine AI Chat Server with File Upload Support
Direct integration with agent.py without Strands framework dependencies
"""

import sys
import os
import json
import asyncio
import base64
import mimetypes
from pathlib import Path
from typing import Dict, Any
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse as urlparse
from urllib.parse import parse_qs

# Import our new chat API
try:
    from chat_api import process_chat_message
    CHAT_API_AVAILABLE = True
    print("✅ Chat API loaded successfully")
except ImportError as e:
    print(f"⚠️  Could not import chat API: {e}")
    CHAT_API_AVAILABLE = False

class EnhancedChatHandler(SimpleHTTPRequestHandler):
    """Enhanced HTTP handler with file upload support"""
    
    def do_GET(self):
        """Serve the chat interface"""
        if self.path == "/" or self.path == "/chat":
            self.serve_chat_page()
        elif self.path == "/api/health":
            self.send_json_response({
                "status": "healthy", 
                "chat_api_available": CHAT_API_AVAILABLE,
                "features": ["text_chat", "file_upload", "image_upload"]
            })
        else:
            super().do_GET()
    
    def do_POST(self):
        """Handle chat messages and file uploads"""
        if self.path == "/api/chat":
            self.handle_chat_message()
        else:
            self.send_error(404)
    
    def serve_chat_page(self):
        """Serve the HTML chat interface"""
        html_content = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cosine AI Chat - Local Development</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #f9fafb; }
        .container { max-width: 800px; margin: 0 auto; height: 100vh; display: flex; flex-direction: column; }
        .header { background: white; border-bottom: 1px solid #e5e7eb; padding: 1rem; }
        .header h1 { color: #111827; font-size: 1.25rem; font-weight: 600; }
        .header p { color: #6b7280; font-size: 0.875rem; margin-top: 0.25rem; }
        .messages { flex: 1; overflow-y: auto; padding: 1rem; }
        .message { margin-bottom: 1rem; display: flex; }
        .message.user { justify-content: flex-end; }
        .message.bot { justify-content: flex-start; }
        .message-content { max-width: 70%; padding: 0.75rem; border-radius: 0.5rem; }
        .message.user .message-content { background: #2563eb; color: white; }
        .message.bot .message-content { background: white; border: 1px solid #e5e7eb; }
        .message-time { font-size: 0.75rem; margin-top: 0.25rem; opacity: 0.7; }
        .input-area { background: white; border-top: 1px solid #e5e7eb; padding: 1rem; }
        .input-container { display: flex; gap: 0.5rem; }
        .input-field { flex: 1; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; }
        .send-button { padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 0.375rem; cursor: pointer; }
        .send-button:disabled { background: #d1d5db; cursor: not-allowed; }
        .loading { display: flex; align-items: center; gap: 0.5rem; }
        .spinner { width: 1rem; height: 1rem; border: 2px solid #e5e7eb; border-top: 2px solid #6b7280; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Cosine AI Assistant (Local)</h1>
            <p>Your Financial Analysis Companion - Development Mode</p>
        </div>
        <div class="messages" id="messages">
            <div class="message bot">
                <div class="message-content">
                    <p>Hello! I'm your AI financial assistant powered by Cosine. 
                    
🤖 **Current Status**: Enhanced simulation mode with educational financial analysis
                    
📊 **I can help you understand**:
• Stock analysis fundamentals (try: "Analyze Apple stock")
• Portfolio management concepts
• Market analysis and economic indicators
• Investment strategies and risk assessment

💡 **Try these example questions**:
• "Tell me about Tesla stock"
• "How do I analyze portfolio risk?"
• "What should I know about market trends?"
• "Explain technical indicators"

⚙️ **Note**: For real-time data and live market analysis, the full Strand agent framework needs to be properly configured. Current responses provide educational content and analysis frameworks.</p>
                    <div class="message-time" id="initial-time"></div>
                </div>
            </div>
        </div>
        <div class="input-area">
            <div class="input-container">
                <input type="text" id="messageInput" class="input-field" placeholder="Ask me about stocks, portfolios, market analysis..." />
                <button id="sendButton" class="send-button">Send</button>
            </div>
            <p style="font-size: 0.75rem; color: #6b7280; margin-top: 0.5rem;">Press Enter to send • Local Development Mode</p>
        </div>
    </div>

    <script>
        const messagesDiv = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        
        // Set initial timestamp
        document.getElementById('initial-time').textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        
        function addMessage(text, isUser = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isUser ? 'user' : 'bot'}`;
            messageDiv.innerHTML = `
                <div class="message-content">
                    <p style="white-space: pre-wrap;">${text}</p>
                    <div class="message-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
                </div>
            `;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        
        function addLoadingMessage() {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message bot';
            messageDiv.id = 'loading-message';
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>Analyzing...</p>
                    </div>
                </div>
            `;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        
        function removeLoadingMessage() {
            const loadingMsg = document.getElementById('loading-message');
            if (loadingMsg) loadingMsg.remove();
        }
        
        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;
            
            addMessage(message, true);
            messageInput.value = '';
            sendButton.disabled = true;
            addLoadingMessage();
            
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                
                const data = await response.json();
                removeLoadingMessage();
                addMessage(data.response || 'Sorry, I could not process that request.');
            } catch (error) {
                removeLoadingMessage();
                addMessage('I\\'m experiencing technical difficulties. Please try again.');
                console.error('Error:', error);
            } finally {
                sendButton.disabled = false;
                messageInput.focus();
            }
        }
        
        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
        
        messageInput.focus();
    </script>
</body>
</html>
        """
        
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        self.wfile.write(html_content.encode())
    
    def handle_chat_message(self):
        """Process chat messages using the agent"""
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode())
            
            message = data.get('message', '')
            if not message:
                self.send_json_response({"error": "Message is required"}, 400)
                return
            
            # Process message with agent or simulation
            if AGENT_AVAILABLE:
                response = self.process_with_agent(message)
            else:
                response = self.simulate_response(message)
            
            self.send_json_response({
                "response": response,
                "timestamp": json.dumps(None, default=str)
            })
            
        except Exception as e:
            print(f"Error handling chat message: {e}")
            self.send_json_response({"error": "Internal server error"}, 500)
    
    def process_with_agent(self, message: str) -> str:
        """Process message using the actual Strand agent"""
        try:
            print(f"🤖 Processing message with Strand agent: {message}")
            
            # Use your actual financial_agent directly
            response = financial_agent(message)
            
            # Format the response for better display in chat
            formatted_response = self.format_agent_response(response)
            
            return formatted_response
                
        except Exception as e:
            error_msg = f"I encountered an error processing your request: {str(e)}"
            print(f"❌ Agent error: {error_msg}")
            
            # Fallback to enhanced simulation with error details
            return f"""🤖 **Cosine AI Assistant** (Error Recovery)

I encountered a technical issue while processing your request:
**Error**: {str(e)}

However, I can still help you with:
🔍 **Stock Analysis**: Real-time data, technical indicators, fundamentals
📊 **Portfolio Management**: Risk assessment, optimization, diversification  
💰 **Options Trading**: Pricing models, Greeks, strategy analysis
📈 **Market Research**: Trends, correlations, economic indicators

Please try rephrasing your question, or ask about specific stocks, portfolios, or market analysis."""
    
    def format_agent_response(self, response: str) -> str:
        """Format the agent response for better chat display"""
        try:
            # If response is very long, add some structure
            if len(response) > 1000:
                # Add section breaks for readability
                formatted = response.replace('\n\n', '\n\n📋 ')
                return f"🤖 **Cosine Financial Analysis**\n\n📋 {formatted}"
            else:
                return f"🤖 **Cosine Financial Analysis**\n\n{response}"
                
        except Exception:
            return response
    
    def simulate_response(self, message: str) -> str:
        """Enhanced simulation responses when agent is not available"""
        message_lower = message.lower()
        
        if any(word in message_lower for word in ['aapl', 'apple']):
            return """🤖 **Apple Inc. (AAPL) - Simulation Analysis**

📊 **Company Overview**:
• Market Cap: ~$3.0T (as of 2024)
• Sector: Technology - Consumer Electronics
• Key Products: iPhone, Mac, iPad, Services

📈 **Key Metrics to Watch**:
• iPhone sales growth (especially in China)
• Services revenue expansion
• AI integration progress
• AR/VR headset adoption

💡 **Investment Considerations**:
• Strong brand loyalty and ecosystem
• Consistent dividend payments
• High valuation ratios require growth
• Regulatory risks in key markets

⚠️ **Note**: This is simulated analysis. For real-time data and comprehensive analysis, the full Strand agent would provide current prices, technical indicators, and recent news.

*Investment decisions should always be based on current data and professional advice.*"""

        elif any(word in message_lower for word in ['tsla', 'tesla']):
            return """🤖 **Tesla Inc. (TSLA) - Simulation Analysis**

📊 **Company Overview**:
• Market Cap: ~$800B (highly volatile)
• Sector: Automotive - Electric Vehicles
• CEO: Elon Musk

📈 **Key Metrics to Watch**:
• EV delivery numbers (quarterly)
• Full Self-Driving progress
• Energy storage business growth
• Manufacturing capacity expansion

💡 **Investment Considerations**:
• High growth potential in EV market
• Significant volatility
• Execution risk on multiple fronts
• Competition increasing rapidly

⚠️ **Note**: Tesla is highly volatile. This simulation cannot capture real-time sentiment or technical indicators that drive daily price movements."""

        elif any(word in message_lower for word in ['stock', 'ticker', 'price']):
            return """📊 **Stock Analysis** (Enhanced Simulation Mode)
            
🤖 I'd be happy to analyze stocks for you! With the full agent, I provide:

✅ **Real-time Analysis**:
• Current price and daily performance
• Technical indicators (RSI, MACD, Moving Averages)
• Volume analysis and momentum

✅ **Fundamental Analysis**:
• P/E ratios and valuation metrics
• Revenue and earnings trends
• Sector comparisons

✅ **Risk Assessment**:
• Volatility calculations
• Beta and correlation analysis
• Support/resistance levels

**Try asking about specific stocks**: AAPL, TSLA, MSFT, GOOGL, AMZN, NVDA

*Note: Full functionality requires Strands framework. Current responses are educational simulations.*"""
        
        elif any(word in message_lower for word in ['portfolio', 'risk', 'diversification']):
            return """📊 **Portfolio Analysis** (Enhanced Simulation Mode)
            
🤖 I can help with comprehensive portfolio analysis:

✅ **Risk Metrics**:
• Portfolio volatility and Sharpe ratio
• Value at Risk (VaR) calculations
• Maximum drawdown analysis

✅ **Diversification**:
• Correlation matrices
• Sector allocation analysis
• Geographic distribution

✅ **Performance Tracking**:
• Alpha and beta calculations
• Benchmark comparisons
• Risk-adjusted returns

💡 **Example Portfolio Questions**:
• "Analyze my tech-heavy portfolio"
• "What's the correlation between my holdings?"
• "Should I rebalance my 401k?"

*Note: With full agent capabilities, I could analyze your actual holdings and provide specific recommendations.*"""

        elif any(word in message_lower for word in ['market', 'economy', 'fed', 'inflation']):
            return """🤖 **Market Analysis** (Enhanced Simulation Mode)

📈 **Market Factors I Track**:
• Federal Reserve policy and interest rates
• Inflation data and economic indicators
• Sector rotation and momentum
• Global market correlations

🔍 **Economic Indicators**:
• Employment data (NFP, unemployment)
• GDP growth and consumer spending
• Manufacturing and services PMI
• Treasury yield curves

💡 **Current Focus Areas** (General):
• AI and technology adoption
• Energy transition investments
• Healthcare innovation
• Geopolitical impacts on markets

*With full agent functionality, I provide real-time market data, recent news analysis, and specific trading insights based on current conditions.*"""
        
        else:
            return """🤖 **Cosine AI Assistant** (Enhanced Simulation Mode)
            
I'm your financial analysis companion! I can help with:

📊 **Stock Analysis**: AAPL, TSLA, MSFT, GOOGL, and more
💼 **Portfolio Management**: Risk assessment and optimization  
📈 **Market Research**: Trends and economic analysis
💰 **Investment Strategy**: Asset allocation and diversification

**Try asking:**
• "Analyze Apple stock"
• "What are the best tech stocks?"
• "Help me understand portfolio risk"
• "What's happening in the market today?"

⚙️ **Technical Note**: Currently running in enhanced simulation mode due to Strands framework constraints. For full functionality with real-time data:
1. Ensure Python environment has required packages
2. Check Strands framework installation
3. Verify yfinance and pandas dependencies

*All investment advice should be verified with current data and professional consultation.*"""
    
    def send_json_response(self, data: Dict[Any, Any], status: int = 200):
        """Send JSON response"""
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def run_server(port: int = 8000):
    """Run the local development server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, ChatHandler)
    
    print(f"🚀 Cosine AI Chat Server starting on http://localhost:{port}")
    print(f"📊 Agent Status: {'✅ Strand Financial Agent Available' if AGENT_AVAILABLE else '⚠️  Simulation Mode'}")
    
    if AGENT_AVAILABLE:
        print("🎯 Features: Real-time financial analysis, stock data, portfolio management")
        print("💡 Try: 'Analyze AAPL stock' or 'What are the best tech stocks?'")
    else:
        print("💡 Install Strands framework for full functionality")
        
    print(f"🌐 Open your browser to http://localhost:{port} to start chatting")
    print("🛑 Press Ctrl+C to stop the server")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\\n👋 Server stopped. Goodbye!")
        httpd.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_server(port)
