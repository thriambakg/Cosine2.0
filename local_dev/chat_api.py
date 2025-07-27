#!/usr/bin/env python3
"""
Cosine Chat API Interface
Direct integration with agent.py for chat functionality with file upload support
"""

import sys
import os
import json
import base64
import tempfile
import mimetypes
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from datetime import datetime

# Add the backend path to sys.path
backend_path = Path(__file__).parent.parent / "backend_app" / "src" / "Chat"
sys.path.append(str(backend_path))

class ChatPayload:
    """Structure for chat messages with file support"""
    
    def __init__(self, data: Dict[str, Any]):
        self.message = data.get('message', '')
        self.message_type = data.get('type', 'text')  # text, image, file
        self.files = data.get('files', [])
        self.images = data.get('images', [])
        self.conversation_id = data.get('conversation_id')
        self.timestamp = data.get('timestamp', datetime.now().isoformat())
        self.metadata = data.get('metadata', {})

    def to_dict(self) -> Dict[str, Any]:
        return {
            'message': self.message,
            'type': self.message_type,
            'files': self.files,
            'images': self.images,
            'conversation_id': self.conversation_id,
            'timestamp': self.timestamp,
            'metadata': self.metadata
        }

class FileHandler:
    """Handle file uploads and processing"""
    
    ALLOWED_FILE_TYPES = {
        'text': ['.txt', '.md', '.csv', '.json', '.py', '.js', '.html', '.css'],
        'image': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
        'document': ['.pdf', '.docx', '.xlsx', '.pptx'],
        'data': ['.csv', '.json', '.xlsx', '.xml']
    }
    
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
    
    @staticmethod
    def validate_file(file_data: Dict[str, Any]) -> bool:
        """Validate uploaded file"""
        try:
            filename = file_data.get('name', '')
            file_size = file_data.get('size', 0)
            
            # Check file size
            if file_size > FileHandler.MAX_FILE_SIZE:
                return False
            
            # Check file extension
            file_ext = Path(filename).suffix.lower()
            all_allowed = []
            for ext_list in FileHandler.ALLOWED_FILE_TYPES.values():
                all_allowed.extend(ext_list)
            
            return file_ext in all_allowed
            
        except Exception:
            return False
    
    @staticmethod
    def process_file(file_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process uploaded file and extract content"""
        try:
            filename = file_data.get('name', '')
            content_b64 = file_data.get('content', '')
            file_type = file_data.get('type', '')
            
            # Decode base64 content
            content_bytes = base64.b64decode(content_b64)
            
            # Determine file category
            file_ext = Path(filename).suffix.lower()
            category = 'unknown'
            for cat, extensions in FileHandler.ALLOWED_FILE_TYPES.items():
                if file_ext in extensions:
                    category = cat
                    break
            
            result = {
                'name': filename,
                'type': file_type,
                'category': category,
                'size': len(content_bytes),
                'extension': file_ext,
                'content': None,
                'error': None
            }
            
            # Process based on category
            if category == 'text':
                try:
                    result['content'] = content_bytes.decode('utf-8')
                except UnicodeDecodeError:
                    result['content'] = content_bytes.decode('latin-1')
                    
            elif category == 'image':
                # For images, keep as base64 for now
                result['content'] = content_b64
                result['description'] = f"Image file: {filename}"
                
            elif category == 'data':
                if file_ext == '.csv':
                    import pandas as pd
                    import io
                    try:
                        df = pd.read_csv(io.BytesIO(content_bytes))
                        result['content'] = {
                            'preview': df.head(10).to_dict(),
                            'shape': df.shape,
                            'columns': list(df.columns),
                            'summary': df.describe().to_dict() if df.select_dtypes(include=[np.number]).shape[1] > 0 else None
                        }
                    except Exception as e:
                        result['error'] = f"Error reading CSV: {str(e)}"
                        
                elif file_ext == '.json':
                    try:
                        result['content'] = json.loads(content_bytes.decode('utf-8'))
                    except Exception as e:
                        result['error'] = f"Error reading JSON: {str(e)}"
            
            return result
            
        except Exception as e:
            return {
                'name': filename,
                'error': f"Error processing file: {str(e)}"
            }

class CosineChatsAPI:
    """Main chat API interface"""
    
    def __init__(self):
        self.agent_available = False
        self.financial_agent = None
        self.tools = None
        self.file_handler = FileHandler()
        
        # Try to import and initialize the agent
        self._initialize_agent()
    
    def _initialize_agent(self):
        """Initialize the financial agent with multiple fallback strategies"""
        try:
            # Strategy 1: Try to import the full agent module
            import agent as agent_module
            
            # Check what's available in the agent module
            if hasattr(agent_module, 'financial_agent'):
                self.financial_agent = agent_module.financial_agent
                self.agent_available = True
                print("✅ Full Strands financial agent loaded successfully")
                return
                
            elif hasattr(agent_module, 'FinancialTools'):
                # Create a basic agent using available tools
                self.tools = agent_module.FinancialTools()
                self.agent_available = True
                print("✅ Financial tools loaded, creating basic agent")
                return
                
        except ImportError as e:
            print(f"⚠️  Could not import agent module: {e}")
        
        # Strategy 2: Use direct agent as fallback
        try:
            from direct_agent import process_direct_message, direct_agent
            self.direct_agent = direct_agent
            self.process_direct = process_direct_message
            self.agent_available = True
            print("✅ Direct financial agent loaded as fallback")
            return
            
        except ImportError as e2:
            print(f"⚠️  Could not import direct agent: {e2}")
        
        # Strategy 3: Simulation mode
        self.agent_available = False
        print("⚠️  All agent strategies failed, using simulation mode")
    
    def process_chat_payload(self, payload_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process a chat payload and return response"""
        try:
            payload = ChatPayload(payload_data)
            
            # Build context from message and files
            context = self._build_context(payload)
            
            # Process with agent or fallback
            if self.agent_available and self.financial_agent:
                response = self._process_with_agent(context, payload)
            elif self.agent_available and self.tools:
                response = self._process_with_tools(context, payload)
            elif self.agent_available and hasattr(self, 'direct_agent'):
                response = self._process_with_direct_agent(context, payload)
            else:
                response = self._simulate_response(context, payload)
            
            return {
                'success': True,
                'response': response,
                'timestamp': datetime.now().isoformat(),
                'agent_status': 'active' if self.agent_available else 'simulation',
                'processed_files': len(payload.files),
                'processed_images': len(payload.images)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'response': "I encountered an error processing your request. Please try again.",
                'timestamp': datetime.now().isoformat()
            }
    
    def _build_context(self, payload: ChatPayload) -> str:
        """Build context string from message and files"""
        context_parts = []
        
        # Add main message
        if payload.message:
            context_parts.append(f"User Message: {payload.message}")
        
        # Process uploaded files
        for file_data in payload.files:
            if self.file_handler.validate_file(file_data):
                processed_file = self.file_handler.process_file(file_data)
                
                if processed_file.get('error'):
                    context_parts.append(f"File Error: {processed_file['error']}")
                else:
                    file_context = f"\\nUploaded File: {processed_file['name']} ({processed_file['category']})"
                    
                    if processed_file['category'] == 'text':
                        file_context += f"\\nContent: {processed_file['content'][:1000]}..."
                    elif processed_file['category'] == 'data':
                        if 'preview' in processed_file['content']:
                            file_context += f"\\nData Preview: {processed_file['content']['preview']}"
                    elif processed_file['category'] == 'image':
                        file_context += f"\\nImage Description: {processed_file['description']}"
                    
                    context_parts.append(file_context)
        
        # Process images
        for image_data in payload.images:
            context_parts.append(f"\\nImage uploaded: {image_data.get('name', 'unnamed')} - AI image analysis will be added in future updates")
        
        return "\\n".join(context_parts)
    
    def _process_with_agent(self, context: str, payload: ChatPayload) -> str:
        """Process using the full financial agent"""
        try:
            # Enhance the context with instructions for file handling
            enhanced_context = context
            
            if payload.files or payload.images:
                enhanced_context += "\\n\\nNote: The user has uploaded files/images. Please acknowledge them and provide relevant analysis based on the content provided."
            
            response = self.financial_agent(enhanced_context)
            
            # Format response for chat
            if len(response) > 2000:
                response = response[:2000] + "\\n\\n[Response truncated for chat display]"
            
            return f"🤖 **Cosine Financial Agent**\\n\\n{response}"
            
        except Exception as e:
            return f"🤖 **Cosine Financial Agent** (Error Recovery)\\n\\nI encountered an issue: {str(e)}\\n\\nPlease try rephrasing your question or contact support."
    
    def _process_with_direct_agent(self, context: str, payload: ChatPayload) -> str:
        """Process using the direct financial agent"""
        try:
            # Extract files for direct agent processing
            processed_files = []
            for file_data in payload.files:
                if self.file_handler.validate_file(file_data):
                    processed_file = self.file_handler.process_file(file_data)
                    if not processed_file.get('error'):
                        processed_files.append(processed_file)
            
            # Use direct agent
            response = self.process_direct(payload.message, processed_files)
            
            return response
            
        except Exception as e:
            return f"🤖 **Direct Agent Error**: {str(e)}\\n\\nI'm experiencing technical difficulties. Please try rephrasing your question."
    
    def _process_with_tools(self, context: str, payload: ChatPayload) -> str:
        """Process using basic financial tools"""
        try:
            # Extract potential ticker symbols
            import re
            context_upper = context.upper()
            ticker_pattern = r'\\b[A-Z]{1,5}\\b'
            potential_tickers = re.findall(ticker_pattern, context_upper)
            
            # Common stock tickers
            known_tickers = ['AAPL', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'SPY', 'QQQ', 'META', 'NFLX']
            found_tickers = [t for t in potential_tickers if t in known_tickers]
            
            if found_tickers:
                ticker = found_tickers[0]
                try:
                    analysis = self.tools.analyze_stock(ticker)
                    return f"🤖 **Cosine Financial Tools**\\n\\n📊 **{ticker} Analysis**:\\n{analysis}"
                except Exception as e:
                    return f"🤖 **Cosine Financial Tools**\\n\\nI couldn't analyze {ticker} right now: {str(e)}"
            
            return f"""🤖 **Cosine Financial Tools**\\n\\nI have basic financial analysis capabilities available. Please specify a stock ticker (AAPL, TSLA, MSFT, etc.) for analysis.\\n\\nYour message: {payload.message}"""
            
        except Exception as e:
            return f"🤖 **Cosine Financial Tools** (Error)\\n\\nError: {str(e)}"
    
    def _simulate_response(self, context: str, payload: ChatPayload) -> str:
        """Provide simulation response when agent is not available"""
        message_lower = payload.message.lower()
        
        # Check for file uploads
        if payload.files or payload.images:
            file_response = "📁 **File Upload Detected**\\n\\n"
            if payload.files:
                file_response += f"Received {len(payload.files)} file(s). "
            if payload.images:
                file_response += f"Received {len(payload.images)} image(s). "
            
            file_response += "\\n\\n🔮 **Future Capabilities**: Once additional AI models are integrated, I'll be able to:\\n"
            file_response += "• Analyze spreadsheet data and generate insights\\n"
            file_response += "• Process images and charts for financial analysis\\n"
            file_response += "• Extract data from documents and PDFs\\n"
            file_response += "• Provide multimodal financial analysis\\n\\n"
        else:
            file_response = ""
        
        # Standard simulation responses
        if any(word in message_lower for word in ['aapl', 'apple']):
            return file_response + """🤖 **Apple Inc. (AAPL) - Enhanced Simulation**

📊 **Current Focus Areas**:
• iPhone 15 and AI integration
• Services revenue growth (App Store, iCloud, Apple Pay)
• Vision Pro headset market adoption
• China market performance

📈 **Technical Indicators to Watch**:
• Support levels around $170-175
• RSI typically ranges 30-70
• Moving averages for trend confirmation

💡 **Key Catalysts**:
• Quarterly earnings reports
• iPhone sales data
• AI feature announcements
• China sales trends

*Note: This is educational content. Real-time analysis requires the full agent system.*"""
        
        elif any(word in message_lower for word in ['portfolio', 'risk']):
            return file_response + """🤖 **Portfolio Analysis Framework** (Simulation)

📊 **Risk Assessment Components**:
• **Diversification**: Sector, geographic, asset class spread
• **Correlation**: How holdings move together
• **Volatility**: Standard deviation of returns
• **Sharpe Ratio**: Risk-adjusted performance

📈 **Key Metrics to Track**:
• Beta (market sensitivity)
• Alpha (outperformance vs benchmark)
• Maximum drawdown
• Value at Risk (VaR)

💡 **Rebalancing Triggers**:
• Significant allocation drift (>5%)
• Major market events
• Life changes or goal adjustments
• Tax loss harvesting opportunities

*With full capabilities, I could analyze your actual portfolio data from uploaded files.*"""
        
        else:
            return file_response + """🤖 **Cosine AI Assistant** (Enhanced Mode)

I'm ready to help with financial analysis! Here's what I can assist with:

📊 **Available Analysis**:
• Stock fundamental and technical analysis
• Portfolio optimization and risk assessment
• Market trend analysis and economic indicators
• Investment strategy development

🔮 **Coming Soon - Multi-AI Integration**:
• Advanced document processing with specialized AI models
• Image recognition for charts and financial documents
• Real-time data integration across multiple sources
• Enhanced natural language processing for complex queries

💡 **Try asking about**:
• Specific stocks (AAPL, TSLA, MSFT)
• Portfolio analysis concepts
• Market trends and economic factors
• Investment strategies

*Upload files or images to test the enhanced interface - more AI models will be integrated soon!*"""

# Global instance
chat_api = CosineChatsAPI()

def process_chat_message(payload_data: Dict[str, Any]) -> Dict[str, Any]:
    """Main function to process chat messages"""
    return chat_api.process_chat_payload(payload_data)
