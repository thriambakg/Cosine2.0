/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const politicianTradesPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to Politician Trades! 🏛️</h2>
        <p>Search and analyze stock trades made by members of Congress. Track what politicians are buying and selling in real-time!</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="date-range"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Date Range</h3>
        <p>Filter trades by transaction or disclosure date:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Set start and end dates to narrow your search</li>
          <li>Data available from January 1, 2025 onward</li>
          <li>Choose between transaction date (when trade occurred) or disclosure date (when filed)</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="politician-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Politicians Search</h3>
        <p>Search for specific members of Congress:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Start typing a name to see autocomplete suggestions</li>
          <li>Shows politician name, party affiliation, and chamber (House/Senate)</li>
          <li>Select multiple politicians to track their trades</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 <strong>Multi-select tip:</strong> Type and select from suggestions, then click Search. Add multiple politicians to compare their trades!
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="security-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Securities Search</h3>
        <p>Filter by specific stocks or securities:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Start typing a stock symbol or company name</li>
          <li>Autocomplete shows symbol, company name, and market cap</li>
          <li>Select multiple securities to track</li>
          <li>Great for seeing which politicians are trading specific stocks</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Example: Search "AAPL" to see all Apple trades by politicians
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="amount-range"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Amount Range</h3>
        <p>Filter trades by transaction value to focus on specific investment sizes:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Set minimum and maximum dollar amounts</li>
          <li>Ranges from $0 to $50M+</li>
          <li>Useful for tracking large institutional moves or smaller personal trades</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Note: Politicians report value ranges (e.g., $15,001-$50,000), not exact amounts
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="advanced-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Advanced Search Options</h3>
        <p>Beyond the main filters, you can also search by:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><strong>Filing Date:</strong> When the trade was disclosed (vs. when it occurred)</li>
          <li><strong>Party Affiliation:</strong> Democratic, Republican, or Independent</li>
          <li><strong>Position:</strong> Senator, Representative, or other roles</li>
          <li><strong>State/District:</strong> Filter by geographical representation</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Click to expand and use these filters in combination to create highly targeted searches
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Ready to Track! 🚀</h2>
        <p>You're all set! Use the search parameters above to filter politician trades by date, politician, security, transaction type, and amount.</p>
        <p>Once you run a search, results will appear in the table below where you can view details, select trades, and add them to AI context for analysis.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
