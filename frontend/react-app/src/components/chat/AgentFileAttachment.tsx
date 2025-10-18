import React from 'react';
import {
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip,
  Link
} from '@mui/material';
import {
  AttachFile as FileIcon,
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
  downloadUrl: string;
  uploadedAt?: string;
  createdBy?: string;
}

const AgentFileAttachment: React.FC<AgentFileAttachmentProps> = ({
  filename,
  fileType,
  fileSize,
  downloadUrl,
  uploadedAt,
  createdBy
}) => {
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

  const handleDownload = () => {
    window.open(downloadUrl, '_blank');
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
      
      <Tooltip title="Download file">
        <IconButton
          size="small"
          onClick={handleDownload}
          sx={{
            color: '#3b82f6',
            '&:hover': {
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
