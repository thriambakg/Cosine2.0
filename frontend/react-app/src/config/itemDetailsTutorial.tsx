import { Step } from 'react-joyride';

export const itemDetailsTutorialSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>Inspect any result</h3>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>The details window shows enriched data for contracts, filings, trades, bills, and stocks.</p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="item-details-titlebar"]',
    content: (
      <div>
        <h4 style={{ margin: 0, color: '#ffffff' }}>Drag, layer, minimize</h4>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Use the title bar to move the window. Minimize when parking multiple details side by side.</p>
      </div>
    ),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="item-details-actions"]',
    content: (
      <div>
        <h4 style={{ margin: 0, color: '#ffffff' }}>Share to files or context</h4>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Save to Files for later, or add to chat context so the AI references it in your prompts.</p>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="item-details-content"]',
    content: (
      <div>
        <h4 style={{ margin: 0, color: '#ffffff' }}>Scrollable details</h4>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Scroll the body to see sections like summary, amounts, participants, links, and related items.</p>
      </div>
    ),
    placement: 'auto',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>Ready to review</h3>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Open several detail windows, minimize the rest, and keep context building while you browse.</p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
