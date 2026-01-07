/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const stockScreenerPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to Stock Screener! 📈</h2>
        <p>Screen equities by sector, ranges, and timeframes, then refine and export picks.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="criteria-panel"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Criteria Panel</h3>
        <p>Set the screening inputs on the left.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Pick industries/sectors</li>
          <li>Use sliders for volatility, price change, market cap, price, P/E, dividend yield</li>
          <li>Select timeframe for return metrics</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="industries"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Industries (Sectors)</h3>
        <p>Choose one or more sectors to focus the screen. Selected sectors show as chips.</p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="timeframe"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Timeframe</h3>
        <p>Pick the period used for price change and volatility calculations (1D–1Y).</p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="search-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Run Screener</h3>
        <p>Execute the screen with current criteria. State persists in this tab.</p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Ready to screen! 🚀</h2>
        <p>Set sectors and ranges, then run the screener to get your list.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
