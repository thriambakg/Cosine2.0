import React, { useState } from 'react';
// Force rebuild to clear cache
import {
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip
} from '@mui/material';
import {
  Download as DownloadIcon,
  Description as DocumentIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
  TableChart as SpreadsheetIcon,
  Code as CodeIcon
} from '@mui/icons-material';

interface AgentFileAttachmentProps {
  filename: string;
  fileType: string;
  fileSize: number;
  s3Key?: string;
  createdBy?: string;
  userId?: string;
  sessionId?: string;
}

const AgentFileAttachment: React.FC<AgentFileAttachmentProps> = ({
  filename,
  fileType,
  fileSize,
  s3Key,
  createdBy,
  userId,
  sessionId
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon />;
    if (type.includes('pdf')) return <PdfIcon />;
    if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv')) return <SpreadsheetIcon />;
    if (type.includes('text') || type.includes('code')) return <CodeIcon />;
    return <DocumentIcon />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDownload = async () => {
    if (!userId || !sessionId) {
      console.error('Missing userId or sessionId for file download');
      return;
    }

    setIsDownloading(true);
    try {
      // Request fresh presigned URL from file return Lambda
      const response = await fetch('/api/file-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          filename: filename,
          s3_key: s3Key
        })
      });
      
      if (!response.ok) {
        throw new Error(`Download request failed: ${response.status}`);
      }
      
      const { download_url } = await response.json();
      
      // Create download link and trigger download
      const link = document.createElement('a');
      link.href = download_url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (error) {
      console.error('Download failed:', error);
      // You could show a toast notification here
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1.5,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: '8px',
        maxWidth: '300px',
        transition: 'all 0.2s ease',
        '&:hover': {
          backgroundColor: 'rgba(59, 130, 246, 0.15)',
          borderColor: 'rgba(59, 130, 246, 0.5)',
        }
      }}
    >
      <Box sx={{ color: '#3b82f6', display: 'flex', alignItems: 'center' }}>
        {getFileIcon(fileType)}
      </Box>
      
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{
            color: '#3b82f6',
            fontWeight: 600,
            fontSize: '0.875rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {filename}
        </Typography>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Chip
            label={formatFileSize(fileSize)}
            size="small"
            sx={{
              height: '20px',
              fontSize: '0.7rem',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              color: '#3b82f6',
              border: '1px solid rgba(59, 130, 246, 0.2)'
            }}
          />
          
          {createdBy === 'agent' && (
            <Chip
              label="AI Generated"
              size="small"
              sx={{
                height: '20px',
                fontSize: '0.7rem',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                color: '#22c55e',
                border: '1px solid rgba(34, 197, 94, 0.2)'
              }}
            />
          )}
        </Box>
      </Box>
      
      <Tooltip title={isDownloading ? "Generating download link..." : "Download file"}>
        <IconButton
          size="small"
          onClick={handleDownload}
          disabled={isDownloading}
          sx={{
            color: isDownloading ? '#9ca3af' : '#3b82f6',
            '&:hover': {
              backgroundColor: isDownloading ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
            }
          }}
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default AgentFileAttachment;
