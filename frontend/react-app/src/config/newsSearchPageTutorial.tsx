/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const newsSearchPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to News Search! 📰</h2>
        <p>Find and triage news articles with keyword search, dates, and client-side filters.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="keywords-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Keywords</h3>
        <p>Search across headlines and descriptions with one or more keywords.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Add multiple terms to broaden coverage</li>
          <li>Freeform input; suggestions stay client-side</li>
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
        <p>Optional posted date filters to narrow results.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Set From/To for recent coverage or historical windows</li>
          <li>Leave blank to search all available dates</li>
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
        <p>Execute your query and load the first batch of articles.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li>Saved session: search state and filters persist for this tab</li>
          <li>Use Clear to reset keywords, dates, and filters</li>
        </ul>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="client-filters"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Refine by Source/Category/Country</h3>
        <p>Use client-side filters derived from your current results.</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Expand a section to pick filters and see article counts</li>
          <li>Selections apply instantly without re-running the search</li>
          <li>Clear all filters to return to the full result set</li>
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
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Ready to explore! 🚀</h2>
        <p>Enter keywords, add dates if needed, run the search, and refine with sources, categories, or countries.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
