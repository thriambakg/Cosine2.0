/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const portfolioRiskPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to Portfolio Risk! 📊</h2>
        <p>Enter holdings, pick a timeframe, and calculate risk/return metrics with interactive charts.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="open-calculator"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Open Calculator</h3>
        <p>Click the floating calculator to manage holdings, timeframe, and calculations.</p>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="timeframe"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Select Timeframe</h3>
        <p>Choose the history window used for prices, returns, and charting (1D through Max).</p>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="holdings-list"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Enter Holdings</h3>
        <p>Add tickers and share counts for each position.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Autocomplete for symbols; uppercase accepted</li>
          <li>Add rows for more holdings; delete to trim</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="calculate-risk"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Calculate</h3>
        <p>Run the analysis to compute portfolio metrics and cache results for this session.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li>Requires at least one ticker with shares</li>
          <li>Clear resets holdings, timeframe, and cached results</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="performance-chart"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Performance Chart</h3>
        <p>View combined portfolio, per-stock, or comparison overlays.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li>Use the chart icons to switch modes or compare with another ticker</li>
          <li>Brush the timeline to zoom; hover for values</li>
        </ul>
      </div>
    ),
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="advanced-metrics"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Metrics & Risk</h3>
        <p>Review portfolio value, returns, vol, Sharpe, and correlation/covariance summaries.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li>Stock details table on the left shows weights, returns, and per-position stats</li>
          <li>Risk level chip highlights volatility</li>
        </ul>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Ready to analyze! 🚀</h2>
        <p>Open the calculator, enter holdings, set timeframe, run Calculate, then explore charts and metrics.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
