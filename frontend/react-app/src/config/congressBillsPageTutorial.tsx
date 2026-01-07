/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const congressBillsPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to Congress Bills Search! 🏛️</h2>
        <p>Find, filter, and analyze congressional bills by sponsors, types, policy areas, dates, and advanced attributes.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="politician-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Sponsor / Cosponsor</h3>
        <p>Search for bills by sponsor or cosponsor.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Type a politician name to get suggestions</li>
          <li>Select one or multiple names to include their bills</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Multi-select tip: type, choose, repeat to compare multiple sponsors.
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="bill-type"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Bill Type</h3>
        <p>Select bill types (e.g., H.R., S., H.Res, S.Res).</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Pick one or many to narrow results</li>
          <li>Use this to focus on resolutions vs. standard bills</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="introduced-date"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Introduced Date</h3>
        <p>Filter bills by when they were introduced.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Set From/To dates to bound the time window</li>
          <li>Great for focusing on recent sessions or historical periods</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="policy-area"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Policy Area</h3>
        <p>Filter by policy area to hone in on topics.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Select one or multiple policy areas</li>
          <li>Useful for theme-based research (e.g., Finance, Defense)</li>
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
          <li><strong>Roles:</strong> Sponsor vs. Cosponsor</li>
          <li><strong>Bill Title:</strong> Exact title matching</li>
          <li><strong>Party & Bipartisan:</strong> Sponsor party and bipartisan flag</li>
          <li><strong>Bill Number & Dates:</strong> Bill number, latest action date range</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Combine these to build precise, session-specific queries.
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
        <p>Execute the search with your selected filters.</p>
        <p><strong>How Search Works:</strong></p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li><strong>Page-by-page:</strong> Bills load progressively</li>
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
        <p>Review and work with the bills you found:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Click a row to inspect details</li>
          <li>Use checkboxes to select multiple bills</li>
          <li>Toggle columns to show fields like sponsor, dates, policy area</li>
          <li>Double-click a bill to open it for deeper analysis</li>
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
        <p>Start with sponsors, bill types, dates, and policy areas; expand advanced filters for roles, party, and action dates, then run the search and explore the results.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
