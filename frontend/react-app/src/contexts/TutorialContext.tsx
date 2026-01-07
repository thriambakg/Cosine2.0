import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import Joyride, { Step, CallBackProps, STATUS, EVENTS } from 'react-joyride';
import { chatPageSteps } from '../config/chatPageTutorial';
import { filesPageSteps } from '../config/filesPageTutorial';
import { secSearchPageSteps } from '../config/secSearchPageTutorial';
import { politicianTradesPageSteps } from '../config/politicianTradesPageTutorial';
import { govtContractsPageSteps } from '../config/govtContractsPageTutorial';
import { congressBillsPageSteps } from '../config/congressBillsPageTutorial';
import { ldaSearchPageSteps } from '../config/ldaSearchPageTutorial';
import { newsSearchPageSteps } from '../config/newsSearchPageTutorial';
import { portfolioRiskPageSteps } from '../config/portfolioRiskPageTutorial';
import { stockScreenerPageSteps } from '../config/stockScreenerPageTutorial';
import { filePreviewTutorialSteps } from '../config/filePreviewTutorial';
import { itemDetailsTutorialSteps } from '../config/itemDetailsTutorial';
import { welcomeTutorialSteps } from '../config/welcomeTutorial';
import TutorialMockDialogs from '../components/tutorial/MockDialogs';

interface TutorialContextType {
  startTutorial: (page?: string) => void;
  stopTutorial: () => void;
  resetTutorial: (page?: string) => void;
  isTutorialRunning: boolean;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export const useTutorial = () => {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error('useTutorial must be used within TutorialProvider');
  }
  return context;
};

interface TutorialProviderProps {
  children: ReactNode;
}

const TUTORIAL_STORAGE_KEY = 'cosine_tutorial_completed';
const PAGE_TUTORIAL_PREFIX = 'cosine_tutorial_page_';

