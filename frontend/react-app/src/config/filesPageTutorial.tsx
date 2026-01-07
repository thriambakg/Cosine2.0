/** @jsxImportSource react */
import { Step } from 'react-joyride';

export const filesPageSteps: Step[] = [
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to Files! 📁</h2>
        <p>Your centralized file management system. Store documents, organize folders, and make files accessible to AI.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="new-folder-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Create Folders</h3>
        <p>Click here to create new folders and organize your files into a hierarchy that makes sense for your workflow.</p>
      </div>
    ),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="add-file-button"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Upload Files</h3>
        <p>Add documents, spreadsheets, PDFs, and other files here. Once uploaded, files can be referenced in chat conversations with the AI.</p>
      </div>
    ),
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tutorial="files-list"]',
    content: (
      <div>
        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Adding Files to Context</h3>
        <p>Right-click any file to see options. You can add files directly to your AI chat context, making them available for analysis and questions.</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          💡 Files added to context are shared across all your chat sessions!
        </p>
      </div>
    ),
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: 'body',
    content: (
      <div>
        <h2 style={{ marginTop: 0, color: '#ffffff' }}>You're All Set! 📂</h2>
        <p>Files you upload and organize here become instantly available to the AI. Upload documents, add them to context, and start asking questions!</p>
        <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
          You can restart this tutorial from the Help menu (? icon).
        </p>
      </div>
    ),
    placement: 'center',
    disableBeacon: true,
  },
];
