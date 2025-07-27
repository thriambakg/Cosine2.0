#!/usr/bin/env python3
"""
Enhanced Cosine AI Chat Server with File Upload Support
Direct integration with agent.py without Strands framework dependencies
"""

import sys
import os
import json
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
    print("✅ Enhanced Chat API loaded successfully")
except ImportError as e:
    print(f"⚠️  Could not import enhanced chat API: {e}")
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
                "features": ["text_chat", "file_upload", "image_upload", "multi_ai_ready"]
            })
        else:
            super().do_GET()
    
    def do_POST(self):
        """Handle chat messages and file uploads"""
        if self.path == "/api/chat":
            self.handle_enhanced_chat_message()
        else:
            self.send_error(404)
    
    def serve_chat_page(self):
        """Serve the enhanced HTML chat interface with file upload support"""
        html_content = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cosine AI Chat - Enhanced Interface</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #f9fafb; }
        .container { max-width: 900px; margin: 0 auto; height: 100vh; display: flex; flex-direction: column; }
        
        .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            padding: 1.5rem; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
        }
        .header h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
        .header p { opacity: 0.9; font-size: 0.9rem; }
        .status-badges { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
        .badge { 
            padding: 0.25rem 0.75rem; 
            border-radius: 1rem; 
            font-size: 0.75rem; 
            font-weight: 500; 
            background: rgba(255,255,255,0.2); 
        }
        
        .messages { 
            flex: 1; 
            overflow-y: auto; 
            padding: 1rem; 
            background: #f8fafc; 
        }
        .message { margin-bottom: 1rem; display: flex; }
        .message.user { justify-content: flex-end; }
        .message.bot { justify-content: flex-start; }
        .message-content { 
            max-width: 75%; 
            padding: 1rem; 
            border-radius: 1rem; 
            line-height: 1.6; 
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .message.user .message-content { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
        }
        .message.bot .message-content { 
            background: white; 
            border: 1px solid #e2e8f0; 
        }
        .message-time { font-size: 0.75rem; margin-top: 0.5rem; opacity: 0.7; }
        
        .input-area { 
            background: white; 
            border-top: 1px solid #e2e8f0; 
            padding: 1rem; 
            box-shadow: 0 -2px 10px rgba(0,0,0,0.05); 
        }
        
        .file-upload-area {
            margin-bottom: 1rem;
            padding: 0.75rem;
            border: 2px dashed #cbd5e0;
            border-radius: 0.5rem;
            background: #f8fafc;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
        }
        .file-upload-area:hover { border-color: #667eea; background: #f1f5f9; }
        .file-upload-area.dragover { border-color: #667eea; background: #e0e7ff; }
        
        .uploaded-files {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
        }
        .file-tag {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.25rem 0.5rem;
            background: #e2e8f0;
            border-radius: 0.375rem;
            font-size: 0.75rem;
        }
        .file-tag .remove { cursor: pointer; color: #ef4444; font-weight: bold; }
        
        .input-container { display: flex; gap: 0.5rem; align-items: flex-end; }
        .input-field { 
            flex: 1; 
            padding: 0.75rem; 
            border: 1px solid #d1d5db; 
            border-radius: 0.5rem; 
            font-size: 0.875rem;
            resize: vertical;
            min-height: 2.5rem;
            max-height: 6rem;
        }
        .input-field:focus { 
            outline: none; 
            border-color: #667eea; 
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1); 
        }
        
        .send-button { 
            padding: 0.75rem 1.5rem; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            border: none; 
            border-radius: 0.5rem; 
            cursor: pointer; 
            font-weight: 500;
            transition: transform 0.1s;
        }
        .send-button:hover { transform: translateY(-1px); }
        .send-button:disabled { 
            background: #d1d5db; 
            cursor: not-allowed; 
            transform: none;
        }
        
        .loading { display: flex; align-items: center; gap: 0.5rem; }
        .spinner { 
            width: 1rem; 
            height: 1rem; 
            border: 2px solid #e5e7eb; 
            border-top: 2px solid #667eea; 
            border-radius: 50%; 
            animation: spin 1s linear infinite; 
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        .feature-hint {
            font-size: 0.75rem;
            color: #6b7280;
            margin-top: 0.5rem;
            text-align: center;
        }
        
        #fileInput { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Cosine AI Financial Assistant</h1>
            <p>Enhanced Chat Interface with File Upload Support</p>
            <div class="status-badges">
                <div class="badge">💬 Chat Ready</div>
                <div class="badge">📁 File Upload</div>
                <div class="badge">🖼️ Image Support</div>
                <div class="badge">🔮 Multi-AI Ready</div>
            </div>
        </div>
        
        <div class="messages" id="messages">
            <div class="message bot">
                <div class="message-content">
                    <p><strong>🚀 Welcome to Enhanced Cosine AI!</strong></p>
                    <p>I'm your advanced financial assistant with enhanced capabilities:</p>
                    <br>
                    <p><strong>💬 Chat Features:</strong></p>
                    <p>• Natural language financial analysis</p>
                    <p>• Stock analysis and market insights</p>
                    <p>• Portfolio optimization guidance</p>
                    <br>
                    <p><strong>📁 File Upload Support:</strong></p>
                    <p>• CSV files for portfolio analysis</p>
                    <p>• Text files for document analysis</p>
                    <p>• Images for chart interpretation (coming soon)</p>
                    <br>
                    <p><strong>🎯 Try asking:</strong></p>
                    <p>• "Analyze Apple stock"</p>
                    <p>• "Help me understand portfolio risk"</p>
                    <p>• Upload a CSV with your holdings!</p>
                    <div class="message-time" id="initial-time"></div>
                </div>
            </div>
        </div>
        
        <div class="input-area">
            <div class="file-upload-area" id="fileUploadArea">
                <p>📁 Drop files here or <strong>click to upload</strong></p>
                <p style="font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem;">
                    Supports: CSV, TXT, JSON, Images (JPG, PNG) • Max 10MB
                </p>
            </div>
            
            <div class="uploaded-files" id="uploadedFiles"></div>
            
            <div class="input-container">
                <textarea id="messageInput" class="input-field" placeholder="Ask me about stocks, upload files for analysis, or request market insights..." rows="1"></textarea>
                <button id="sendButton" class="send-button">Send</button>
            </div>
            
            <div class="feature-hint">
                Press Enter to send • Drop files to upload • Enhanced AI coming soon
            </div>
            
            <input type="file" id="fileInput" multiple accept=".csv,.txt,.json,.jpg,.jpeg,.png,.gif" />
        </div>
    </div>

    <script>
        const messagesDiv = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const fileInput = document.getElementById('fileInput');
        const fileUploadArea = document.getElementById('fileUploadArea');
        const uploadedFilesDiv = document.getElementById('uploadedFiles');
        
        let uploadedFiles = [];
        
        // Set initial timestamp
        document.getElementById('initial-time').textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        
        // File upload handling
        fileUploadArea.addEventListener('click', () => fileInput.click());
        fileUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadArea.classList.add('dragover');
        });
        fileUploadArea.addEventListener('dragleave', () => {
            fileUploadArea.classList.remove('dragover');
        });
        fileUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadArea.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });
        
        fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });
        
        function handleFiles(files) {
            for (let file of files) {
                if (file.size > 10 * 1024 * 1024) {
                    addMessage(`File "${file.name}" is too large (max 10MB)`, false, 'error');
                    continue;
                }
                
                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileData = {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        content: e.target.result.split(',')[1] // Remove data:type;base64, prefix
                    };
                    
                    uploadedFiles.push(fileData);
                    displayUploadedFile(file.name);
                };
                reader.readAsDataURL(file);
            }
        }
        
        function displayUploadedFile(filename) {
            const fileTag = document.createElement('div');
            fileTag.className = 'file-tag';
            fileTag.innerHTML = `
                <span>📎 ${filename}</span>
                <span class="remove" onclick="removeFile('${filename}')">&times;</span>
            `;
            uploadedFilesDiv.appendChild(fileTag);
        }
        
        function removeFile(filename) {
            uploadedFiles = uploadedFiles.filter(f => f.name !== filename);
            updateUploadedFilesDisplay();
        }
        
        function updateUploadedFilesDisplay() {
            uploadedFilesDiv.innerHTML = '';
            uploadedFiles.forEach(file => displayUploadedFile(file.name));
        }
        
        function addMessage(text, isUser = false, type = 'normal') {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isUser ? 'user' : 'bot'}`;
            
            let contentClass = 'message-content';
            if (type === 'error') contentClass += ' error';
            
            messageDiv.innerHTML = `
                <div class="${contentClass}">
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
                        <p>Processing with enhanced AI...</p>
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
            if (!message && uploadedFiles.length === 0) return;
            
            // Show user message
            if (message) addMessage(message, true);
            
            // Show file upload info
            if (uploadedFiles.length > 0) {
                addMessage(`📁 Uploaded ${uploadedFiles.length} file(s): ${uploadedFiles.map(f => f.name).join(', ')}`, true);
            }
            
            messageInput.value = '';
            sendButton.disabled = true;
            addLoadingMessage();
            
            try {
                const payload = {
                    message: message,
                    files: uploadedFiles,
                    timestamp: new Date().toISOString(),
                    type: uploadedFiles.length > 0 ? 'multimodal' : 'text'
                };
                
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                removeLoadingMessage();
                
                if (data.success) {
                    addMessage(data.response || 'Sorry, I could not process that request.');
                    
                    // Show processing info if files were involved
                    if (data.processed_files > 0 || data.processed_images > 0) {
                        addMessage(`✅ Processed: ${data.processed_files} files, ${data.processed_images} images | Agent: ${data.agent_status}`, false, 'info');
                    }
                } else {
                    addMessage(`Error: ${data.error}`, false, 'error');
                }
                
                // Clear uploaded files after processing
                uploadedFiles = [];
                updateUploadedFilesDisplay();
                
            } catch (error) {
                removeLoadingMessage();
                addMessage('I\\'m experiencing technical difficulties. Please try again.', false, 'error');
                console.error('Error:', error);
            } finally {
                sendButton.disabled = false;
                messageInput.focus();
            }
        }
        
        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Auto-resize textarea
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 96) + 'px';
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
    
    def handle_enhanced_chat_message(self):
        """Process chat messages using the enhanced API"""
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode())
            
            print(f"📩 Received enhanced chat payload: {len(data.get('message', ''))} chars, {len(data.get('files', []))} files")
            
            # Process with enhanced API or fallback
            if CHAT_API_AVAILABLE:
                result = process_chat_message(data)
                self.send_json_response(result)
            else:
                # Fallback response
                fallback_response = {
                    'success': True,
                    'response': self.generate_fallback_response(data),
                    'timestamp': json.dumps(None, default=str),
                    'agent_status': 'fallback',
                    'processed_files': len(data.get('files', [])),
                    'processed_images': len(data.get('images', []))
                }
                self.send_json_response(fallback_response)
            
        except Exception as e:
            print(f"Error handling enhanced chat message: {e}")
            self.send_json_response({
                'success': False,
                'error': 'Internal server error',
                'response': 'I encountered an error processing your request. Please try again.'
            }, 500)
    
    def generate_fallback_response(self, data: Dict[str, Any]) -> str:
        """Generate fallback response when API is not available"""
        message = data.get('message', '')
        files = data.get('files', [])
        
        response_parts = []
        
        if files:
            response_parts.append(f"📁 **File Upload Detected**: Received {len(files)} file(s)")
            for file_data in files:
                filename = file_data.get('name', 'unknown')
                response_parts.append(f"• {filename}")
            response_parts.append("")
        
        response_parts.append("🤖 **Cosine AI Assistant** (Fallback Mode)")
        response_parts.append("")
        response_parts.append("I'm running in fallback mode. The enhanced chat API with full agent integration is being loaded.")
        response_parts.append("")
        
        if 'stock' in message.lower() or 'aapl' in message.lower():
            response_parts.append("📊 **Stock Analysis Request Detected**")
            response_parts.append("I can help with stock analysis once the full system is loaded.")
        elif files:
            response_parts.append("📈 **File Analysis**")
            response_parts.append("Your uploaded files are ready for analysis with the enhanced AI system.")
        else:
            response_parts.append("💡 **Available Soon**: Full financial analysis, file processing, and multi-AI integration.")
        
        return "\\n".join(response_parts)
    
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
    """Run the enhanced chat server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, EnhancedChatHandler)
    
    print("=" * 60)
    print("🚀 Enhanced Cosine AI Chat Server")
    print("=" * 60)
    print(f"🌐 Server URL: http://localhost:{port}")
    print(f"📊 Chat API Status: {'✅ Active' if CHAT_API_AVAILABLE else '⚠️  Fallback Mode'}")
    print("🎯 Features: Enhanced UI, File Upload, Image Support, Multi-AI Ready")
    print("💡 Try: Upload CSV files, ask about stocks, test file analysis")
    print("🛑 Press Ctrl+C to stop the server")
    print("=" * 60)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\\n\\n👋 Enhanced server stopped. Goodbye!")
        httpd.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_enhanced_server(port)
