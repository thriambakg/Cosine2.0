/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const govtContractsPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to Government Contracts Search! 🏛️</h2>
        <p>Find and analyze federal contract awards. Filter by agencies, recipients, location, fiscal year, and more to zero in on the awards you need.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="awarding-agency"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Awarding Agency</h3>
        <p>Select the agencies that issued the awards:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Type to search agencies and pick one or many</li>
          <li>Autocomplete suggestions include agency names and codes</li>
          <li>Mix multiple agencies to broaden coverage</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Multi-select tip: type, press Enter to add, repeat for more agencies.
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="recipient"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Recipient</h3>
        <p>Search for specific recipients (contract awardees).</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Type a recipient name to get suggestions</li>
          <li>Select one or multiple recipients to focus your results</li>
          <li>Great for tracking awards to a particular company or entity</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="recipient-location"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Recipient Location</h3>
        <p>Filter by where the recipient is located:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><strong>State:</strong> Select one or multiple states</li>
          <li><strong>Zip Code:</strong> Enter one or more zip codes for hyper-local searches</li>
          <li>Great for regional rollups or city-level analysis</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="fiscal-year"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Fiscal Year</h3>
        <p>Constrain results to a specific fiscal year.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Enter a year (e.g., 2024) to focus on that cycle</li>
          <li>Leave empty to include all years</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="advanced-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Advanced Search</h3>
        <p>Click to expand advanced filters:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><strong>Funding Agency:</strong> Who supplies the funds</li>
          <li><strong>Obligation Range:</strong> Minimum/maximum dollar amounts</li>
          <li><strong>NAICS / PSC / CFDA:</strong> Industry and program classification codes</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Use these to craft precise queries for niche sectors or funding sources.
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="search-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Run Search</h3>
        <p>Execute your search with the chosen filters.</p>
        <p><strong>How Search Works:</strong></p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li><strong>Page-by-page:</strong> Awards load progressively</li>
          <li><strong>Cancellable:</strong> You can stop; processing continues server-side</li>
          <li><strong>Resume:</strong> Re-run the same search to pick up where you left off</li>
        </ul>
      </div>
    ),
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="results-table"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Results Table</h3>
        <p>Review and work with the awards you found:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Click a row to inspect details</li>
          <li>Use checkboxes to select multiple awards</li>
          <li>Use column picker to show/hide fields like NAICS/PSC</li>
          <li>Drag or double-click to open items for context/analysis</li>
        </ul>
      </div>
    ),
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Ready to Search! 🚀</h2>
        <p>Start by choosing agencies and a fiscal year, then expand advanced search for funding agency, obligation ranges, and NAICS/PSC/CFDA codes. Run the search and dive into the results.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
