#!/usr/bin/env python3
"""
Enhanced Cosine AI Chat Server with Strand Agent Integration
This script serves the chat interface and connects directly to your Strand-based agent
"""

import sys
import os
import json
from pathlib import Path
from typing import Dict, Any
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse as urlparse
from urllib.parse import parse_qs

# Add the backend path to sys.path
backend_path = Path(__file__).parent.parent / "backend_app" / "src" / "Chat"
sys.path.append(str(backend_path))

try:
    # Import the main agent function from your existing agent
    from agent import financial_agent, FinancialTools
    AGENT_AVAILABLE = True
    print("✅ Successfully imported Cosine Strand Financial Agent")
except ImportError as e:
    print(f"⚠️  Could not import agent: {e}")
    print("Chat will run in simulation mode")
    AGENT_AVAILABLE = False
    financial_agent = None

class EnhancedChatHandler(SimpleHTTPRequestHandler):
    """Enhanced HTTP handler for the Strand-powered chat interface"""
    
    def do_GET(self):
        """Serve the chat interface"""
        if self.path == "/" or self.path == "/chat":
            self.serve_chat_page()
        elif self.path == "/api/health":
            self.send_json_response({
                "status": "healthy", 
                "agent_available": AGENT_AVAILABLE,
                "agent_type": "strand" if AGENT_AVAILABLE else "simulation"
            })
        else:
            super().do_GET()
    
    def do_POST(self):
        """Handle chat messages"""
        if self.path == "/api/chat":
            self.handle_chat_message()
        else:
            self.send_error(404)
    
    def serve_chat_page(self):
        """Serve the HTML chat interface with dynamic content"""
        
        # Dynamic welcome message based on agent availability
        if AGENT_AVAILABLE:
            welcome_message = """Hello! I'm your AI financial assistant powered by Cosine's advanced Strand architecture. I have access to real-time market data and can provide comprehensive financial analysis including:

📊 **Real-time stock analysis** with live data from yfinance
📈 **Technical indicators** (RSI, MACD, Moving Averages) 
📰 **Financial news analysis** and market research
🧮 **Portfolio analysis** with correlation matrices
💰 **Options analysis** and derivatives pricing
🔍 **Web research** for additional market context

Try asking me: "Analyze AAPL stock", "What are the best AI stocks?", "Compare Tesla vs Ford", or "Help me analyze my portfolio"."""
            agent_status = "Strand Agent Active"
        else:
            welcome_message = """Hello! I'm your AI financial assistant powered by Cosine. I'm currently running in simulation mode but can still help you understand financial analysis concepts and guide you through market analysis.

For full functionality with real-time data, please ensure the Strands framework is properly installed."""
            agent_status = "Simulation Mode"
        
        html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cosine AI Chat - Enhanced Strand Agent</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: system-ui, -apple-system, sans-serif; background: #f9fafb; }}
        .container {{ max-width: 900px; margin: 0 auto; height: 100vh; display: flex; flex-direction: column; }}
        .header {{ background: white; border-bottom: 1px solid #e5e7eb; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .header h1 {{ color: #111827; font-size: 1.5rem; font-weight: 700; }}
        .header p {{ color: #6b7280; font-size: 0.875rem; margin-top: 0.25rem; }}
        .status-badge {{ display: inline-block; padding: 0.25rem 0.5rem; border-radius: 0.375rem; font-size: 0.75rem; font-weight: 500; margin-top: 0.5rem; }}
        .status-active {{ background: #dcfce7; color: #166534; }}
        .status-simulation {{ background: #fef3c7; color: #92400e; }}
        .messages {{ flex: 1; overflow-y: auto; padding: 1rem; }}
        .message {{ margin-bottom: 1rem; display: flex; }}
        .message.user {{ justify-content: flex-end; }}
        .message.bot {{ justify-content: flex-start; }}
        .message-content {{ max-width: 75%; padding: 1rem; border-radius: 0.75rem; line-height: 1.6; }}
        .message.user .message-content {{ background: #2563eb; color: white; }}
        .message.bot .message-content {{ background: white; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .message-time {{ font-size: 0.75rem; margin-top: 0.5rem; opacity: 0.7; }}
        .input-area {{ background: white; border-top: 1px solid #e5e7eb; padding: 1rem; box-shadow: 0 -1px 3px rgba(0,0,0,0.1); }}
        .input-container {{ display: flex; gap: 0.5rem; }}
        .input-field {{ flex: 1; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; }}
        .input-field:focus {{ outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }}
        .send-button {{ padding: 0.75rem 1.5rem; background: #2563eb; color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 500; }}
        .send-button:hover {{ background: #1d4ed8; }}
        .send-button:disabled {{ background: #d1d5db; cursor: not-allowed; }}
        .loading {{ display: flex; align-items: center; gap: 0.5rem; }}
        .spinner {{ width: 1rem; height: 1rem; border: 2px solid #e5e7eb; border-top: 2px solid #2563eb; border-radius: 50%; animation: spin 1s linear infinite; }}
        @keyframes spin {{ 0% {{ transform: rotate(0deg); }} 100% {{ transform: rotate(360deg); }} }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Cosine AI Financial Assistant</h1>
            <p>Your Advanced Financial Analysis Companion</p>
            <div class="status-badge {'status-active' if AGENT_AVAILABLE else 'status-simulation'}">
                {'✅ Strand Agent Active' if AGENT_AVAILABLE else '⚠️ Simulation Mode'}
            </div>
        </div>
        <div class="messages" id="messages">
            <div class="message bot">
                <div class="message-content">
                    <p style="white-space: pre-wrap;">{welcome_message}</p>
                    <div class="message-time" id="initial-time"></div>
                </div>
            </div>
        </div>
        <div class="input-area">
            <div class="input-container">
                <input type="text" id="messageInput" class="input-field" placeholder="Ask me about stocks, portfolios, market analysis..." />
                <button id="sendButton" class="send-button">Send</button>
            </div>
            <p style="font-size: 0.75rem; color: #6b7280; margin-top: 0.5rem;">
                Press Enter to send • {'Powered by Strand AI Agent' if AGENT_AVAILABLE else 'Running in Simulation Mode'}
            </p>
        </div>
    </div>

    <script>
        const messagesDiv = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        
        // Set initial timestamp
        document.getElementById('initial-time').textContent = new Date().toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit'}});
        
        function addMessage(text, isUser = false) {{
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${{isUser ? 'user' : 'bot'}}`;
            messageDiv.innerHTML = `
                <div class="message-content">
                    <p style="white-space: pre-wrap;">${{text}}</p>
                    <div class="message-time">${{new Date().toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit'}})}}</div>
                </div>
            `;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }}
        
        function addLoadingMessage() {{
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message bot';
            messageDiv.id = 'loading-message';
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>{'Analyzing with Strand AI...' if AGENT_AVAILABLE else 'Processing...'}</p>
                    </div>
                </div>
            `;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }}
        
        function removeLoadingMessage() {{
            const loadingMsg = document.getElementById('loading-message');
            if (loadingMsg) loadingMsg.remove();
        }}
        
        async function sendMessage() {{
            const message = messageInput.value.trim();
            if (!message) return;
            
            addMessage(message, true);
            messageInput.value = '';
            sendButton.disabled = true;
            addLoadingMessage();
            
            try {{
                const response = await fetch('/api/chat', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ message }})
                }});
                
                const data = await response.json();
                removeLoadingMessage();
                addMessage(data.response || 'Sorry, I could not process that request.');
            }} catch (error) {{
                removeLoadingMessage();
                addMessage('I\\'m experiencing technical difficulties. Please try again.');
                console.error('Error:', error);
            }} finally {{
                sendButton.disabled = false;
                messageInput.focus();
            }}
        }}
        
        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {{
            if (e.key === 'Enter') sendMessage();
        }});
        
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
        """Process chat messages using the Strand agent"""
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode())
            
            message = data.get('message', '')
            if not message:
                self.send_json_response({"error": "Message is required"}, 400)
                return
            
            print(f"📩 Received message: {message}")
            
            # Process message with agent or simulation
            if AGENT_AVAILABLE:
                response = self.process_with_strand_agent(message)
            else:
                response = self.simulate_response(message)
            
            self.send_json_response({
                "response": response,
                "timestamp": json.dumps(None, default=str)
            })
            
        except Exception as e:
            print(f"Error handling chat message: {e}")
            self.send_json_response({"error": "Internal server error"}, 500)
    
    def process_with_strand_agent(self, message: str) -> str:
        """Process message using the actual Strand agent"""
        try:
            print(f"🤖 Processing with Strand agent: {message}")
            
            # Use your actual financial_agent directly
            response = financial_agent(message)
            
            print(f"✅ Agent response length: {len(response)} characters")
            
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
            # Clean up the response and add structure
            if len(response) > 500:
                # For longer responses, add some visual structure
                formatted = response.replace('\\n\\n', '\\n\\n📋 ')
                if not formatted.startswith('🤖'):
                    formatted = f"🤖 **Cosine Financial Analysis**\\n\\n{formatted}"
                return formatted
            else:
                # For shorter responses, just ensure it has the header
                if not response.startswith('🤖'):
                    return f"🤖 **Cosine Analysis**\\n\\n{response}"
                return response
                
        except Exception:
            return response
    
    def simulate_response(self, message: str) -> str:
        """Enhanced simulation responses when agent is not available"""
        message_lower = message.lower()
        
        if any(word in message_lower for word in ['stock', 'ticker', 'price', 'aapl', 'tesla', 'nvidia', 'msft']):
            return """🤖 **Stock Analysis** (Simulation Mode)
            
I'd be happy to analyze stocks for you! With the full Strand agent, I can provide:
• **Real-time price data** and daily performance from yfinance
• **Technical indicators** like RSI, MACD, and moving averages
• **Financial metrics** including P/E ratios, market cap, and volatility
• **News analysis** and market sentiment
• **Buy/sell recommendations** based on comprehensive analysis

*Note: Currently in simulation mode. Install Strands framework for live market data and analysis.*

Try asking: "Analyze AAPL stock" or "Should I buy Tesla?"""
        
        elif any(word in message_lower for word in ['portfolio', 'risk', 'diversification', 'allocation']):
            return """🤖 **Portfolio Analysis** (Simulation Mode)
            
I can help with comprehensive portfolio analysis including:
• **Risk assessment** with volatility metrics and correlation matrices
• **Diversification analysis** across sectors and asset classes
• **Performance tracking** with Sharpe ratios and alpha/beta calculations
• **Asset allocation optimization** based on modern portfolio theory
• **Rebalancing recommendations** to maintain target allocations

*Note: Currently in simulation mode. With full agent capabilities, I can analyze your actual portfolio holdings.*

Try: "Analyze my portfolio with these holdings: [{'ticker': 'AAPL', 'shares': 100}]" """
        
        elif any(word in message_lower for word in ['options', 'derivatives', 'calls', 'puts']):
            return """🤖 **Options Analysis** (Simulation Mode)
            
I can assist with sophisticated options analysis:
• **Black-Scholes pricing** models for option valuation
• **Greeks calculation** (Delta, Gamma, Theta, Vega, Rho)
• **Implied vs historical volatility** comparison
• **Strategy evaluation** for spreads, straddles, and combinations
• **Risk/reward scenario modeling** with profit/loss charts

*Note: Currently in simulation mode. Full agent provides real-time options data.*

Try: "Analyze AAPL call options" or "What's the best options strategy for TSLA?"""
        
        else:
            return """🤖 **Cosine AI Assistant** (Simulation Mode)
            
I'm your advanced financial analysis companion! With full Strand agent capabilities, I can help with:

📊 **Stock Analysis**: Real-time data, technical indicators, company fundamentals
💼 **Portfolio Management**: Risk assessment, optimization, diversification analysis
💰 **Options Trading**: Pricing models, Greeks, strategy recommendations
📈 **Market Research**: Trends, correlations, economic indicator analysis
🔍 **Financial Research**: News analysis, earnings reports, sector comparisons

*Currently running in simulation mode. Install the Strands framework for full functionality with real-time market data.*

**Try asking me:**
• "Analyze Apple stock"
• "What are the best tech stocks right now?"
• "Help me optimize my portfolio"
• "Explain options trading strategies"""
    
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

def run_enhanced_server(port: int = 8000):
    """Run the enhanced local development server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, EnhancedChatHandler)
    
    print("=" * 60)
    print("🚀 Enhanced Cosine AI Chat Server")
    print("=" * 60)
    print(f"🌐 Server URL: http://localhost:{port}")
    
    if AGENT_AVAILABLE:
        print("✅ Status: Strand Financial Agent Active")
        print("🎯 Features: Real-time analysis, live market data, advanced tools")
        print("💡 Try: 'Analyze AAPL stock' or 'What are the best AI stocks?'")
    else:
        print("⚠️  Status: Simulation Mode") 
        print("💡 Install Strands framework for full functionality")
        print("🔧 Tip: pip install strands-core yfinance pandas numpy")
        
    print("🛑 Press Ctrl+C to stop the server")
    print("=" * 60)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\\n\\n👋 Server stopped. Goodbye!")
        httpd.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_enhanced_server(port)
