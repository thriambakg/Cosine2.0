import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { formatApiErrorDetail } from '../../services/api';

interface ApiErrorAlertProps {
  title?: string;
  error: unknown;
  onClose?: () => void;
}

/**
 * Shows API failures without triggering logout — use with skipAuthRedirect callers.
 */
const ApiErrorAlert: React.FC<ApiErrorAlertProps> = ({
  title = 'Request failed',
  error,
  onClose,
}) => {
  const detail = formatApiErrorDetail(error);

  return (
    <Alert severity="error" onClose={onClose} sx={{ mb: 2, alignItems: 'flex-start' }}>
      <Box sx={{ width: '100%' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {title}
        </Typography>
        <Typography
          component="pre"
          variant="caption"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'monospace',
            m: 0,
            color: 'inherit',
            opacity: 0.95,
          }}
        >
          {detail}
        </Typography>
      </Box>
    </Alert>
  );
};

export default ApiErrorAlert;
