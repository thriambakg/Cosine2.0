import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  IconButton,
  Paper,
  Divider,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
  Description as TextIcon,
  InsertDriveFile as FileIcon,
} from '@mui/icons-material';
import { fileReturnAPI } from '@/services/api';

interface FilePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  item: {
    id: string;
    name: string;
    type: 'context_item' | 'uploaded_file' | 'agent_file';
    s3_key?: string;
    metadata?: any;
  };
  user_id: string;
}

interface PreviewResponse {
  preview_type: 'context_item' | 'image' | 'pdf' | 'text' | 'download_only';
  content?: any;
  preview_url?: string;
  download_url?: string;
  content_type?: string;
  file_size?: number;
  filename?: string;
  metadata?: any;
  message?: string;
}

const FilePreviewDialog: React.FC<FilePreviewDialogProps> = ({
  open,
  onClose,
  item,
  user_id,
}) => {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && item) {
      // If item has metadata with data (mock data), use it directly
      if (item.metadata?.data && Object.keys(item.metadata.data).length > 0) {
        setPreviewData({
          preview_type: 'context_item',
          content: {
            id: item.id,
            type: item.metadata.type || 'context_item',
            title: item.metadata.title || item.name,
            subtitle: item.metadata.subtitle,
            data: item.metadata.data,
            timestamp: item.metadata.timestamp,
          },
          metadata: {
            type: item.metadata.type,
            title: item.metadata.title || item.name,
            subtitle: item.metadata.subtitle,
            timestamp: item.metadata.timestamp,
          },
        });
        setLoading(false);
      } else if (item.metadata && item.type === 'context_item') {
        // For context items with metadata but no data, construct from metadata
        setPreviewData({
          preview_type: 'context_item',
          content: {
            id: item.id,
            type: item.metadata.type || 'context_item',
            title: item.metadata.title || item.name,
            subtitle: item.metadata.subtitle,
            data: {},
            timestamp: item.metadata.timestamp || Date.now(),
          },
          metadata: {
            type: item.metadata.type,
            title: item.metadata.title || item.name,
            subtitle: item.metadata.subtitle,
            timestamp: item.metadata.timestamp,
          },
        });
        setLoading(false);
      } else if (item.s3_key) {
        // For real files, fetch from API
        fetchPreview();
      } else {
        // No data available
        setError('No preview data available');
        setLoading(false);
      }
    } else {
      // Reset state when dialog closes
      setPreviewData(null);
      setError(null);
    }
  }, [open, item]);

  const fetchPreview = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fileReturnAPI.previewFile({
        user_id,
        s3_key: item.s3_key,
        item_type: item.type,
        request_type: 'preview',
      });

      if (response.success && response.data) {
        setPreviewData(response.data);
      } else {
        setError(response.error || 'Failed to load preview');
      }
    } catch (err: any) {
      console.error('Error fetching preview:', err);
      setError(err.message || 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!previewData?.download_url) {
      // For mock data, create a JSON download
      if (previewData?.content && previewData.preview_type === 'context_item') {
        const jsonStr = JSON.stringify(previewData.content, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.name}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
      
      // Generate download URL if s3_key is available
      if (item.s3_key) {
        try {
          const response = await fileReturnAPI.downloadFile({
            user_id,
            s3_key: item.s3_key,
            filename: item.name,
          });

          if (response.success && response.data?.download_url) {
            window.open(response.data.download_url, '_blank');
          }
        } catch (err) {
          console.error('Error downloading file:', err);
          setError('Failed to download file');
        }
      } else {
        setError('Download not available for this item');
      }
    } else {
      window.open(previewData.download_url, '_blank');
    }
  };

  const renderPreview = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
          <CircularProgress />
        </Box>
      );
    }

    if (error) {
      return (
        <Alert severity="error" sx={{ m: 2 }}>
          {error}
        </Alert>
      );
    }

    if (!previewData) {
      return null;
    }

    switch (previewData.preview_type) {
      case 'context_item':
        return (
          <Box sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ color: '#ffffff', mb: 2 }}>
              {previewData.metadata?.title || item.name}
            </Typography>
            {previewData.metadata?.subtitle && (
              <Typography variant="body2" sx={{ color: '#9ca3af', mb: 2 }}>
                {previewData.metadata.subtitle}
              </Typography>
            )}
            <Divider sx={{ my: 2, borderColor: '#374151' }} />
            <Paper
              sx={{
                p: 2,
                backgroundColor: '#111827',
                border: '1px solid #374151',
                maxHeight: '60vh',
                overflow: 'auto',
                '& pre': {
                  color: '#e5e7eb',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                },
              }}
            >
              <pre>{JSON.stringify(previewData.content, null, 2)}</pre>
            </Paper>
          </Box>
        );

      case 'image':
        return (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <img
              src={previewData.preview_url}
              alt={item.name}
              style={{
                maxWidth: '100%',
                maxHeight: '70vh',
                objectFit: 'contain',
                borderRadius: '4px',
              }}
            />
          </Box>
        );

      case 'pdf':
        return (
          <Box sx={{ p: 2, height: '70vh' }}>
            <iframe
              src={previewData.preview_url}
              title={item.name}
              style={{
                width: '100%',
                height: '100%',
                border: '1px solid #374151',
                borderRadius: '4px',
              }}
            />
          </Box>
        );

      case 'text':
        return (
          <Box sx={{ p: 2 }}>
            <Paper
              sx={{
                p: 2,
                backgroundColor: '#111827',
                border: '1px solid #374151',
                maxHeight: '60vh',
                overflow: 'auto',
                '& pre': {
                  color: '#e5e7eb',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                },
              }}
            >
              <pre>{previewData.content}</pre>
            </Paper>
          </Box>
        );

      case 'download_only':
        return (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <FileIcon sx={{ fontSize: 64, color: '#6b7280', mb: 2 }} />
            <Typography variant="h6" sx={{ color: '#ffffff', mb: 1 }}>
              {item.name}
            </Typography>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 2 }}>
              {previewData.message || 'Preview not available for this file type'}
            </Typography>
            {previewData.file_size && (
              <Typography variant="caption" sx={{ color: '#6b7280' }}>
                Size: {(previewData.file_size / 1024).toFixed(2)} KB
              </Typography>
            )}
          </Box>
        );

      default:
        return (
          <Alert severity="info" sx={{ m: 2 }}>
            Preview not available for this file type
          </Alert>
        );
    }
  };

  const getPreviewIcon = () => {
    if (!previewData) return <FileIcon />;
    
    switch (previewData.preview_type) {
      case 'image':
        return <ImageIcon />;
      case 'pdf':
        return <PdfIcon />;
      case 'text':
      case 'context_item':
        return <TextIcon />;
      default:
        return <FileIcon />;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1f2937',
          border: '1px solid #374151',
          color: '#ffffff',
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #374151',
          pb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          {previewData && getPreviewIcon()}
          <Typography variant="h6" sx={{ color: '#ffffff' }}>
            {item.name}
          </Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ color: '#9ca3af' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, mt: 2 }}>
        {renderPreview()}
      </DialogContent>

      <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
        <Button
          onClick={onClose}
          sx={{
            color: '#9ca3af',
            '&:hover': {
              backgroundColor: 'rgba(156, 163, 175, 0.1)',
            },
          }}
        >
          Close
        </Button>
        <Button
          onClick={handleDownload}
          variant="contained"
          startIcon={<DownloadIcon />}
          sx={{
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            '&:hover': {
              backgroundColor: '#2563eb',
            },
          }}
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FilePreviewDialog;

