import React, { useState, useEffect, useCallback } from 'react';
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
  Chip,
  Table,
  TableBody,
  TableRow,
  TableCell,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
  Description as TextIcon,
  InsertDriveFile as FileIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { fileReturnAPI } from '@/services/api';
import TilePreview from './TilePreview';
import { UnifiedTile } from '../../types/dashboardTypes';

interface FilePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  item: {
    id: string;
    name: string;
    type: 'context_item' | 'uploaded_file' | 'agent_file';
    s3_key?: string;
    metadata?: any;
    parentId?: string | null;
  };
  user_id: string;
  folder_path?: string; // Optional folder path for tile updates
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
  folder_path = '',
}) => {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!item.s3_key) {
      setError('No S3 key available for preview');
      setLoading(false);
      return;
    }

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
        // Ensure preview_type is defined, default to 'text' if missing
        const previewData: PreviewResponse = {
          ...response.data,
          preview_type: response.data.preview_type || 'text',
        };
        setPreviewData(previewData);
      } else {
        setError(response.error || 'Failed to load preview');
      }
    } catch (err: any) {
      console.error('Error fetching preview:', err);
      setError(err.message || 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  }, [user_id, item.s3_key, item.type]);

  useEffect(() => {
    if (open && item) {
      // Reset state when opening
      setPreviewData(null);
      setError(null);
      setLoading(false);

      // If item has metadata with data, use it directly
      if (item.metadata?.data && Object.keys(item.metadata.data).length > 0) {
        // Check if it's a tile
        const tileType = item.metadata.data.tileType || item.metadata.data.type;
        const isTileData = ['crypto', 'stock', 'stock_screener', 'news', 'portfolio',
          'politician_trades', 'sec_search', 'govt_contracts', 'congress_bills', 'lda_disclosures'].includes(tileType);
        
        if (isTileData) {
          // For tiles, pass the full data object
          setPreviewData({
            preview_type: 'context_item',
            content: item.metadata.data,
            metadata: {
              type: item.metadata.type,
              title: item.metadata.title || item.name,
            },
          });
        } else {
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
        }
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
      } else if (item.s3_key) {
        // For real files, fetch from API
        fetchPreview();
      } else {
        // No data available
        setError('No preview data available');
      }
    } else {
      // Reset state when dialog closes
      setPreviewData(null);
      setError(null);
      setLoading(false);
    }
  }, [open, item, fetchPreview]);

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

  // Formatting functions
  const formatCurrency = (amount?: number): string => {
    if (amount === undefined || amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatTransactionDate = (transactionDate?: number): string => {
    if (!transactionDate) return 'N/A';
    const dateStr = transactionDate.toString();
    if (dateStr.length !== 8) return 'N/A';
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    try {
      const date = new Date(`${year}-${month}-${day}`);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return 'N/A';
    }
  };

  const formatAmountRange = (trade: any): string => {
    if (trade.amountMin !== undefined && trade.amountMax !== undefined) {
      if (trade.amountMin === trade.amountMax) {
        return formatCurrency(trade.amountMin);
      }
      return `${formatCurrency(trade.amountMin)} - ${formatCurrency(trade.amountMax)}`;
    }
    if (trade.exactAmount) {
      return formatCurrency(trade.exactAmount);
    }
    return 'N/A';
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  // Check if content is a tile
  const isTile = (content: any): boolean => {
    if (!content) return false;
    
    // Check for tileType or type being a tile type
    const tileType = content.tileType || content.type;
    const validTileTypes = [
      'crypto', 'stock', 'stock_screener', 'news', 'portfolio',
      'politician_trades', 'sec_search', 'govt_contracts', 'congress_bills', 'lda_disclosures'
    ];
    
    return validTileTypes.includes(tileType);
  };

  // Convert content to UnifiedTile format
  const contentToTile = (content: any): UnifiedTile | null => {
    if (!isTile(content)) return null;
    
    // If content is already in UnifiedTile format, use it
    if (content.id && content.type) {
      return content as UnifiedTile;
    }
    
    // Otherwise, construct from data
    const data = content.data || content;
    return {
      id: content.id || data.id || data.tileId || `tile_${Date.now()}`,
      type: content.tileType || content.type || data.tileType || data.type,
      title: content.title || data.title || data.name || 'Untitled Tile',
      customTitle: data.customTitle,
      customColor: data.customColor,
      customIcon: data.customIcon,
      symbol: data.symbol,
      timeframe: data.timeframe,
      criteria: data.criteria,
      results: data.results,
      searchParams: data.searchParams,
      filterSettings: data.filterSettings,
      articles: data.articles,
      trades: data.trades,
      portfolioData: data.portfolioData,
      displayOptions: data.displayOptions || {},
      paginationState: data.paginationState,
      autoRefresh: data.autoRefresh || false,
      isPinned: data.isPinned || false,
      size: data.size || { width: 600, height: 600 },
      position: data.position,
      dashboard_id: data.dashboard_id || 'filesystem',
      created_at: data.created_at,
    } as UnifiedTile;
  };

  const renderContextItem = (content: any) => {
    // Check if this is a tile
    const tile = contentToTile(content);
    if (tile && folder_path !== undefined) {
      return (
        <TilePreview
          tile={tile}
          user_id={user_id}
          folder_path={folder_path || ''}
          item_id={item.id}
          onUpdate={(updatedTile) => {
            // Update local state if needed
            console.log('Tile updated:', updatedTile);
          }}
        />
      );
    }
    
    // Handle both nested data structure and flat structure
    let data = content;
    if (content.data && typeof content.data === 'object') {
      data = content.data;
    }
    const itemType = content.type || data.item_type || 'context_item';
    
    // Politician Trade
    if (itemType === 'politician_trade' || data.tradeId || data.politicianName || data.transactionType) {
      const infoFields = [
        { label: 'Politician', value: data.politicianName },
        { label: 'Position', value: data.position },
        { label: 'Party', value: data.party },
        { label: 'State/District', value: data.stateDistrict },
        { label: 'Security Symbol', value: data.securitySymbol },
        { label: 'Security Name', value: data.securityName },
        { label: 'Asset Type', value: data.assetType },
        { label: 'Transaction Type', value: data.transactionType },
        { label: 'Transaction Date', value: formatTransactionDate(data.transactionDate) },
        { label: 'Filing Date', value: formatDate(data.filingDate) },
        { label: 'Amount Range', value: formatAmountRange(data) },
        { label: 'Owner', value: data.owner },
        { label: 'Source', value: data.source },
        { label: 'Form Type', value: data.formType },
      ];

      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            // Blue scrollbar
            '&::-webkit-scrollbar': {
              width: '12px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: '#1f2937',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#3b82f6',
              borderRadius: '6px',
              '&:hover': {
                backgroundColor: '#2563eb',
              },
            },
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 1, fontWeight: 600 }}>
            {content.title || data.politicianName || 'Politician Trade'}
          </Typography>
          {content.subtitle && (
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
              {content.subtitle}
            </Typography>
          )}
          <Divider sx={{ my: 3, borderColor: '#374151' }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
            {infoFields
              .filter((field) => field.value && field.value !== 'N/A')
              .map((field) => (
                <Box 
                  key={field.label} 
                  sx={{ 
                    backgroundColor: 'rgba(16, 185, 129, 0.08)', 
                    borderRadius: 1, 
                    p: 1.5,
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                  }}
                >
                  <Typography variant="caption" sx={{ color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                    {field.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#ffffff', wordBreak: 'break-word', mt: 0.5 }}>
                    {field.value}
                  </Typography>
                </Box>
              ))}
          </Box>

          {data.websiteUrl && (
            <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label="Politician Website"
                size="small"
                sx={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: 600 }}
                icon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                component="a"
                href={data.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                clickable
              />
            </Box>
          )}

          {data.formS3Key && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" sx={{ color: '#f8fafc', mb: 1, fontWeight: 600 }}>
                Filing Document
              </Typography>
              <Paper sx={{ backgroundColor: 'rgba(15, 23, 42, 0.6)', borderRadius: 1, border: '1px solid #374151' }}>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell sx={{ borderColor: '#374151' }}>
                        <Typography variant="caption" sx={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          Filing Document
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#ffffff', wordBreak: 'break-word', mt: 0.5 }}>
                          {data.formS3Key.split('/').pop() || data.formS3Key}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Box>
          )}
        </Box>
      );
    }

    // Congress Bill
    if (itemType === 'congress_bill' || data.bill_id || data.bill_type || data.bill_number) {
      const infoFields = [
        { label: 'Bill Type', value: data.bill_type },
        { label: 'Bill Number', value: data.bill_number },
        { label: 'Congress', value: data.congress ? `${data.congress}th Congress` : null },
        { label: 'Introduced Date', value: formatDate(data.introduced_date) },
        { label: 'Sponsor Name', value: data.sponsor_name },
        { label: 'Sponsor Party', value: data.sponsor_party },
        { label: 'Sponsor State', value: data.sponsor_state },
        { label: 'Policy Area', value: data.policy_area },
        { label: 'Latest Action', value: data.latest_action },
        { label: 'Latest Action Date', value: formatDate(data.latest_action_date) },
      ];

      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            // Blue scrollbar
            '&::-webkit-scrollbar': {
              width: '12px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: '#1f2937',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#3b82f6',
              borderRadius: '6px',
              '&:hover': {
                backgroundColor: '#2563eb',
              },
            },
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 1, fontWeight: 600 }}>
            {content.title || `${data.bill_type || 'Bill'} ${data.bill_number || ''}` || 'Congress Bill'}
          </Typography>
          {content.subtitle && (
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
              {content.subtitle}
            </Typography>
          )}
          {data.bill_title && (
            <Typography variant="body1" sx={{ color: '#e5e7eb', mb: 3, fontStyle: 'italic' }}>
              {data.bill_title}
            </Typography>
          )}
          <Divider sx={{ my: 3, borderColor: '#374151' }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
            {infoFields
              .filter((field) => field.value && field.value !== 'N/A')
              .map((field) => (
                <Box 
                  key={field.label} 
                  sx={{ 
                    backgroundColor: 'rgba(59, 130, 246, 0.08)', 
                    borderRadius: 1, 
                    p: 1.5,
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                  }}
                >
                  <Typography variant="caption" sx={{ color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                    {field.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#ffffff', wordBreak: 'break-word', mt: 0.5 }}>
                    {field.value}
                  </Typography>
                </Box>
              ))}
          </Box>
        </Box>
      );
    }

    // LDA Disclosure
    if (itemType === 'lda_disclosure' || data.filing_uuid || data.registrant_name || data.client_name) {
      const infoFields = [
        { label: 'Registrant', value: data.registrant_name },
        { label: 'Client', value: data.client_name },
        { label: 'Filing Type', value: data.filing_type },
        { label: 'Filing Period', value: data.filing_period },
        { label: 'Filing Year', value: data.filing_year },
        { label: 'Amount', value: data.amount ? formatCurrency(data.amount) : null },
        { label: 'Date Posted', value: formatDate(data.date_posted) },
      ];

      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            // Blue scrollbar
            '&::-webkit-scrollbar': {
              width: '12px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: '#1f2937',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#3b82f6',
              borderRadius: '6px',
              '&:hover': {
                backgroundColor: '#2563eb',
              },
            },
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 1, fontWeight: 600 }}>
            {content.title || 'LDA Disclosure'}
          </Typography>
          {content.subtitle && (
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
              {content.subtitle}
            </Typography>
          )}
          <Divider sx={{ my: 3, borderColor: '#374151' }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
            {infoFields
              .filter((field) => field.value && field.value !== 'N/A')
              .map((field) => (
                <Box 
                  key={field.label} 
                  sx={{ 
                    backgroundColor: 'rgba(251, 191, 36, 0.08)', 
                    borderRadius: 1, 
                    p: 1.5,
                    border: '1px solid rgba(251, 191, 36, 0.2)',
                  }}
                >
                  <Typography variant="caption" sx={{ color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                    {field.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#ffffff', wordBreak: 'break-word', mt: 0.5 }}>
                    {field.value}
                  </Typography>
                </Box>
              ))}
          </Box>
        </Box>
      );
    }

    // Default: Show formatted JSON for unknown types
    return (
      <Box 
        sx={{ 
          p: 3,
          maxHeight: '70vh',
          overflow: 'auto',
          // Blue scrollbar
          '&::-webkit-scrollbar': {
            width: '12px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: '#1f2937',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: '#3b82f6',
            borderRadius: '6px',
            '&:hover': {
              backgroundColor: '#2563eb',
            },
          },
        }}
      >
        <Typography variant="h5" sx={{ color: '#ffffff', mb: 1, fontWeight: 600 }}>
          {content.title || item.name}
        </Typography>
        {content.subtitle && (
          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
            {content.subtitle}
          </Typography>
        )}
        <Divider sx={{ my: 3, borderColor: '#374151' }} />
        <Paper
          sx={{
            p: 2,
            backgroundColor: '#111827',
            border: '1px solid #374151',
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
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </Paper>
      </Box>
    );
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
        return renderContextItem(previewData.content);

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
                // Blue scrollbar
                '&::-webkit-scrollbar': {
                  width: '12px',
                },
                '&::-webkit-scrollbar-track': {
                  backgroundColor: '#1f2937',
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: '#3b82f6',
                  borderRadius: '6px',
                  '&:hover': {
                    backgroundColor: '#2563eb',
                  },
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

      <DialogContent 
        sx={{ 
          p: 0, 
          mt: 2,
          // Blue scrollbar for dialog content
          '&::-webkit-scrollbar': {
            width: '12px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: '#1f2937',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: '#3b82f6',
            borderRadius: '6px',
            '&:hover': {
              backgroundColor: '#2563eb',
            },
          },
        }}
      >
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

