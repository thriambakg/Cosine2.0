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
  Grid,
  Link,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
  Description as TextIcon,
  InsertDriveFile as FileIcon,
  OpenInNew as OpenInNewIcon,
  Launch as LaunchIcon,
  Description as DocumentIcon,
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

  // Helper function to download filing document
  const handleDownloadFiling = useCallback(async (s3Key: string, filename: string) => {
    try {
      const response = await fileReturnAPI.downloadFile({
        user_id,
        s3_key: s3Key,
        filename: filename,
        bucket: 'POLITICIAN_TRADES',
      });
      
      if (response.success && response.data?.download_url) {
        window.open(response.data.download_url, '_blank');
      } else {
        setError('Failed to download filing document');
      }
    } catch (err: any) {
      console.error('Error downloading filing:', err);
      setError('Failed to download filing document');
    }
  }, [user_id]);

  const formatLDACurrency = (amount?: number | string): string => {
    if (amount === undefined || amount === null || amount === '') return 'N/A';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'N/A';
    return formatCurrency(numAmount);
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
    
    const scrollbarStyles = {
      '&::-webkit-scrollbar': {
        width: '8px',
      },
      '&::-webkit-scrollbar-track': {
        backgroundColor: 'rgba(55, 65, 81, 0.3)',
      },
      '&::-webkit-scrollbar-thumb': {
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        borderRadius: '4px',
      },
      '&::-webkit-scrollbar-thumb:hover': {
        backgroundColor: 'rgba(59, 130, 246, 0.7)',
      },
    };
    
    // Politician Trade - New clean details page format
    if (itemType === 'politician_trade' || data.tradeId || data.politicianName || data.transactionType) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
            {content.title || data.politicianName || 'Politician Trade'}
          </Typography>
          
          {/* Trade Information Section */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Trade Information
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {data.politicianName && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Politician
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.politicianName}
                  </Typography>
                </Box>
              )}
              {data.position && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Position
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.position}
                  </Typography>
                </Box>
              )}
              {data.party && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Party
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.party}
                  </Typography>
                </Box>
              )}
              {data.stateDistrict && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    State/District
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.stateDistrict}
                  </Typography>
                </Box>
              )}
              {data.securitySymbol && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Security Symbol
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {data.securitySymbol}
                  </Typography>
                </Box>
              )}
              {data.securityName && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Security Name
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.securityName}
                  </Typography>
                </Box>
              )}
              {data.assetType && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Asset Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.assetType}
                  </Typography>
                </Box>
              )}
              {data.transactionType && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Transaction Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.transactionType}
                  </Typography>
                </Box>
              )}
              {data.transactionDate && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Transaction Date
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatTransactionDate(data.transactionDate)}
                  </Typography>
                </Box>
              )}
              {data.filingDate && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Filing Date
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatDate(data.filingDate)}
                  </Typography>
                </Box>
              )}
              {formatAmountRange(data) !== 'N/A' && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Amount Range
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {formatAmountRange(data)}
                  </Typography>
                </Box>
              )}
              {data.owner && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Owner
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.owner}
                  </Typography>
                </Box>
              )}
              {data.formType && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Form Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.formType}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* Filing Document Section */}
          {data.formS3Key && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Filing Document
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1 }}>
                  {data.formS3Key.split('/').pop() || data.formS3Key}
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon />}
                  onClick={() => handleDownloadFiling(data.formS3Key, data.formS3Key.split('/').pop() || 'filing.pdf')}
                  sx={{
                    color: '#3b82f6',
                    borderColor: '#3b82f6',
                    '&:hover': {
                      borderColor: '#60a5fa',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  Download
                </Button>
              </Box>
            </Box>
          )}

          {/* Politician Website */}
          {data.websiteUrl && (
            <Box sx={{ mb: 3 }}>
              <Button
                variant="outlined"
                component="a"
                href={data.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LaunchIcon />}
                sx={{
                  color: '#3b82f6',
                  borderColor: '#3b82f6',
                  '&:hover': {
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                View Politician Website
              </Button>
            </Box>
          )}
        </Box>
      );
    }

    // Congress Bill - Match details page format
    if (itemType === 'congress_bill' || data.bill_id || data.bill_type || data.bill_number) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
            {content.title || `${data.bill_type || 'Bill'} ${data.bill_number || ''}` || 'Congress Bill'}
          </Typography>
          {data.bill_title && (
            <Typography variant="body1" sx={{ color: '#e5e7eb', mb: 3, fontStyle: 'italic' }}>
              {data.bill_title}
            </Typography>
          )}

          {/* Bill Overview Section */}
          <Box sx={{ mb: 4, borderBottom: '1px solid #374151', pb: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {/* Left Column: Sponsor & Bill Info */}
              <Box>
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Sponsor
                  </Typography>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {data.sponsor_full_name || data.sponsor_name || 'N/A'}
                  </Typography>
                  {data.sponsor_party && data.sponsor_state && (
                    <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>
                      {data.sponsor_party} - {data.sponsor_state}
                    </Typography>
                  )}
                </Box>
                
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Bill Information
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {data.bill_type && data.bill_number && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Type:</strong> {data.bill_type}.{data.bill_number}
                      </Typography>
                    )}
                    {data.congress && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Congress:</strong> {data.congress}
                      </Typography>
                    )}
                    {data.policy_area && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Policy Area:</strong> {data.policy_area}
                      </Typography>
                    )}
                    {data.bipartisan !== undefined && data.bipartisan !== null && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Bipartisan:</strong> {data.bipartisan === 1 ? 'Yes' : 'No'}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Box>
              
              {/* Right Column: Dates & Actions */}
              <Box>
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Dates
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {data.introduced_date && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Introduced:</strong> {formatDate(data.introduced_date)}
                      </Typography>
                    )}
                    {data.latest_action_date && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Latest Action:</strong> {formatDate(data.latest_action_date)}
                      </Typography>
                    )}
                    {data.update_date && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Last Updated:</strong> {formatDate(data.update_date)}
                      </Typography>
                    )}
                  </Box>
                </Box>
                
                {data.action_count !== undefined && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                      Actions
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                      {data.action_count || 0} action(s)
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>

          {/* Summary Section */}
          {data.summary_text && (
            <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                Summary
              </Typography>
              <Typography 
                variant="body1" 
                sx={{ 
                  color: '#e2e8f0', 
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
                dangerouslySetInnerHTML={{ 
                  __html: data.summary_text?.replace(/\n/g, '<br />') || '' 
                }}
              />
            </Box>
          )}

          {/* Cosponsors Section */}
          {data.cosponsor_count > 0 && data.cosponsors_json && (() => {
            try {
              const cosponsors = JSON.parse(data.cosponsors_json);
              return (
                <Box sx={{ mb: 4 }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                    Cosponsors ({data.cosponsor_count})
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {Array.isArray(cosponsors) && cosponsors.map((cosponsor: any, idx: number) => (
                      <Chip
                        key={idx}
                        label={`${cosponsor.fullName || cosponsor.name || 'Unknown'} (${cosponsor.party || ''}-${cosponsor.state || ''})`}
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              );
            } catch {
              return null;
            }
          })()}

          {/* Bill URL */}
          {data.bill_url && (
            <Box sx={{ mt: 3 }}>
              <Button
                variant="outlined"
                component="a"
                href={data.bill_url}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LaunchIcon />}
                sx={{
                  color: '#3b82f6',
                  borderColor: '#3b82f6',
                  '&:hover': {
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                View on Congress.gov
              </Button>
            </Box>
          )}
        </Box>
      );
    }

    // LDA Disclosure - Match details page format
    if (itemType === 'lda_disclosure' || data.filing_uuid || data.registrant_name || data.client_name) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600 }}>
              {content.title || 'LDA Disclosure'}
            </Typography>
            {data.filing_document_url && (
              <Button
                component="a"
                href={data.filing_document_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="outlined"
                size="small"
                sx={{
                  color: '#3b82f6',
                  borderColor: '#3b82f6',
                  fontSize: '0.75rem',
                  py: 0.5,
                  px: 1.5,
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                View Filing Document
              </Button>
            )}
          </Box>

          {/* Filing Information */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Filing Information
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {data.filing_uuid && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing UUID:</strong> <span style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{data.filing_uuid}</span>
                </Typography>
              )}
              {(data.report_type || data.filing_type) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing Type:</strong> {data.report_type || data.filing_type || 'N/A'}
                  {(data.report_type_display || data.filing_type_display) && ` (${data.report_type_display || data.filing_type_display})`}
                </Typography>
              )}
              {(data.filing_period_display || data.filing_period) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing Period:</strong> {data.filing_period_display || data.filing_period || 'N/A'}
                </Typography>
              )}
              {data.filing_year && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing Year:</strong> {data.filing_year}
                </Typography>
              )}
              {(data.dt_posted || data.date_posted) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Date Posted:</strong> {formatDate(data.dt_posted || data.date_posted)}
                </Typography>
              )}
              {(data.amount_reported || data.amount) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Amount:</strong> {formatLDACurrency(data.amount_reported || data.amount)}
                </Typography>
              )}
              {data.general_issue_code && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>General Issue Code:</strong> {data.general_issue_code}
                  {data.general_issue_code_display && ` (${data.general_issue_code_display})`}
                </Typography>
              )}
              {data.state && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>State:</strong> {data.state}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Registrant Information */}
          {(data.registrant || data.registrant_name) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Registrant
              </Typography>
              <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.95rem' }}>
                {data.registrant?.name || data.registrant_name || 'N/A'}
              </Typography>
              {data.registrant?.description && (
                <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1, fontStyle: 'italic' }}>
                  {data.registrant.description}
                </Typography>
              )}
            </Box>
          )}

          {/* Client Information */}
          {(data.client || data.client_name) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Client
              </Typography>
              <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.95rem' }}>
                {data.client?.name || data.client_name || 'N/A'}
              </Typography>
              {data.client?.general_description && (
                <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1, fontStyle: 'italic' }}>
                  {data.client.general_description}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      );
    }

    // SEC Filing - Match details page format
    if (itemType === 'sec_filing' || data.form || data.filingEntity || data.accession) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
            {content.title || `${data.form || 'Filing'} - ${data.filingEntity || data.reportingFor || 'SEC Filing'}`}
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                Filing Information
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {data.form && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Form</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff' }}>{data.form}</Typography>
                  </Box>
                )}
                {data.filingDate && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Filing Date</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff' }}>{data.filingDate}</Typography>
                  </Box>
                )}
                {(data.reportingFor || data.filingEntity) && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Reporting For</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff' }}>{data.reportingFor || data.filingEntity}</Typography>
                  </Box>
                )}
                {data.cik && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>CIK</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff', fontFamily: 'monospace' }}>{data.cik}</Typography>
                  </Box>
                )}
                {data.accession && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Accession Number</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff', fontFamily: 'monospace' }}>{data.accession}</Typography>
                  </Box>
                )}
              </Box>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                Filing Page
              </Typography>
              {data.filingPageUrl ? (
                <Link
                  href={data.filingPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    color: '#3b82f6',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                  }}
                >
                  <OpenInNewIcon sx={{ fontSize: 16 }} />
                  View on SEC.gov
                </Link>
              ) : (
                <Typography variant="body2" sx={{ color: '#9ca3af' }}>Not available</Typography>
              )}
            </Grid>

            {/* Document URLs */}
            {data.documentUrls && data.documentUrls.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                  Document Format Files ({data.documentUrls.length})
                </Typography>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 1, 
                  maxHeight: '400px', 
                  overflowY: 'auto',
                  ...scrollbarStyles,
                }}>
                  {data.documentUrls.map((url: string, index: number) => {
                    const filename = url.split('/').pop() || `Document ${index + 1}`;
                    return (
                      <Box
                        key={index}
                        sx={{
                          p: 1.5,
                          border: '1px solid #374151',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(31, 41, 55, 0.5)',
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <DocumentIcon sx={{ fontSize: 18, color: '#3b82f6' }} />
                          <Link
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: '#3b82f6',
                              textDecoration: 'none',
                              fontSize: '0.875rem',
                              flex: 1,
                              '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                            }}
                          >
                            {filename}
                            <OpenInNewIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle' }} />
                          </Link>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      );
    }

    // Government Contract - Match details page format
    if (itemType === 'govt_contract' || data.award_id || data.recipient_name) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
            {content.title || `Government Contract - ${data.recipient_name || data.award_id || 'Contract'}`}
          </Typography>

          {/* Award Information */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Award Information
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {data.award_id && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Award ID
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {data.award_id}
                  </Typography>
                </Box>
              )}
              {data.award_type && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Award Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.award_type}
                  </Typography>
                </Box>
              )}
              {data.is_assistance !== undefined && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.is_assistance ? 'Financial Assistance' : 'Contract'}
                  </Typography>
                </Box>
              )}
              {data.fiscal_year && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Fiscal Year
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {data.fiscal_year}
                  </Typography>
                </Box>
              )}
              {(data.combined_obligated_amount || data.total_obligated_amount || data.total_obligation) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    {data.combined_obligated_amount && data.award_or_idv_flag === 'IDV' 
                      ? 'Combined Obligated Amount' 
                      : 'Total Obligated Amount'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {formatCurrency(
                      data.combined_obligated_amount || 
                      data.total_obligated_amount || 
                      data.total_obligation
                    )}
                  </Typography>
                </Box>
              )}
              {(data.period_of_performance_start_date || data.period_start_date) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Period Start Date
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatDate(data.period_of_performance_start_date || data.period_start_date)}
                  </Typography>
                </Box>
              )}
              {(data.period_of_performance_current_end_date || data.period_end_date) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Period End Date
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatDate(data.period_of_performance_current_end_date || data.period_end_date)}
                  </Typography>
                </Box>
              )}
            </Box>
            {data.usaspending_permalink && (
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  href={data.usaspending_permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    color: '#3b82f6',
                    borderColor: '#3b82f6',
                    '&:hover': {
                      borderColor: '#60a5fa',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  View on USAspending.gov
                </Button>
              </Box>
            )}
          </Box>

          {/* Agency Information */}
          {(data.awarding_agency_name || data.funding_agency_name) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Agency Information
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {data.awarding_agency_name && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                      Awarding Agency
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      {data.awarding_agency_name}
                    </Typography>
                    {data.awarding_agency_code && (
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Code: {data.awarding_agency_code}
                      </Typography>
                    )}
                  </Box>
                )}
                {data.funding_agency_name && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                      Funding Agency
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      {data.funding_agency_name}
                    </Typography>
                    {data.funding_agency_code && (
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Code: {data.funding_agency_code}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Recipient Information */}
          {data.recipient_name && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Recipient Information
              </Typography>
              <Box>
                <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                  Recipient Name
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  {data.recipient_name}
                </Typography>
                {data.recipient_location && (
                  <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1 }}>
                    {data.recipient_location}
                  </Typography>
                )}
              </Box>
            </Box>
          )}

          {/* Description */}
          {data.description && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 1, fontWeight: 600 }}>
                Description
              </Typography>
              <Typography variant="body2" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                {data.description}
              </Typography>
            </Box>
          )}
        </Box>
      );
    }

    // News Article - Match details page format
    if (itemType === 'news_article' || data.title || data.source_name || data.source_url) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
            {content.title || data.title || 'News Article'}
          </Typography>
          {(data.source_name || data.source_url) && (
            <Typography variant="body2" sx={{ color: '#94a3b8', mb: 3 }}>
              {data.source_name || data.source_url}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Image */}
            {data.image_url && (
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, fontWeight: 600 }}>
                  Image
                </Typography>
                <Box
                  component="img"
                  src={data.image_url}
                  alt={data.title || 'Article image'}
                  sx={{
                    width: '100%',
                    maxHeight: 400,
                    objectFit: 'contain',
                    borderRadius: '4px',
                    border: '1px solid #374151',
                  }}
                />
              </Box>
            )}

            {/* Description */}
            {data.description && (
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, fontWeight: 600 }}>
                  Description
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0', lineHeight: 1.6 }}>
                  {data.description}
                </Typography>
              </Box>
            )}

            {/* Keywords */}
            {data.keywords && (
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, fontWeight: 600 }}>
                  Keywords
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {data.keywords.split(',').map((keyword: string, index: number) => (
                    <Chip
                      key={index}
                      label={keyword.trim()}
                      size="small"
                      sx={{
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        color: '#93c5fd',
                        border: '1px solid #3b82f6',
                        fontSize: '0.75rem',
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* Source URL */}
            {data.source_url && (
              <Box>
                <Button
                  variant="contained"
                  onClick={() => {
                    window.open(data.source_url, '_blank', 'noopener,noreferrer');
                  }}
                  startIcon={<LaunchIcon />}
                  sx={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    '&:hover': { 
                      background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' 
                    },
                    color: '#ffffff',
                    fontWeight: 600,
                  }}
                >
                  Open Article
                </Button>
              </Box>
            )}
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
          ...scrollbarStyles,
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

