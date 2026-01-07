import { Step } from 'react-joyride';

export const filePreviewTutorialSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>Preview files fast</h3>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Use the floating preview window to inspect files, add them to context, and download securely.</p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="file-preview-titlebar"]',
    content: (
      <div>
        <h4 style={{ margin: 0, color: '#ffffff' }}>Move and manage</h4>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Drag the title bar to reposition, and use minimize/close to manage multiple previews.</p>
      </div>
    ),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="file-preview-actions"]',
    content: (
      <div>
        <h4 style={{ margin: 0, color: '#ffffff' }}>Context & downloads</h4>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Add the file to chat context or download it directly. Downloads always fetch a fresh URL.</p>
      </div>
    ),
    placement: 'left',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="file-preview-content"]',
    content: (
      <div>
        <h4 style={{ margin: 0, color: '#ffffff' }}>Preview area</h4>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>View images, PDFs, text, or structured tiles. Scroll within this pane; the window stays resizable.</p>
      </div>
    ),
    placement: 'auto',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h3 style={{ margin: 0, color: '#ffffff' }}>All set</h3>
        <p style={{ margin: '8px 0', color: '#e5e7eb' }}>Keep multiple previews open, minimize the ones you are parking, and drag them where you need.</p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
