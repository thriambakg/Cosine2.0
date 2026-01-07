/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const welcomeTutorialSteps: Step[] = [
  {
    target: 'body',
    placement: 'center',
    content: (
      <div>
        <h2 style={{ margin: 0, color: '#ffffff', fontSize: '1.5rem' }}>Welcome to Cosine</h2>
        <p style={{ margin: '12px 0 8px 0', color: '#e5e7eb', fontSize: '1rem' }}>
          The first-in-class AI-powered government financial research platform
        </p>
        <p style={{ margin: '8px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
          Let's explore how Cosine empowers your research with real-time data and intelligent analysis.
        </p>
      </div>
    ),
    disableBeacon: true,
  },
  {
    target: 'body',
    placement: 'center',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>What is Cosine?</h3>
        <p style={{ margin: '12px 0 8px 0', color: '#e5e7eb' }}>
          Cosine is a cutting-edge research platform that combines government financial data, market intelligence, and AI-powered insights.
        </p>
        <p style={{ margin: '8px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
          Unlike traditional research tools, Cosine uses conversational AI to help you discover patterns, track politicians' trades, analyze government contracts, and monitor SEC filings—all in one unified interface.
        </p>
      </div>
    ),
    disableBeacon: true,
  },
  {
    target: 'body',
    placement: 'center',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>Key Capabilities</h3>
        <div style={{ margin: '12px 0', color: '#e5e7eb' }}>
          <p style={{ margin: '8px 0' }}>📊 <strong>Portfolio Analysis</strong> – Track holdings and analyze risk exposure</p>
          <p style={{ margin: '8px 0' }}>💼 <strong>Government Data</strong> – Monitor politician trades, government contracts, Congress bills, and SEC filings</p>
          <p style={{ margin: '8px 0' }}>📰 <strong>News & Intelligence</strong> – Stay informed with curated financial news and insights</p>
          <p style={{ margin: '8px 0' }}>🤖 <strong>AI Chat Assistant</strong> – Ask natural language questions about your data and get instant answers</p>
        </div>
      </div>
    ),
    disableBeacon: true,
  },
  {
    target: 'body',
    placement: 'center',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>Your Dashboard</h3>
        <p style={{ margin: '12px 0 8px 0', color: '#e5e7eb' }}>
          Your dashboard is the central hub where you can:
        </p>
        <div style={{ margin: '8px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
          <p style={{ margin: '6px 0' }}>• Create custom tiles for stocks, crypto, portfolios, and research</p>
          <p style={{ margin: '6px 0' }}>• Organize tiles into multiple tabs and groups</p>
          <p style={{ margin: '6px 0' }}>• Access all your research in one unified view</p>
          <p style={{ margin: '6px 0' }}>• Build research context for your AI assistant</p>
        </div>
      </div>
    ),
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="chat-button"]',
    placement: 'left',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>Your AI Research Partner</h3>
        <p style={{ margin: '12px 0 8px 0', color: '#e5e7eb' }}>
          Click the chat button to open your AI assistant. Ask natural language questions about:
        </p>
        <div style={{ margin: '8px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
          <p style={{ margin: '6px 0' }}>• Market trends and portfolio performance</p>
          <p style={{ margin: '6px 0' }}>• Government contracts and spending</p>
          <p style={{ margin: '6px 0' }}>• Politicians' financial activities</p>
          <p style={{ margin: '6px 0' }}>• SEC filings and company information</p>
        </div>
        <p style={{ margin: '8px 0', color: '#9ca3af', fontSize: '0.85rem' }}>
          The more context you add, the smarter the AI becomes.
        </p>
      </div>
    ),
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="hamburger-menu"]',
    placement: 'right',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>Explore the Platform</h3>
        <p style={{ margin: '12px 0 8px 0', color: '#e5e7eb' }}>
          Click the menu to access different research tools:
        </p>
        <div style={{ margin: '8px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
          <p style={{ margin: '6px 0' }}>📁 <strong>Files</strong> – Manage and preview research documents</p>
          <p style={{ margin: '6px 0' }}>💹 <strong>Stock Screener</strong> – Analyze and filter stocks</p>
          <p style={{ margin: '6px 0' }}>🏛️ <strong>Government Data</strong> – Search contracts, trades, bills, and filings</p>
          <p style={{ margin: '6px 0' }}>💰 <strong>Portfolio Risk</strong> – Assess your holdings</p>
        </div>
      </div>
    ),
    disableBeacon: true,
  },
  {
    target: 'body',
    placement: 'center',
    content: (
      <div>
        <h2 style={{ margin: 0, color: '#ffffff' }}>You're Ready! 🚀</h2>
        <p style={{ margin: '12px 0 8px 0', color: '#e5e7eb' }}>
          Start building your research dashboard by adding your first tile, or jump into the chat to ask your first question.
        </p>
        <p style={{ margin: '8px 0', color: '#9ca3af', fontSize: '0.9rem' }}>
          <strong>💡 Tip:</strong> You can access tutorials anytime from the Help menu in the top right corner.
        </p>
      </div>
    ),
    disableBeacon: true,
  },
];
