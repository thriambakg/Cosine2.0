# Cosine AI Chat Interface

This directory contains the chat interface for your AI financial assistant powered by the Strand architecture.

## 🚀 Quick Start

### For Production (Next.js Frontend)
The chat interface is integrated into your main frontend application at `/chat`:

1. Navigate to your frontend directory:
   ```bash
   cd frontend/app
   ```

2. Start the Next.js development server:
   ```bash
   npm run dev
   ```

3. Open your browser to `http://localhost:3000/chat`

### For Local Development & Testing
Use the standalone chat server for quick testing:

1. Navigate to the local_dev directory:
   ```powershell
   cd local_dev
   ```

2. Start the chat server:
   ```powershell
   .\start_chat_server.ps1
   ```

3. Open your browser to `http://localhost:8000`

## 🏗️ Architecture

### Frontend Components
- **`/frontend/app/app/chat/page.tsx`**: Main chat page component using shadcn/ui
- **`/frontend/app/app/api/chat/route.ts`**: API endpoint for chat messages
- **`/components/ui/scroll-area.tsx`**: Custom scroll area component

### Local Development
- **`chat_server.py`**: Standalone Python HTTP server for local testing
- **`chat.tsx`**: Simplified React component for standalone use
- **`start_chat_server.ps1`**: PowerShell script to start local server

## 🔧 Backend Integration

The chat interface connects to your Strand-based AI agent in `backend_app/src/Chat/agent.py`.

### Integration Options

1. **API Endpoint** (Recommended): Create a web service wrapper around your agent
2. **Direct Integration**: Call the agent directly from the API route
3. **Message Queue**: Use Redis/RabbitMQ for async communication
4. **Subprocess**: Execute the Python agent as a subprocess

### Current Implementation
- The frontend API route (`/api/chat/route.ts`) currently includes placeholder logic
- The local development server (`chat_server.py`) attempts to import and use your agent directly
- Both include fallback simulation responses when the agent is not available

## 🎨 Design Language

The chat interface follows your established design patterns:

- **Colors**: Blue primary (`#2563eb`), gray neutrals, white backgrounds
- **Typography**: System font stack, semibold headings, readable body text
- **Components**: shadcn/ui components with Tailwind CSS styling
- **Layout**: Sidebar navigation, responsive design, clean cards

## 📱 Features

### Chat Interface
- Real-time messaging with typing indicators
- Message timestamps and user/bot differentiation
- Responsive design for mobile and desktop
- Auto-scroll to latest messages
- Loading states and error handling

### AI Capabilities
Your Strand-based agent provides:
- **Stock Analysis**: Real-time data, technical indicators, fundamentals
- **Portfolio Management**: Risk assessment, diversification, optimization
- **Options Trading**: Pricing models, Greeks, strategy analysis
- **Market Research**: Trends, correlations, economic indicators
- **Crypto Analysis**: Digital asset metrics and market data

## 🔌 API Reference

### POST `/api/chat`
Send a message to the AI assistant.

**Request:**
```json
{
  "message": "What's the current price of AAPL?"
}
```

**Response:**
```json
{
  "response": "📊 AAPL Analysis\n\nCurrent Price: $150.25...",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### GET `/api/chat`
Health check endpoint.

**Response:**
```json
{
  "message": "Chat API is running",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## 🚀 Deployment

### Production Deployment
The chat interface is integrated into your main Next.js application and will be deployed alongside your other frontend components.

### Local Development
Use the provided PowerShell script for easy local testing:
```powershell
.\start_chat_server.ps1
```

## 🛠️ Customization

### Adding New Agent Capabilities
1. Extend your `agent.py` with new financial tools
2. Update the API route to handle new message types
3. Add appropriate response formatting

### UI Customization
1. Modify the chat components in `/components/ui/`
2. Update Tailwind classes for styling changes
3. Add new message types or UI elements as needed

### Integration with Your Backend
1. Update the API route to call your actual agent endpoint
2. Handle authentication and rate limiting as needed
3. Add proper error handling and logging

## 📝 Notes

- The chat interface uses your existing design system with shadcn/ui components
- Local development server includes agent simulation when dependencies aren't available
- Both production and development versions are provided for flexibility
- The interface is designed to scale with your Strand agent's capabilities

Enjoy chatting with your AI financial assistant! 🤖💰