export const TutorialProvider: React.FC<TutorialProviderProps> = ({ children }) => {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState<string>('dashboard');

  // Get steps based on current page
  const getStepsForPage = (page: string): Step[] => {
    switch (page) {
      case 'welcome':
        return welcomeTutorialSteps;
      case 'dashboard':
        return dashboardSteps;
      case 'chat':
        return chatPageSteps;
      case 'files':
        return filesPageSteps;
      case 'sec-search':
        return secSearchPageSteps;
      case 'politician-trades':
        return politicianTradesPageSteps;
      case 'govt-contracts':
        return govtContractsPageSteps;
      case 'congress-bills':
        return congressBillsPageSteps;
      case 'lda-search':
        return ldaSearchPageSteps;
      case 'news-search':
        return newsSearchPageSteps;
      case 'portfolio-risk':
        return portfolioRiskPageSteps;
      case 'stock-screener-search':
        return stockScreenerPageSteps;
      case 'file-preview':
        return filePreviewTutorialSteps;
      case 'item-details':
        return itemDetailsTutorialSteps;
      default:
        return dashboardSteps;
    }
  };

  // Define dashboard tutorial steps
  const dashboardSteps: Step[] = [
    {
      target: 'body',
      content: (
        <div>
          <h2 style={{ marginTop: 0, color: '#ffffff' }}>Welcome to Cosine! 👋</h2>
          <p>Let's take a quick tour of your dashboard to help you get started.</p>
          <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
            You can skip this tutorial anytime by clicking "Skip" or pressing ESC.
          </p>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '[data-tutorial="hamburger-menu"]',
      content: (
        <div>
          <h3 style={{ marginTop: 0, color: '#ffffff' }}>Navigation Menu</h3>
          <p>Click the hamburger menu to open the navigation sidebar. From here, you can access different pages like Chat, Files, Search tools, and more.</p>
        </div>
      ),
      placement: 'right',
      disableBeacon: true,
    },
    {
      target: '[data-tutorial="dashboard-grid"]',
      content: (
        <div>
          <h3 style={{ marginTop: 0, color: '#ffffff' }}>Dashboard Grid</h3>
          <p>This is your main dashboard where all your tiles will appear. Tiles can display stocks, crypto, SEC filings, government contracts, and more!</p>
        </div>
      ),
      placement: 'auto',
      disableBeacon: true,
    },
    {
      target: '[data-tutorial="new-tile-button"]',
      content: (
        <div>
          <h3 style={{ marginTop: 0, color: '#ffffff' }}>Add New Tiles</h3>
          <p>Click here to add new tiles to your dashboard. Choose from various data sources like stocks, crypto, SEC filings, and government contracts.</p>
        </div>
      ),
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: '[data-tutorial="new-tab-button"]',
      content: (
        <div>
          <h3 style={{ marginTop: 0, color: '#ffffff' }}>Create New Tabs</h3>
          <p>Organize your work by creating multiple dashboard tabs. Each tab can have its own set of tiles and can be grouped together.</p>
        </div>
      ),
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: '[data-tutorial="chat-button"]',
      content: (
        <div>
          <h3 style={{ marginTop: 0, color: '#ffffff' }}>Chat Sidebar</h3>
          <p>Click here to open the AI chat sidebar. You can ask questions, analyze data, and interact with your dashboard content through natural language.</p>
        </div>
      ),
      placement: 'left',
      disableBeacon: true,
    },
    {
      target: '[data-tutorial="chat-button"]',
      content: (
        <div>
          <h3 style={{ marginTop: 0, color: '#ffffff' }}>Context System</h3>
          <p>When you interact with tiles (like viewing documents or charts), the data is automatically added to your chat context. This allows the AI to understand and help you with specific content.</p>
          <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
            💡 Look for the "Add to Context" buttons throughout the app!
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
          <h2 style={{ marginTop: 0, color: '#ffffff' }}>You're all set! 🎉</h2>
          <p>Start exploring by adding your first tile or opening the chat sidebar to ask questions.</p>
          <p style={{ fontSize: '0.9em', color: '#9ca3af', marginBottom: 0 }}>
            You can restart this tutorial anytime from your profile menu.
          </p>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
  ];

  // Get current steps based on page
  const steps = getStepsForPage(currentPage);

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, index, type } = data;

    // Update step index
    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      setStepIndex(index + 1);
    }

    // Handle tutorial completion or skip
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status as any)) {
      setRun(false);
      setStepIndex(0);
      
      // Mark tutorial as completed in localStorage
      if (status === STATUS.FINISHED) {
        localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
        // Also mark page-specific tutorial as completed
        localStorage.setItem(`${PAGE_TUTORIAL_PREFIX}${currentPage}`, 'true');
      }
    }
  }, [currentPage]);

  const startTutorial = useCallback((page: string = 'dashboard') => {
    setCurrentPage(page);
    setStepIndex(0);
    setRun(true);
    
    // Emit event so pages can open necessary UI elements
    const event = new CustomEvent('tutorial-started', { detail: { page } });
    window.dispatchEvent(event);
  }, []);

  const stopTutorial = useCallback(() => {
    setRun(false);
    setStepIndex(0);
  }, []);

  const resetTutorial = useCallback((page?: string) => {
    if (page) {
      localStorage.removeItem(`${PAGE_TUTORIAL_PREFIX}${page}`);
    } else {
      localStorage.removeItem(TUTORIAL_STORAGE_KEY);
      // Remove all page-specific tutorials
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(PAGE_TUTORIAL_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    }
    setStepIndex(0);
    setRun(false);
  }, []);

  // Check if user is new and hasn't completed tutorial
  React.useEffect(() => {
    const hasCompletedTutorial = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!hasCompletedTutorial) {
      // Wait a bit for the page to load before starting tutorial
      const timer = setTimeout(() => {
        startTutorial('welcome');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [startTutorial]);

  return (
    <TutorialContext.Provider
      value={{
        startTutorial,
        stopTutorial,
        resetTutorial,
        isTutorialRunning: run,
      }}
    >
      {children}
      {/* Mount non-interactive mock dialogs during dialog tutorials */}
      {run && currentPage === 'file-preview' && (
        <TutorialMockDialogs type="file-preview" />
      )}
      {run && currentPage === 'item-details' && (
        <TutorialMockDialogs type="item-details" />
      )}
      <Joyride
        steps={steps}
        run={run}
        stepIndex={stepIndex}
        continuous
        showProgress
        showSkipButton
        callback={handleJoyrideCallback}
        styles={{
          options: {
            primaryColor: '#3b82f6',
            textColor: '#ffffff',
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            overlayColor: 'rgba(0, 0, 0, 0.7)',
            arrowColor: 'rgba(15, 23, 42, 0.98)',
            zIndex: 10000,
          },
          tooltip: {
            borderRadius: '8px',
            fontSize: '14px',
          },
          tooltipContent: {
            padding: '20px 10px',
          },
          buttonNext: {
            backgroundColor: '#3b82f6',
            borderRadius: '6px',
            fontSize: '14px',
            padding: '8px 16px',
          },
          buttonBack: {
            display: 'none',
          },
          buttonSkip: {
            color: '#9ca3af',
            fontSize: '14px',
          },
          buttonClose: {
            display: 'none',
          },
        }}
        locale={{
          close: 'Close',
          last: 'Finish',
          next: 'Next',
          open: 'Open',
          skip: 'Skip',
        }}
        disableScrolling={false}
        disableOverlayClose={false}
        spotlightClicks={false}
      />
    </TutorialContext.Provider>
  );
};
