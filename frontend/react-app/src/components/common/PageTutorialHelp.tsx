/** @jsxImportSource react */
import { Box, IconButton, Tooltip } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useLocation } from 'react-router-dom';
import { useTutorial } from '../../contexts/TutorialContext';

const routeToTutorialKey: Record<string, string> = {
  '/': 'dashboard',
  '/chat': 'chat',
  '/files': 'files',
  '/sec-search': 'sec-search',
  '/politician-trades-search': 'politician-trades',
  '/news-search': 'news-search',
  '/govt-contracts-search': 'govt-contracts',
  '/congress-bills-search': 'congress-bills',
  '/lda-search': 'lda-search',
  '/portfolio-risk': 'portfolio-risk',
  '/stock-screener-search': 'stock-screener-search',
};

export default function PageTutorialHelp() {
  const location = useLocation();
  const { startTutorial } = useTutorial();

  // Normalize path to key; if not found, try stripping trailing slashes
  let key = routeToTutorialKey[location.pathname];
  if (!key && location.pathname.endsWith('/')) {
    key = routeToTutorialKey[location.pathname.replace(/\/+$/, '')];
  }

  if (!key) return null;
  // Hide global page help on Chat; Chat page renders its own context-aware help button
  if (location.pathname === '/chat') return null;
  
  // Per-route positioning to avoid overlapping key controls
  // Default: bottom-left. Chat page: top-left under header to avoid input bar controls
  const positionSx = { position: 'fixed', bottom: 24, left: 24, zIndex: 2000 };

  return (
    <Box sx={positionSx}>
      <Tooltip title="Show page tutorial" arrow>
        <IconButton
          size="medium"
          onClick={() => startTutorial(key!)}
          sx={{
            color: '#9ca3af',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            '&:hover': {
              color: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)'
            }
          }}
        >
          <HelpOutlineIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
