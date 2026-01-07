import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useTutorial } from '../../contexts/TutorialContext';

interface TutorialHelpIconProps {
  tutorialKey: string;
  title?: string;
  size?: 'small' | 'medium' | 'large';
  color?: string;
  sx?: any;
}

const TutorialHelpIcon: React.FC<TutorialHelpIconProps> = ({ tutorialKey, title = 'Show tutorial', size = 'small', color = '#9ca3af', sx }) => {
  const { startTutorial } = useTutorial();
  return (
    <Tooltip title={title} placement="bottom" arrow>
      {/* span wrapper keeps tooltip when button is disabled; our button is active */}
      <span>
        <IconButton
          size={size}
          onClick={(e) => {
            e.stopPropagation();
            startTutorial(tutorialKey);
          }}
          sx={{ color, ...sx }}
        >
          <HelpOutlineIcon fontSize={size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium'} />
        </IconButton>
      </span>
    </Tooltip>
  );
};

export default TutorialHelpIcon;
