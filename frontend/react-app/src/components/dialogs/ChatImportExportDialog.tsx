import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  IconButton,
  InputAdornment,
} from '@mui/material';
import {
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Upload as UploadIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { sessionManagementAPI } from '@/services/api';

interface ChatImportExportDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'import' | 'export';
  sessionId?: string;
  sessionTitle?: string;
  userId: string;
  onImportSuccess?: (sessionId: string) => void;
}

const ChatImportExportDialog: React.FC<ChatImportExportDialogProps> = ({
  open,
  onClose,
  mode,
  sessionId,
  sessionTitle,
  userId,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [shareLink, setShareLink] = useState('');
  const [shareId, setShareId] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLink, setImportLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    setActiveTab(0);
    setShareLink('');
    setShareId('');
    setDownloadUrl('');
    setImportFile(null);
    setImportLink('');
    setError('');
    setSuccess('');
    setCopied(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  const handleExportLink = async () => {
    if (!sessionId) {
      setError('No session selected');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await sessionManagementAPI.shareSession(sessionId, userId, 'link');
      if (response.success && response.shareId) {
        const fullLink = `${window.location.origin}/import-chat?shareId=${response.shareId}`;
        setShareLink(fullLink);
        setShareId(response.shareId);
        setSuccess('Share link generated successfully!');
      } else {
        setError(response.error || 'Failed to generate share link');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate share link');
    } finally {
      setLoading(false);
    }
  };

  const handleExportDownload = async () => {
    if (!sessionId) {
      setError('No session selected');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await sessionManagementAPI.shareSession(sessionId, userId, 'download');
      if (response.success && response.downloadUrl) {
        setDownloadUrl(response.downloadUrl);
        // Trigger download
        const link = document.createElement('a');
        link.href = response.downloadUrl;
        link.download = `${sessionTitle || 'chat-session'}.cosine`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setSuccess('Chat session downloaded successfully!');
      } else {
        setError(response.error || 'Failed to download chat session');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to download chat session');
    } finally {
      setLoading(false);
    }
  };

  const handleImportFile = async () => {
    if (!importFile) {
      setError('Please select a file');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Convert file to base64
      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            const bytes = new Uint8Array(reader.result);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64String = btoa(binary);
            resolve(base64String);
          } else if (typeof reader.result === 'string') {
            const base64String = reader.result.split(',')[1] || reader.result;
            resolve(base64String);
          } else {
            reject(new Error('Failed to read file'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(importFile);
      });

      const response = await sessionManagementAPI.importSession(userId, 'file', fileContent);
      if (response.success && response.session_id) {
        setSuccess('Chat session imported successfully!');
        if (onImportSuccess) {
          onImportSuccess(response.session_id);
        }
        setTimeout(() => {
          handleClose();
        }, 1500);
      } else {
        setError(response.error || 'Failed to import chat session');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import chat session');
    } finally {
      setLoading(false);
    }
  };

  const handleImportLink = async () => {
    if (!importLink.trim()) {
      setError('Please enter a share link');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Extract share ID from link
      // Links can be in formats:
      // - /import-chat?shareId={shareId}
      // - https://domain.com/import-chat?shareId={shareId}
      const url = new URL(importLink, window.location.origin);
      const shareId = url.searchParams.get('shareId') || importLink.split('/').pop() || importLink;

      const response = await sessionManagementAPI.importSession(userId, 'link', undefined, shareId);
      if (response.success && response.session_id) {
        setSuccess('Chat session imported successfully!');
        if (onImportSuccess) {
          onImportSuccess(response.session_id);
        }
        setTimeout(() => {
          handleClose();
        }, 1500);
      } else {
        setError(response.error || 'Failed to import chat session');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import chat session');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.cosine')) {
        setError('Please select a valid .cosine chat session file');
        return;
      }
      setImportFile(file);
      setError('');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #374151',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#ffffff' }}>
        <Typography variant="h6">
          {mode === 'export' ? 'Export Chat Session' : 'Import Chat Session'}
        </Typography>
        <IconButton onClick={handleClose} sx={{ color: '#9ca3af' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {mode === 'export' ? (
          <Box>
            <Tabs
              value={activeTab}
              onChange={(_, newValue) => setActiveTab(newValue)}
              sx={{
                mb: 2,
                '& .MuiTab-root': {
                  color: '#9ca3af',
                  '&.Mui-selected': { color: '#3b82f6' },
                },
                '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' },
              }}
            >
              <Tab icon={<LinkIcon />} iconPosition="start" label="Share Link" />
              <Tab icon={<UploadIcon />} iconPosition="start" label="Download" />
            </Tabs>

            {activeTab === 0 && (
              <Box>
                {!shareLink ? (
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleExportLink}
                    disabled={loading || !sessionId}
                    sx={{
                      backgroundColor: '#3b82f6',
                      '&:hover': { backgroundColor: '#2563eb' },
                    }}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Generate Share Link'}
                  </Button>
                ) : (
                  <Box>
                    <TextField
                      fullWidth
                      value={shareLink}
                      InputProps={{
                        readOnly: true,
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton onClick={handleCopyLink} sx={{ color: '#3b82f6' }}>
                              {copied ? <CheckIcon /> : <CopyIcon />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          backgroundColor: 'rgba(31, 41, 55, 0.5)',
                          color: '#ffffff',
                        },
                      }}
                    />
                    <Typography variant="caption" sx={{ color: '#9ca3af', mt: 1, display: 'block' }}>
                      {copied ? 'Link copied to clipboard!' : 'Click the copy icon to copy the link'}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            {activeTab === 1 && (
              <Box>
                <Button
                  fullWidth
                  variant="contained"
                  onClick={handleExportDownload}
                  disabled={loading || !sessionId}
                  sx={{
                    backgroundColor: '#3b82f6',
                    '&:hover': { backgroundColor: '#2563eb' },
                  }}
                >
                  {loading ? <CircularProgress size={24} /> : 'Download as .cosine'}
                </Button>
              </Box>
            )}
          </Box>
        ) : (
          <Box>
            <Tabs
              value={activeTab}
              onChange={(_, newValue) => setActiveTab(newValue)}
              sx={{
                mb: 2,
                '& .MuiTab-root': {
                  color: '#9ca3af',
                  '&.Mui-selected': { color: '#3b82f6' },
                },
                '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' },
              }}
            >
              <Tab icon={<UploadIcon />} iconPosition="start" label="Upload File" />
              <Tab icon={<LinkIcon />} iconPosition="start" label="Share Link" />
            </Tabs>

            {activeTab === 0 && (
              <Box>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".cosine"
                  style={{ display: 'none' }}
                />
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={() => fileInputRef.current?.click()}
                  sx={{
                    mb: 2,
                    borderColor: '#374151',
                    color: '#9ca3af',
                    '&:hover': { borderColor: '#3b82f6', color: '#3b82f6' },
                  }}
                >
                  {importFile ? importFile.name : 'Select .cosine File'}
                </Button>
                <Button
                  fullWidth
                  variant="contained"
                  onClick={handleImportFile}
                  disabled={loading || !importFile}
                  sx={{
                    backgroundColor: '#3b82f6',
                    '&:hover': { backgroundColor: '#2563eb' },
                  }}
                >
                  {loading ? <CircularProgress size={24} /> : 'Import Chat Session'}
                </Button>
              </Box>
            )}

            {activeTab === 1 && (
              <Box>
                <TextField
                  fullWidth
                  label="Share Link"
                  value={importLink}
                  onChange={(e) => setImportLink(e.target.value)}
                  placeholder="Paste share link here"
                  sx={{
                    mb: 2,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'rgba(31, 41, 55, 0.5)',
                      color: '#ffffff',
                    },
                    '& .MuiInputLabel-root': { color: '#9ca3af' },
                  }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  onClick={handleImportLink}
                  disabled={loading || !importLink.trim()}
                  sx={{
                    backgroundColor: '#3b82f6',
                    '&:hover': { backgroundColor: '#2563eb' },
                  }}
                >
                  {loading ? <CircularProgress size={24} /> : 'Import Chat Session'}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2, backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#fca5a5' }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mt: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#6ee7b7' }}>
            {success}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: '1px solid #374151' }}>
        <Button onClick={handleClose} sx={{ color: '#9ca3af' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChatImportExportDialog;

