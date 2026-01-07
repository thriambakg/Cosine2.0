/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const secSearchPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to SEC Search! 📄</h2>
        <p>Search and analyze SEC filings including 10-K, 10-Q, 8-K forms, and more. Let's explore the powerful search features!</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="filer-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Company/Filer Search</h3>
        <p>Search for companies and entities that file with the SEC:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Start typing a company name (e.g., "Apple", "Microsoft")</li>
          <li>Autocomplete suggestions appear with company names and CIK numbers</li>
          <li>Select multiple companies to search their filings</li>
          <li>Add individuals like corporate officers or directors</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 <strong>Multi-select tip:</strong> Type your search term, press Enter to add it, then click Search. You can add multiple items and they'll be searched together!
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="keywords-search"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Keywords Search</h3>
        <p>Search within filing content using keywords:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Type a keyword or phrase and press Enter to add it</li>
          <li>Add multiple keywords - they'll be searched together</li>
          <li>Search looks for these terms within the filing text</li>
          <li>Great for finding specific topics or terms in documents</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 <strong>Example:</strong> Search for "merger", "acquisition", "restructuring"
        </p>
      </div>
    ),
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="form-types"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Filing Form Types</h3>
        <p>Filter by specific SEC form types:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><strong>10-K:</strong> Annual reports with comprehensive financial info</li>
          <li><strong>10-Q:</strong> Quarterly reports</li>
          <li><strong>8-K:</strong> Current reports of major events</li>
          <li><strong>And many more:</strong> Proxies, S-1s, 13Fs, and other forms</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Browse categories or search specific form types
        </p>
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
        <p>Filter filings by date filed with the SEC:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Set start and end dates to narrow your search</li>
          <li>Data available from 2001 to present</li>
          <li>Leave blank to search all dates</li>
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
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Search Button</h3>
        <p>Click to execute your search with the selected filters.</p>
        <p><strong>How Search Works:</strong></p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9em' }}>
          <li><strong>Page-by-page:</strong> Results are fetched progressively, page by page</li>
          <li><strong>Cancellable:</strong> Click Stop to cancel, but the search continues in the background</li>
          <li><strong>Resume anytime:</strong> Run the same search again to pick up where you left off</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Large searches may take time - you can stop and resume later!
        </p>
      </div>
    ),
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="results-table"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Search Results</h3>
        <p>Your SEC filing results appear here:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Click any filing to view its details</li>
          <li>Select multiple filings using checkboxes</li>
          <li>Add filings to context or save to file system</li>
          <li>Filter results by form type, company, and location</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Results can be paginated and customized via column selection
        </p>
      </div>
    ),
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="add-to-context-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Add to Context</h3>
        <p>Add selected filings to your AI context:</p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Select one or more filings from the table</li>
          <li>Click this button to add them to context</li>
          <li>Reference these filings in AI chat for analysis</li>
          <li>Context items appear in your chat sessions</li>
        </ul>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Perfect for comparing filings or deep analysis with AI
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
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Ready to Search! 🚀</h2>
        <p>You're all set! Start by searching for a company, adding keywords, selecting form types, and exploring SEC filings. Use the Add to Context feature to analyze filings with AI.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          Restart this tutorial anytime from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
