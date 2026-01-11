/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const chatPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to AI Chat! 💬</h2>
        <p>This is your powerful AI assistant for research, analysis, and data exploration. Let's explore the features!</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="chat-sessions-list"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Chat History Sidebar</h3>
        <p>Your conversation history lives here. All chats are automatically saved and synced across devices.</p>
        <p><strong>Key Features:</strong></p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Click any session to continue where you left off</li>
          <li>Select multiple chats and add them to context or the file system for further analysis</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Entire conversations can be added to context for new chats!
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="new-chat-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Start New Conversations</h3>
        <p>Click here to create a new chat session. Each session maintains its own conversation history and context.</p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="import-chat-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Import Chat</h3>
        <p>Click here to load shared conversations from others. Import .cosine files to continue conversations or reference past discussions.</p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="share-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>🔗 Share Button</h3>
        <p>Click this button to share your current conversation with others:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><strong>Share Link:</strong> Generate a shareable link to this conversation</li>
          <li><strong>Download:</strong> Export as .cosine file</li>
          <li>Files and context are included in exports</li>
        </ul>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="context-menu-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>📋 Context Menu Button</h3>
        <p>Click this button to manage what the AI can reference during conversations:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>View all items in your current context</li>
          <li>Add charts, documents, and data from your dashboard</li>
          <li>Include entire chat conversations for reference</li>
          <li>Remove items when no longer needed</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Context is isolated per session for better organization!
        </p>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="file-menu-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>📁 File Menu Button</h3>
        <p>Click this button to manage files in your conversations:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>View all uploaded files in the current chat</li>
          <li>Supports documents, spreadsheets, PDFs, images</li>
          <li>Files can be analyzed and discussed with AI</li>
          <li>The AI agent can also generate and return files to you</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Files persist in your session and can be referenced later!
        </p>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Ready to Chat! 🚀</h2>
        <p>You're all set! Start by asking a question, uploading a file, or adding context items. Use the three buttons on the right to manage your files, context, and sharing.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
