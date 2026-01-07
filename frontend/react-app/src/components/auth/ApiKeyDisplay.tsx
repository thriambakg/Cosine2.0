/**
 * API Key Display Component
 * Shows the API key to user once after signup
 * User must save it - it won't be shown again
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Alert,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  ContentCopy as ContentCopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon
} from '@mui/icons-material';
import { useApiAuth } from '../contexts/ApiAuthContext';

interface ApiKeyDisplayProps {
  apiKey: string;
  open: boolean;
  onClose: () => void;
}

export const ApiKeyDisplay: React.FC<ApiKeyDisplayProps> = ({ apiKey, open, onClose }) => {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const { saveApiKeyToStorage } = useApiAuth();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleSave = () => {
    saveApiKeyToStorage(apiKey);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Your API Key</DialogTitle>
      
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, py: 2 }}>
          <Alert severity="warning">
            Save your API key now. You won't be able to see it again!
          </Alert>

          <Alert severity="info">
            Use this key with the <code>X-API-Key</code> header for API requests:
            <br />
            <code style={{ fontSize: '0.85rem' }}>
              curl -H "X-API-Key: sk_..." https://api.cosine.com/...
            </code>
          </Alert>

          <Box sx={{ position: 'relative' }}>
            <TextField
              fullWidth
              label="API Key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              readOnly
              variant="outlined"
              InputProps={{
                endAdornment: (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title={showKey ? 'Hide' : 'Show'}>
                      <IconButton
                        onClick={() => setShowKey(!showKey)}
                        edge="end"
                        size="small"
                      >
                        {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                      <IconButton
                        onClick={handleCopy}
                        edge="end"
                        size="small"
                        color={copied ? 'success' : 'default'}
                      >
                        <ContentCopyIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )
              }}
            />
          </Box>

          <Typography variant="caption" color="textSecondary">
            💡 <strong>Tip:</strong> Store this in your .env file or password manager
          </Typography>

          <Box sx={{ backgroundColor: '#f5f5f5', p: 2, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              Quick Start
            </Typography>
            <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`export const apiKey = '${apiKey}';

fetch('https://api.cosine.com/congress-bills-search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey
  },
  body: JSON.stringify({
    filters: { politician_name: ['Maria Cantwell'] }
  })
})`}
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
        <Button onClick={handleSave} variant="contained" color="primary">
          Save & Continue
        </Button>
      </DialogActions>
    </Dialog>
  );
};
