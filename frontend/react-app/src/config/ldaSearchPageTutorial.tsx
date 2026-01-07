/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const ldaSearchPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to LDA Disclosures Search! 🏛️</h2>
        <p>Explore lobbying disclosure filings. Filter by entities, dates, amounts, and advanced attributes to pinpoint relevant filings.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="general-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>General Search</h3>
        <p>Search across registrants, clients, lobbyists, and PACs in one box.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Type to get mixed suggestions (registrant, client, lobbyist, PAC)</li>
          <li>Select multiple terms to broaden coverage</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="date-range"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Date Range</h3>
        <p>Filter filings by posted date.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Set From/To to focus on specific periods</li>
          <li>Useful for recent cycles or historical research</li>
        </ul>
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
        <p>Filter by reported amount (min/max).</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Set minimum and/or maximum amounts</li>
          <li>Great for focusing on high-dollar filings</li>
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
        <p>Expand to target specific entities and codes:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><strong>Registrant / Client / Lobbyist:</strong> Entity-specific filters</li>
          <li><strong>Foreign Entities:</strong> Include or focus on foreign relationships</li>
          <li><strong>Issue Codes & Government Entities:</strong> General issue codes and agencies</li>
          <li><strong>Item Type & State:</strong> Filing vs contribution, plus state filter</li>
        </ul>
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
        <p>Execute your search with the selected filters.</p>
        <p><strong>How Search Works:</strong></p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li><strong>Page-by-page:</strong> Filings load progressively</li>
          <li><strong>Cancellable:</strong> You can stop; processing continues server-side</li>
          <li><strong>Resume:</strong> Re-run the same search to pick up where you left off</li>
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
        <p>Start with general search and dates, add amounts, expand advanced filters for entities/codes, then run and explore your results.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
