import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
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
  Tooltip,
  Portal,
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
  Warning as WarningIcon,
  InfoOutlined as InfoIcon,
  Minimize as MinimizeIcon,
  Dashboard as DashboardIcon,
} from '@mui/icons-material';
import TutorialHelpIcon from './TutorialHelpIcon';
import { fileReturnAPI, filesystemAPI } from '@/services/api';
import { API_CONFIG } from '@/config/api';
import TilePreview from './TilePreview';
import { UnifiedTile } from '../../types/dashboardTypes';
import ItemDetailsDialog, { ItemType } from './ItemDetailsDialog';
import { useSafeDialogManager } from '../../hooks/useSafeDialogManager';

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
  // Dialog manager props (optional for backward compatibility)
  onMinimize?: () => void;
  dialogId?: string;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
  onSizeChange?: (size: { width: number; height: number }) => void;
  onCacheContent?: (content: any) => void;
  cachedContent?: any;
  zIndex?: number;
  onBringToFront?: () => void;
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
  onMinimize,
  dialogId,
  initialPosition,
  initialSize,
  onSizeChange,
  onCacheContent,
  cachedContent,
  zIndex = 1000,
  onBringToFront,
}) => {
  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(cachedContent || null);
  const [error, setError] = useState<string | null>(null);
  
  // Dialog manager for minimize functionality (only use if not already managed)
  const safeDialogManager = useSafeDialogManager();
  const dialogManager = (!dialogId && safeDialogManager) ? safeDialogManager : undefined;
  
  // Resizable and movable state
  const [position, setPosition] = useState(initialPosition || { x: 100, y: 100 });
  const [size, setSize] = useState(initialSize || { width: 900, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const paperRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  // Preview values stored in refs to avoid re-renders during drag/resize
  const previewPositionRef = useRef({ x: 100, y: 100 });
  const previewSizeRef = useRef({ width: 900, height: 600 });

  const fetchPreview = useCallback(async () => {
    // Check cache first
    if (cachedContent && dialogId) {
      setPreviewData(cachedContent);
      setLoading(false);
      return;
    }

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
        
        // Cache the content
        if (onCacheContent) {
          onCacheContent(previewData);
        }
        if (dialogId) {
          // Save to sessionStorage asynchronously to avoid blocking
          const saveCache = () => {
            try {
              sessionStorage.setItem(`dialog-cache-${dialogId}`, JSON.stringify(previewData));
            } catch (e) {
              // Ignore
            }
          };
          if ('requestIdleCallback' in window) {
            requestIdleCallback(saveCache, { timeout: 1000 });
          } else {
            setTimeout(saveCache, 0);
          }
        }
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
  }, [user_id, item.s3_key, item.type, dialogId, onCacheContent, cachedContent]);

  // Sync position and size with initial values
  useEffect(() => {
    if (initialPosition) {
      setPosition(initialPosition);
      previewPositionRef.current = initialPosition;
    }
  }, [initialPosition?.x, initialPosition?.y]);

  useEffect(() => {
    if (initialSize) {
      setSize(initialSize);
      previewSizeRef.current = initialSize;
    }
  }, [initialSize?.width, initialSize?.height]);

  useEffect(() => {
    if (open && item) {
      // Check cache first
      if (cachedContent) {
        setPreviewData(cachedContent);
        setError(null);
        setLoading(false);
        return;
      }

      // Reset state when opening
      setPreviewData(null);
      setError(null);
      setLoading(false);

      // PRIORITY: If item has s3_key, always fetch from API to get fresh data
      // This ensures newly added items load previews correctly
      if (item.s3_key) {
        console.log('📄 FilePreviewDialog: Item has s3_key, fetching preview from API:', {
          s3_key: item.s3_key,
          item_type: item.type,
          has_metadata_data: !!(item.metadata?.data && Object.keys(item.metadata.data).length > 0),
        });
        // For files with s3_key, always fetch from API to ensure we get the latest content
        fetchPreview();
      } else if (item.metadata?.data && Object.keys(item.metadata.data).length > 0) {
        // Fallback: If no s3_key but has metadata.data, use it directly (for tiles, etc.)
        console.log('📄 FilePreviewDialog: Using metadata.data (no s3_key):', {
          item_id: item.id,
          has_data: true,
        });
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
        console.log('📄 FilePreviewDialog: Constructing from metadata (no s3_key, no data):', {
          item_id: item.id,
        });
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
      } else {
        // No data available
        console.error('📄 FilePreviewDialog: No preview data available:', {
          item_id: item.id,
          has_s3_key: !!item.s3_key,
          has_metadata: !!item.metadata,
          has_metadata_data: !!(item.metadata?.data && Object.keys(item.metadata.data).length > 0),
        });
        setError('No preview data available');
      }
    } else {
      // Reset state when dialog closes
      setPreviewData(null);
      setError(null);
      setLoading(false);
    }
  }, [open, item, fetchPreview, cachedContent]);

  const handleAddToContext = useCallback(() => {
    if (!user_id || !item.s3_key) {
      // Try to construct s3_key if missing
      const isCosineFile = item.type === 'context_item' || 
                          item.name?.toLowerCase().endsWith('.cosine') ||
                          item.metadata?.type === 'context_item';
      
      let s3_key = item.s3_key;
      
      if (!s3_key && isCosineFile) {
        // Construct s3_key for .cosine files
        const folderPath = folder_path || (item.parentId && item.parentId !== 'root' ? item.parentId : '');
        const folderPathPart = folderPath ? `${folderPath}/` : '';
        s3_key = `users/${user_id}/filesys/${folderPathPart}${item.id}.cosine`;
      }
      
      if (!s3_key) {
        alert(`Cannot add "${item.name}" to context: file location information is missing.`);
        return;
      }
      
      // Create context item
      const contextItem = {
        id: `filesystem_item_${item.id}_${Date.now()}`,
        type: (item.metadata?.type || item.type) as any,
        title: item.metadata?.title || item.name,
        subtitle: item.metadata?.subtitle || 'Filesystem Item',
        data: {
          filesystem_type: 'item',
          item_id: item.id,
          s3_key: s3_key,
          item_type: item.type,
        },
        timestamp: Date.now(),
      };
      
      // Dispatch to sidebar context
      const event = new CustomEvent('add-to-sidebar-context', {
        detail: contextItem
      });
      window.dispatchEvent(event);
    } else {
      // Create context item with available s3_key
      const contextItem = {
        id: `filesystem_item_${item.id}_${Date.now()}`,
        type: (item.metadata?.type || item.type) as any,
        title: item.metadata?.title || item.name,
        subtitle: item.metadata?.subtitle || 'Filesystem Item',
        data: {
          filesystem_type: 'item',
          item_id: item.id,
          s3_key: item.s3_key,
          item_type: item.type,
        },
        timestamp: Date.now(),
      };
      
      // Dispatch to sidebar context
      const event = new CustomEvent('add-to-sidebar-context', {
        detail: contextItem
      });
      window.dispatchEvent(event);
    }
  }, [item, user_id, folder_path]);

  const handleDownload = async () => {
    // Always make an API call to get the download URL (ensures encrypted .cosine files are downloaded correctly)
    if (item.s3_key) {
      try {
        setDownloadLoading(true);
        const response = await fileReturnAPI.downloadFile({
          user_id,
          s3_key: item.s3_key,
          filename: item.name,
        });

        if (response.success && response.data?.download_url) {
          // Create a temporary anchor element for smooth download without page navigation
          const link = document.createElement('a');
          link.href = response.data.download_url;
          link.download = response.data.filename || item.name;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.style.display = 'none';
          
          // Append to body, click, then remove
          document.body.appendChild(link);
          link.click();
          
          // Clean up after a short delay
          setTimeout(() => {
            document.body.removeChild(link);
          }, 100);
        } else {
          setError('Failed to get download URL');
        }
      } catch (err) {
        console.error('Error downloading file:', err);
        setError('Failed to download file');
      } finally {
        setDownloadLoading(false);
      }
    } else if (previewData?.download_url) {
      // Fallback to preview data download URL if available
      // Create a temporary anchor element for smooth download without page navigation
      const link = document.createElement('a');
      link.href = previewData.download_url;
      link.download = previewData.filename || item.name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      
      // Append to body, click, then remove
      document.body.appendChild(link);
      link.click();
      
      // Clean up after a short delay
      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
    } else {
      setError('Download not available for this item');
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
      'politician_trades', 'sec_search', 'govt_contracts', 'congress_bills', 'lda_disclosures', 'folder'
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
          containerSize={size}
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

          {/* Actions Section */}
          {data.actions_json && (() => {
            try {
              const actions = JSON.parse(data.actions_json);
              if (Array.isArray(actions) && actions.length > 0) {
                return (
                  <Box sx={{ mb: 4 }}>
                    <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                      Actions ({data.action_count || actions.length})
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {actions.map((action: any, idx: number) => (
                        <Box
                          key={idx}
                          sx={{
                            p: 2,
                            backgroundColor: 'rgba(30, 41, 59, 0.5)',
                            borderRadius: '4px',
                            border: '1px solid #374151',
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                            <Typography variant="body2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                              {action.actionDate && formatDate(action.actionDate)}
                            </Typography>
                            {action.type && (
                              <Chip
                                label={action.type}
                                size="small"
                                sx={{
                                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                  color: '#93c5fd',
                                  border: '1px solid #3b82f6',
                                }}
                              />
                            )}
                          </Box>
                          {action.text && (
                            <Typography variant="body1" sx={{ color: '#e2e8f0', mt: 1 }}>
                              {action.text}
                            </Typography>
                          )}
                          {action.committees && Array.isArray(action.committees) && action.committees.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                                Committees:
                              </Typography>
                              {action.committees.map((committee: any, cIdx: number) => (
                                <Typography key={cIdx} variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>
                                  • {committee.name || committee.systemCode}
                                </Typography>
                              ))}
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                );
              }
            } catch (e) {
              // If parsing fails, show the summary text
              if (data.actions_summary) {
                return (
                  <Box sx={{ mb: 4 }}>
                    <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                      Actions Summary
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                      {data.actions_summary}
                    </Typography>
                  </Box>
                );
              }
            }
            return null;
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

          {/* All Lobbyist Names */}
          {data?.all_lobbyist_names && Array.isArray(data.all_lobbyist_names) && data.all_lobbyist_names.length > 0 && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Lobbyists
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {data.all_lobbyist_names.map((name: string, index: number) => (
                  <Chip
                    key={index}
                    label={name}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: '#93c5fd',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.25)',
                      },
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Lobbying Activities */}
          {data?.lobbying_activities && Array.isArray(data.lobbying_activities) && data.lobbying_activities.length > 0 && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Lobbying Activities
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.lobbying_activities.map((activity: any, index: number) => (
                  <Box
                    key={index}
                    sx={{
                      p: 2,
                      backgroundColor: 'rgba(15, 23, 42, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #1e293b',
                    }}
                  >
                    {/* Description */}
                    {activity.description && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 2 }}>
                        {activity.description}
                      </Typography>
                    )}

                    {/* General Issue Code */}
                    {(activity.general_issue_code || activity.general_issue_code_display) && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 0.5 }}>
                          General Issue Code
                        </Typography>
                        <Chip
                          label={activity.general_issue_code_display || activity.general_issue_code}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(139, 92, 246, 0.15)',
                            color: '#c4b5fd',
                            border: '1px solid rgba(139, 92, 246, 0.3)',
                          }}
                        />
                        {activity.general_issue_code && activity.general_issue_code_display && activity.general_issue_code !== activity.general_issue_code_display && (
                          <Typography variant="caption" sx={{ color: '#6b7280', ml: 1 }}>
                            ({activity.general_issue_code})
                          </Typography>
                        )}
                      </Box>
                    )}

                    {/* Government Entities */}
                    {activity.government_entities && Array.isArray(activity.government_entities) && activity.government_entities.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 1 }}>
                          Government Entities
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {activity.government_entities.map((entity: any, entityIndex: number) => (
                            <Chip
                              key={entityIndex}
                              label={entity.name || entity}
                              size="small"
                              sx={{
                                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                color: '#6ee7b7',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}

                    {/* Lobbyists for this activity */}
                    {activity.lobbyists && Array.isArray(activity.lobbyists) && activity.lobbyists.length > 0 && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 1 }}>
                          Lobbyists ({activity.lobbyists.length})
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {activity.lobbyists.map((lobbyist: any, lobbyistIndex: number) => {
                            const lobbyistName = lobbyist.lobbyist
                              ? `${lobbyist.lobbyist.first_name || ''} ${lobbyist.lobbyist.middle_name || ''} ${lobbyist.lobbyist.last_name || ''} ${lobbyist.lobbyist.suffix_display || ''}`.trim() || lobbyist.lobbyist.nickname || 'Unknown'
                              : lobbyist.name || 'Unknown';
                            return (
                              <Chip
                                key={lobbyistIndex}
                                label={lobbyistName}
                                size="small"
                                sx={{
                                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                  color: '#93c5fd',
                                  border: '1px solid rgba(59, 130, 246, 0.3)',
                                }}
                              />
                            );
                          })}
                        </Box>
                      </Box>
                    )}

                    {/* Foreign Entity Issues */}
                    {activity.foreign_entity_issues && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 0.5 }}>
                          Foreign Entity Issues
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0', fontStyle: 'italic' }}>
                          {activity.foreign_entity_issues}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
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
                    const s3Key = data.documentS3Keys?.[url];
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
                          {s3Key && (
                            <IconButton
                              size="small"
                              onClick={async () => {
                                try {
                                  console.log('📥 Downloading SEC filing document:', filename);
                                  
                                  if (!user_id) {
                                    console.error('Missing user ID for file download');
                                    alert('Please log in to download files');
                                    return;
                                  }
                                  
                                  const response = await fetch(`${API_CONFIG.BASE_URL}/file-download`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      user_id: user_id,
                                      session_id: '', // Optional for SEC filings
                                      bucket: 'SEC_FILINGS',
                                      s3_key: s3Key,
                                      filename: filename
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
                                  link.target = '_blank';
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  
                                  console.log('✅ File download started');
                                } catch (error) {
                                  console.error('❌ Download failed:', error);
                                  alert('Failed to download file. Please try again.');
                                }
                              }}
                              sx={{
                                color: '#3b82f6',
                                ml: 'auto',
                                '&:hover': { color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.1)' }
                              }}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Grid>
            )}

            {/* Data Files */}
            {data.dataFileUrls && data.dataFileUrls.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                  Data Files ({data.dataFileUrls.length})
                </Typography>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 1, 
                  maxHeight: '400px', 
                  overflowY: 'auto',
                  ...scrollbarStyles,
                }}>
                  {data.dataFileUrls.map((url: string, index: number) => {
                    const filename = url.split('/').pop() || `Data File ${index + 1}`;
                    const s3Key = data.dataFileS3Keys?.[url];
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
                          {s3Key && (
                            <IconButton
                              size="small"
                              onClick={async () => {
                                try {
                                  console.log('📥 Downloading SEC filing data file:', filename);
                                  
                                  if (!user_id) {
                                    console.error('Missing user ID for file download');
                                    alert('Please log in to download files');
                                    return;
                                  }
                                  
                                  const response = await fetch(`${API_CONFIG.BASE_URL}/file-download`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      user_id: user_id,
                                      session_id: '', // Optional for SEC filings
                                      bucket: 'SEC_FILINGS',
                                      s3_key: s3Key,
                                      filename: filename
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
                                  link.target = '_blank';
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  
                                  console.log('✅ File download started');
                                } catch (error) {
                                  console.error('❌ Download failed:', error);
                                  alert('Failed to download file. Please try again.');
                                }
                              }}
                              sx={{
                                color: '#3b82f6',
                                ml: 'auto',
                                '&:hover': { color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.1)' }
                              }}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          )}
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

          {/* Award Overview Section - Two Columns */}
          <Box sx={{ mb: 4, borderBottom: '1px solid #374151', pb: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {/* Left Column: Awarding Agency & Recipient */}
              <Box>
                {(data.awarding_agency_name || data.awarding_agency_code) && (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                      Awarding Agency
                    </Typography>
                    <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {data.awarding_agency_name || 'N/A'}
                      {data.awarding_agency_code && (
                        <Typography component="span" variant="body2" sx={{ color: '#64748b', ml: 1 }}>
                          ({data.awarding_agency_code})
                        </Typography>
                      )}
                    </Typography>
                  </Box>
                )}
                
                {data.recipient_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                      Recipient
                    </Typography>
                    <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      {data.recipient_name}
                    </Typography>
                    {data.recipient_location && (
                      <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>
                        {data.recipient_location}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
              
              {/* Right Column: Award Status & Dates */}
              <Box>
                {(() => {
                  const startDate = data.period_of_performance_start_date || data.period_start_date;
                  const endDate = data.period_of_performance_current_end_date || 
                                (data.award_or_idv_flag === 'IDV' ? data.ordering_period_end_date : null) ||
                                data.period_end_date;
                  if (startDate && endDate) {
                    const end = new Date(endDate);
                    const now = new Date();
                    const remainingDays = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
                    const yearsRemaining = Math.floor(remainingDays / 365);
                    
                    return (
                      <Box sx={{ mb: 3 }}>
                        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                          Status
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 600 }}>
                          In Progress
                        </Typography>
                        {yearsRemaining > 0 && (
                          <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                            ({yearsRemaining} {yearsRemaining === 1 ? 'year' : 'years'} remain)
                          </Typography>
                        )}
                      </Box>
                    );
                  }
                  return null;
                })()}
                
                {(data.period_of_performance_start_date || data.period_start_date) && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                      Period of Performance
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatDate(data.period_of_performance_start_date || data.period_start_date)} - {formatDate(data.period_of_performance_current_end_date || data.period_end_date)}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>

          {/* Chart Visualization */}
          {(() => {
            const obligatedAmount = data.combined_obligated_amount || 
                                   data.total_obligated_amount || 
                                   data.total_obligation || 0;
            const outlayedAmount = parseFloat(data.total_outlayed_amount_for_overall_award as string) || 0;
            const nonFederalFunding = parseFloat(data.total_non_federal_funding_amount as string) || 0;
            const totalFunding = obligatedAmount;
            
            if (obligatedAmount > 0) {
              return (
                <Box sx={{ mb: 4 }}>
                  <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                    Funding Overview
                  </Typography>
                  <Box sx={{ mb: 3, position: 'relative', width: '100%', minHeight: '400px' }}>
                    {(() => {
                      const chartWidth = 647;
                      const chartHeight = 400;
                      const barHeight = 50;
                      const barY = 160;
                      
                      // Calculate widths based on obligated amount as the full bar
                      const obligatedWidth = chartWidth;
                      const outlayedWidth = obligatedAmount > 0 ? (outlayedAmount / obligatedAmount) * chartWidth : 0;
                      
                      return (
                        <Box sx={{ position: 'relative', width: '100%', height: `${chartHeight}px`, overflow: 'hidden' }}>
                          <svg width="100%" height={chartHeight} style={{ maxWidth: `${chartWidth}px` }}>
                            {/* Base rectangle (light gray background) */}
                            <rect x="0" y={barY} width={chartWidth} height={barHeight} fill="#dce4ee" rx="5" ry="5" />
                            
                            {/* Obligated amount bar (blue - full width) */}
                            <rect x="0" y={barY + 5} width={obligatedWidth} height={barHeight - 10} fill="#4773aa" rx="5" ry="5" />
                            
                            {/* Outlayed amount progress bar (darker blue/green overlay showing what's been paid) */}
                            {outlayedAmount > 0 && (
                              <rect 
                                x="0" 
                                y={barY + 5} 
                                width={outlayedWidth} 
                                height={barHeight - 10} 
                                fill="#10b981" 
                                rx="5" 
                                ry="5"
                                opacity="0.8"
                              />
                            )}
                            
                            {/* Vertical line for obligated amount */}
                            <line 
                              x1={obligatedWidth} 
                              y1={90} 
                              x2={obligatedWidth} 
                              y2={barY + barHeight + 10} 
                              stroke="#4773aa" 
                              strokeWidth="4"
                            />
                            
                            {/* Vertical line for outlayed amount (if different from obligated) */}
                            {outlayedAmount > 0 && outlayedWidth < obligatedWidth && (
                              <line 
                                x1={outlayedWidth} 
                                y1={barY} 
                                x2={outlayedWidth} 
                                y2={barY + barHeight} 
                                stroke="#10b981" 
                                strokeWidth="4"
                              />
                            )}
                            
                            {/* Outlayed Amount Label (if outlayed > 0) */}
                            {outlayedAmount > 0 && outlayedWidth > 50 && (
                              <foreignObject width={outlayedWidth} height="70" x="0" y={90}>
                                <Box sx={{ textAlign: 'left', backgroundColor: 'rgba(15, 23, 42, 0.98)', padding: '4px 8px', borderRadius: '4px', maxWidth: `${outlayedWidth}px` }}>
                                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '18px' }}>
                                    {formatCurrency(outlayedAmount)}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>Amount Paid</Typography>
                                </Box>
                              </foreignObject>
                            )}
                            
                            {/* Obligated Amount Label */}
                            <foreignObject width={chartWidth} height="70" x="-8" y={90}>
                              <Box sx={{ float: 'right', textAlign: 'right', backgroundColor: 'rgba(15, 23, 42, 0.98)', padding: '4px 8px', borderRadius: '4px' }}>
                                <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '20px' }}>
                                  {formatCurrency(obligatedAmount)}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#94a3b8' }}>Obligated Amount</Typography>
                              </Box>
                            </foreignObject>
                            
                            {/* Total Funding Label */}
                            <foreignObject width={chartWidth} height="60" x="0" y={300}>
                              <Box sx={{ float: 'right', textAlign: 'right', padding: '4px 8px' }}>
                                <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600, fontSize: '20px' }}>
                                  {formatCurrency(totalFunding)}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#94a3b8' }}>Total Funding</Typography>
                              </Box>
                            </foreignObject>
                          </svg>
                        </Box>
                      );
                    })()}
                  </Box>
                  
                  {/* Amount Details */}
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#10b981' }} />
                        <Typography variant="body2" sx={{ color: '#94a3b8' }}>Amount Paid</Typography>
                      </Box>
                      <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                        {formatCurrency(outlayedAmount)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#4773aa' }} />
                        <Typography variant="body2" sx={{ color: '#94a3b8' }}>Obligated Amount</Typography>
                      </Box>
                      <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                        {formatCurrency(obligatedAmount)}
                      </Typography>
                    </Box>
                    {nonFederalFunding > 0 && (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: 'rgba(71, 115, 170, 0.3)' }} />
                            <Typography variant="body2" sx={{ color: '#94a3b8' }}>Non-Federal Funding</Typography>
                          </Box>
                          <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                            {formatCurrency(nonFederalFunding)}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#64748b' }} />
                            <Typography variant="body2" sx={{ color: '#94a3b8' }}>Total Funding</Typography>
                          </Box>
                          <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                            {formatCurrency(totalFunding)}
                          </Typography>
                        </Box>
                      </>
                    )}
                  </Box>
                </Box>
              );
            }
            return null;
          })()}

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
                    {data.awarding_sub_agency_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Sub-Agency: {data.awarding_sub_agency_name}
                        {data.awarding_sub_agency_code && ` (${data.awarding_sub_agency_code})`}
                      </Typography>
                    )}
                    {data.awarding_office_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Office: {data.awarding_office_name}
                        {data.awarding_office_code && ` (${data.awarding_office_code})`}
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
                    {data.funding_sub_agency_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Sub-Agency: {data.funding_sub_agency_name}
                        {data.funding_sub_agency_code && ` (${data.funding_sub_agency_code})`}
                      </Typography>
                    )}
                    {data.funding_office_name && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        Office: {data.funding_office_name}
                        {data.funding_office_code && ` (${data.funding_office_code})`}
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
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Recipient Name
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {data.recipient_name || (data.recipient_name_normalized ? data.recipient_name_normalized.toUpperCase() : 'N/A')}
                  </Typography>
                </Box>
                {(data.recipient_id || data.recipient_uei) && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      {data.recipient_uei ? 'UEI' : 'Recipient ID'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {data.recipient_uei || data.recipient_id || 'N/A'}
                    </Typography>
                  </Box>
                )}
                {data.recipient_location_state && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      State
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.recipient_location_state}
                      {data.recipient_state_name && ` (${data.recipient_state_name})`}
                    </Typography>
                  </Box>
                )}
                {data.recipient_location_country && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Country
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.recipient_location_country}
                      {data.recipient_country_name && ` (${data.recipient_country_name})`}
                    </Typography>
                  </Box>
                )}
                {data.recipient_city_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      City
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.recipient_city_name}
                      {data.recipient_county_name && `, ${data.recipient_county_name}`}
                    </Typography>
                  </Box>
                )}
                {data.recipient_address_line_1 && (
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Address
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.recipient_address_line_1}
                      {data.recipient_address_line_2 && `, ${data.recipient_address_line_2}`}
                      {data.recipient_zip_code && `, ${data.recipient_zip_code}`}
                    </Typography>
                  </Box>
                )}
                {data.recipient_parent_name && (
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Parent Organization
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.recipient_parent_name}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Classification Codes */}
          {(data.naics_code || data.psc_code || data.cfda_number) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Classification Codes
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {data.naics_code && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      NAICS Code
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {data.naics_code}
                    </Typography>
                    {data.naics_description && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        {data.naics_description}
                      </Typography>
                    )}
                  </Box>
                )}
                {data.psc_code && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      PSC Code
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {data.psc_code}
                    </Typography>
                    {data.psc_description && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        {data.psc_description}
                      </Typography>
                    )}
                  </Box>
                )}
                {data.cfda_number && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      CFDA Number
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {data.cfda_number}
                    </Typography>
                    {data.cfda_title && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                        {data.cfda_title}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Funding Information */}
          {(data.federal_accounts_funding_this_award ||
            data.treasury_accounts_funding_this_award ||
            data.program_activities_funding_this_award ||
            data.object_classes_funding_this_award ||
            data.disaster_emergency_fund_codes_for_overall_award) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Funding Information
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
                {data.federal_accounts_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Federal Account
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {data.federal_accounts_funding_this_award}
                    </Typography>
                  </Box>
                )}
                {data.treasury_accounts_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Treasury Account
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {data.treasury_accounts_funding_this_award}
                    </Typography>
                  </Box>
                )}
                {data.disaster_emergency_fund_codes_for_overall_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Disaster/Emergency Fund Code (DEFC)
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.disaster_emergency_fund_codes_for_overall_award}
                    </Typography>
                  </Box>
                )}
                {data.program_activities_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Program Activity
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.program_activities_funding_this_award}
                    </Typography>
                  </Box>
                )}
                {data.object_classes_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Object Class
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.object_classes_funding_this_award}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Transactions */}
          {data.transactions && Array.isArray(data.transactions) && data.transactions.length > 0 && (
            <Box sx={{ mb: 3, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Transactions ({data.transactions.length})
                </Typography>
                <Tooltip
                  title={
                    <Box>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        The data available here may not represent the full transaction history.
                      </Typography>
                      {data.usaspending_permalink ? (
                        <Typography variant="body2">
                          For complete transaction history, please visit{' '}
                          <Box
                            component="a"
                            href={data.usaspending_permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: '#60a5fa',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: '#93c5fd',
                              },
                            }}
                          >
                            USAspending.gov
                          </Box>
                          .
                        </Typography>
                      ) : (
                        <Typography variant="body2">
                          For complete transaction history, please visit the official USAspending.gov website.
                        </Typography>
                      )}
                    </Box>
                  }
                  arrow
                  placement="left"
                >
                  <WarningIcon 
                    sx={{ 
                      color: '#fbbf24', 
                      fontSize: '20px',
                      cursor: 'help',
                      '&:hover': {
                        color: '#f59e0b',
                      },
                    }} 
                  />
                </Tooltip>
              </Box>
              <Box sx={{ 
                maxHeight: '300px', 
                overflowY: 'auto',
                ...scrollbarStyles,
              }}>
                {data.transactions.map((transaction: any, idx: number) => (
                  <Box
                    key={transaction.transaction_id || idx}
                    sx={{
                      p: 2,
                      mb: 1,
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #374151',
                    }}
                  >
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      <strong>ID:</strong> {transaction.transaction_id || 'N/A'}
                    </Typography>
                    {transaction.action_date && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Date:</strong> {formatDate(transaction.action_date)}
                      </Typography>
                    )}
                    {transaction.federal_action_obligation && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Amount:</strong> {formatCurrency(parseFloat(transaction.federal_action_obligation))}
                      </Typography>
                    )}
                    {transaction.transaction_description && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Description:</strong> {transaction.transaction_description}
                      </Typography>
                    )}
                    {transaction.action_type && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Type:</strong> {transaction.action_type}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Subawards */}
          {data.subawards && Array.isArray(data.subawards) && data.subawards.length > 0 && (
            <Box sx={{ mb: 3, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Subawards ({data.subawards.length})
                </Typography>
                <Tooltip
                  title={
                    <Box>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        The data available here may not represent the full subaward history.
                      </Typography>
                      {data.usaspending_permalink ? (
                        <Typography variant="body2">
                          For complete subaward history, please visit{' '}
                          <Box
                            component="a"
                            href={data.usaspending_permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: '#60a5fa',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: '#93c5fd',
                              },
                            }}
                          >
                            USAspending.gov
                          </Box>
                          .
                        </Typography>
                      ) : (
                        <Typography variant="body2">
                          For complete subaward history, please visit the official USAspending.gov website.
                        </Typography>
                      )}
                    </Box>
                  }
                  arrow
                  placement="left"
                >
                  <WarningIcon 
                    sx={{ 
                      color: '#fbbf24', 
                      fontSize: '20px',
                      cursor: 'help',
                      '&:hover': {
                        color: '#f59e0b',
                      },
                    }} 
                  />
                </Tooltip>
              </Box>
              <Box sx={{ 
                maxHeight: '300px', 
                overflowY: 'auto',
                ...scrollbarStyles,
              }}>
                {data.subawards.map((subaward: any, idx: number) => (
                  <Box
                    key={subaward.subaward_id || idx}
                    sx={{
                      p: 2,
                      mb: 1,
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #374151',
                    }}
                  >
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      <strong>ID:</strong> {subaward.subaward_id || 'N/A'}
                    </Typography>
                    {subaward.subawardee_name && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Recipient:</strong> {subaward.subawardee_name}
                      </Typography>
                    )}
                    {subaward.subaward_amount && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Amount:</strong> {formatCurrency(parseFloat(subaward.subaward_amount))}
                      </Typography>
                    )}
                    {subaward.subaward_date && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Date:</strong> {formatDate(subaward.subaward_date)}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Child Awards (for IDV parents) */}
          {data.is_idv_parent && data.child_awards_details && Array.isArray(data.child_awards_details) && data.child_awards_details.length > 0 && (
            <Box sx={{ mb: 3, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Child Awards ({data.child_awards_details.length})
                </Typography>
                <Tooltip
                  title={
                    <Box>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Child awards (delivery orders) issued under this IDV. Each child award is a separate contract with its own transactions and obligations.
                      </Typography>
                      {data.usaspending_permalink && (
                        <Typography variant="body2">
                          For complete child award details, please visit{' '}
                          <Box
                            component="a"
                            href={data.usaspending_permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: '#60a5fa',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: '#93c5fd',
                              },
                            }}
                          >
                            USAspending.gov
                          </Box>
                          .
                        </Typography>
                      )}
                    </Box>
                  }
                  arrow
                  placement="left"
                >
                  <InfoIcon 
                    sx={{ 
                      color: '#3b82f6', 
                      fontSize: '20px',
                      cursor: 'help',
                      '&:hover': {
                        color: '#60a5fa',
                      },
                    }} 
                  />
                </Tooltip>
              </Box>
              <Box sx={{ 
                maxHeight: '400px', 
                overflowY: 'auto',
                ...scrollbarStyles,
              }}>
                {data.child_awards_details.map((childAward: any, idx: number) => (
                  <Box
                    key={childAward.award_id || idx}
                    sx={{
                      p: 2,
                      mb: 1,
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #374151',
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Box>
                        {childAward.award_id_piid && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5, fontFamily: 'monospace' }}>
                            <strong>PIID:</strong> {childAward.award_id_piid}
                          </Typography>
                        )}
                        {childAward.description && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                            <strong>Description:</strong> {childAward.description}
                          </Typography>
                        )}
                        {childAward.award_type_description && (
                          <Typography variant="body2" sx={{ color: '#94a3b8', mb: 0.5 }}>
                            {childAward.award_type_description}
                          </Typography>
                        )}
                      </Box>
                      {childAward.total_obligated_amount && (
                        <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 600 }}>
                          {formatCurrency(parseFloat(childAward.total_obligated_amount.toString()))}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                      {childAward.recipient_name && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Recipient:</strong> {childAward.recipient_name}
                        </Typography>
                      )}
                      {childAward.awarding_agency_name && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Agency:</strong> {childAward.awarding_agency_name}
                        </Typography>
                      )}
                      {childAward.period_of_performance_start_date && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Start:</strong> {formatDate(String(childAward.period_of_performance_start_date))}
                        </Typography>
                      )}
                      {childAward.period_of_performance_current_end_date && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>End:</strong> {formatDate(String(childAward.period_of_performance_current_end_date))}
                        </Typography>
                      )}
                      {childAward.transaction_count !== undefined && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Transactions:</strong> {childAward.transaction_count}
                        </Typography>
                      )}
                      {childAward.subaward_count !== undefined && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Subawards:</strong> {childAward.subaward_count}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Additional Financial Information */}
          {(data.current_total_value_of_award || 
            data.potential_total_value_of_award ||
            data.base_and_exercised_options_value ||
            data.base_and_all_options_value) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Additional Financial Information
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {data.current_total_value_of_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Current Total Value
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(data.current_total_value_of_award)))}
                    </Typography>
                  </Box>
                )}
                {data.potential_total_value_of_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Potential Total Value
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(data.potential_total_value_of_award)))}
                    </Typography>
                  </Box>
                )}
                {data.base_and_exercised_options_value && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Base and Exercised Options
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(data.base_and_exercised_options_value)))}
                    </Typography>
                  </Box>
                )}
                {data.base_and_all_options_value && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Base and All Options
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(data.base_and_all_options_value)))}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Place of Performance */}
          {(data.primary_place_of_performance_city_name ||
            data.primary_place_of_performance_state_name ||
            data.primary_place_of_performance_country_name) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Place of Performance
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {data.primary_place_of_performance_city_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      City
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.primary_place_of_performance_city_name}
                      {data.primary_place_of_performance_county_name && 
                        `, ${data.primary_place_of_performance_county_name}`}
                    </Typography>
                  </Box>
                )}
                {data.primary_place_of_performance_state_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      State
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.primary_place_of_performance_state_name}
                      {data.primary_place_of_performance_state_code && 
                        ` (${data.primary_place_of_performance_state_code})`}
                    </Typography>
                  </Box>
                )}
                {data.primary_place_of_performance_country_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Country
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {data.primary_place_of_performance_country_name}
                    </Typography>
                  </Box>
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
        // Use ItemDetailsDialog for context items
        const content = previewData.content;
        const metadata = previewData.metadata || {};
        
        // Handle case where content might be undefined (shouldn't happen with backend decryption, but be safe)
        if (!content) {
          return (
            <Alert severity="error" sx={{ m: 2 }}>
              No content available for preview
            </Alert>
          );
        }
        
        // Determine item type from content
        let itemType: ItemType = 'tile';
        let itemData = content;
        
        // Check if it's a tile
        const tile = contentToTile(content);
        if (tile) {
          return renderContextItem(previewData.content); // Use existing tile rendering for now
        }
        
        // Handle nested data structure
        if (content?.data && typeof content.data === 'object') {
          itemData = content.data;
        }
        
        // Determine item type from data
        if (itemData?.award_id || itemData?.recipient_name) {
          itemType = 'govt_contract';
        } else if (itemData?.form || itemData?.filingEntity || itemData?.accession) {
          itemType = 'sec_filing';
        } else if (itemData?.title || itemData?.source_name || itemData?.source_url) {
          itemType = 'news_article';
        } else if (itemData?.tradeId || itemData?.politicianName || itemData?.transactionType) {
          itemType = 'politician_trade';
        } else if (itemData?.bill_id || itemData?.bill_type || itemData?.bill_number) {
          itemType = 'congress_bill';
        } else if (itemData?.filing_uuid || itemData?.registrant_name || itemData?.client_name) {
          itemType = 'lda_disclosure';
        } else if (itemData?.symbol || itemData?.ticker) {
          itemType = 'stock_result';
        }
        
        // Use ItemDetailsDialog to render the content in contentOnly mode
        return (
          <ItemDetailsDialog
            open={true}
            onClose={() => {}}
            itemType={itemType}
            data={itemData}
            title={metadata?.title || content?.title || item.name}
            user_id={user_id}
            folder_path={folder_path}
            item_id={item.id}
            contentOnly={true}
            onEnrich={async (enrichedData) => {
              // Update preview data with enriched data
              setPreviewData({
                ...previewData,
                content: {
                  ...content,
                  data: enrichedData,
                },
              });
              
              // Also update the filesystem item to persist the refreshed data
              // This ensures the updated bill data is saved for next time
              if (item.id && user_id && folder_path !== undefined) {
                try {
                  console.log('💾 Updating filesystem item with refreshed bill data:', item.id);
                  await filesystemAPI.updateItem({
                    user_id: user_id,
                    folder_path: folder_path || '',
                    item_id: item.id,
                    content_data: {
                      ...content,
                      data: enrichedData,
                    },
                  });
                  console.log('✅ Filesystem item updated with refreshed bill data');
                } catch (error) {
                  console.error('❌ Error updating filesystem item:', error);
                  // Don't show error to user - preview is already updated
                }
              }
            }}
          />
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

  // Handle Escape key to close
  useEffect(() => {
    if (!open) return;
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  // Drag handlers - use preview outline approach
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isResizing) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    // Initialize preview position
    previewPositionRef.current = { ...position };
    // Show preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'block';
      previewRef.current.style.left = `${position.x}px`;
      previewRef.current.style.top = `${position.y}px`;
      previewRef.current.style.width = `${size.width}px`;
      previewRef.current.style.height = `${size.height}px`;
    }
  }, [position, size, isResizing]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Use requestAnimationFrame for smooth updates
    rafIdRef.current = requestAnimationFrame(() => {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      const maxX = window.innerWidth - size.width;
      const maxY = window.innerHeight - size.height;
      
      const clampedX = Math.max(0, Math.min(maxX, newX));
      const clampedY = Math.max(64, Math.min(maxY, newY));
      
      // Store in ref (no state update = no re-render)
      previewPositionRef.current = { x: clampedX, y: clampedY };
      
      // Update preview outline directly via DOM
      if (previewRef.current) {
        previewRef.current.style.left = `${clampedX}px`;
        previewRef.current.style.top = `${clampedY}px`;
      }
    });
  }, [isDragging, dragStart, size]);

  const handleDragEnd = useCallback(() => {
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Apply preview position to actual position when mouse is released
    setPosition(previewPositionRef.current);
    
    // Hide preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'none';
    }
    
    setIsDragging(false);
  }, []);

  // Resize handlers - use preview outline approach
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    });
    // Initialize preview size
    previewSizeRef.current = { ...size };
    // Show preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'block';
      previewRef.current.style.left = `${position.x}px`;
      previewRef.current.style.top = `${position.y}px`;
      previewRef.current.style.width = `${size.width}px`;
      previewRef.current.style.height = `${size.height}px`;
    }
  }, [isDragging, size, position]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Use requestAnimationFrame for smooth updates
    rafIdRef.current = requestAnimationFrame(() => {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      
      const newWidth = Math.max(400, Math.min(window.innerWidth - 100, resizeStart.width + deltaX));
      const newHeight = Math.max(300, Math.min(window.innerHeight - 100, resizeStart.height + deltaY));
      
      // Store in ref (no state update = no re-render)
      previewSizeRef.current = { width: newWidth, height: newHeight };
      
      // Update preview outline directly via DOM
      if (previewRef.current) {
        previewRef.current.style.width = `${newWidth}px`;
        previewRef.current.style.height = `${newHeight}px`;
      }
    });
  }, [isResizing, resizeStart]);

  const handleResizeEnd = useCallback(() => {
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Apply preview size to actual size when mouse is released
    const newSize = previewSizeRef.current;
    setSize(newSize);
    if (onSizeChange) {
      onSizeChange(newSize);
    }
    
    // Hide preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'none';
    }
    
    setIsResizing(false);
  }, [onSizeChange]);

  // Global mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  if (!open) return null;

  return (
    <Portal>
      {/* Preview outline - shown during drag/resize */}
      <Box
        ref={previewRef}
        sx={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
          border: '2px solid #3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          pointerEvents: 'none',
          zIndex: 1101,
          display: 'none', // Hidden by default, shown during drag/resize via direct DOM manipulation
          boxShadow: '0 0 8px rgba(59, 130, 246, 0.6)',
        }}
      />
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: zIndex,
          pointerEvents: 'none',
        }}
        onMouseDown={(e) => {
          // Bring dialog to front when clicking anywhere on the backdrop
          if (onBringToFront && e.target === e.currentTarget) {
            // Use requestAnimationFrame to avoid blocking
            requestAnimationFrame(() => {
              onBringToFront();
            });
          }
        }}
      >
        <Paper
          ref={paperRef}
          elevation={8}
          onMouseDown={(e) => {
            // Only bring to front when clicking on the title bar or empty space, not on buttons/interactive elements
            const target = e.target as HTMLElement;
            const isInteractiveElement = target.closest('button, a, input, select, textarea, [role="button"], [onClick]');
            const isTitleBar = target.closest('[data-title-bar]');
            
            // Only bring to front if clicking on title bar or non-interactive area
            if (onBringToFront && (isTitleBar || !isInteractiveElement)) {
              // Use requestAnimationFrame to avoid blocking
              requestAnimationFrame(() => {
                onBringToFront();
              });
            }
            // Don't prevent default - allow drag to work
          }}
          sx={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: `${size.width}px`,
            height: `${size.height}px`,
            backgroundColor: '#1f2937',
            border: '2px solid #374151',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            pointerEvents: 'auto',
            cursor: isDragging ? 'move' : 'default',
            zIndex: zIndex,
          }}
        >
          {/* Title bar - draggable */}
          <Box
            data-title-bar
            data-tutorial="file-preview-titlebar"
            onMouseDown={handleDragStart}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid #374151',
              pb: 2,
              pt: 2,
              px: 3,
              cursor: 'move',
              userSelect: 'none',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
              {previewData && getPreviewIcon()}
              <Typography variant="h6" sx={{ color: '#ffffff' }}>
                {item.name}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TutorialHelpIcon tutorialKey="file-preview" title="File Preview tutorial" />
              <Tooltip title="Add to Context">
                <IconButton 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddToContext();
                  }} 
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <DashboardIcon />
                </IconButton>
              </Tooltip>
              <IconButton 
                onClick={(e) => {
                  e.stopPropagation();
                  if (onMinimize) {
                    onMinimize();
                  } else if (dialogManager && !dialogId) {
                    // If not managed, add to manager and minimize
                    const id = dialogManager.openDialog({
                      type: 'file_preview',
                      title: item.name,
                      data: {
                        item,
                        user_id,
                        folder_path,
                      },
                      props: {},
                      position,
                      size,
                    });
                    dialogManager.minimizeDialog(id);
                    onClose(); // Close the unmanaged dialog
                  }
                }} 
                sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                title="Minimize"
              >
                <MinimizeIcon />
              </IconButton>
              <IconButton onClick={onClose} sx={{ color: '#9ca3af', '&:hover': { color: '#ef4444' } }}>
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>

          {/* Content */}
          <Box
            sx={{
              flex: 1,
              overflow: 'auto', // Changed from 'hidden' to 'auto' to enable scrolling
              p: 0,
              mt: 2,
              position: 'relative',
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
            }}
            data-tutorial="file-preview-content"
          >
            {renderPreview()}
          </Box>

          {/* Actions */}
          <Box
            sx={{ borderTop: '1px solid #374151', p: 2, display: 'flex', justifyContent: 'flex-end', gap: 2 }}
            data-tutorial="file-preview-actions"
          >
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
              disabled={downloadLoading}
              startIcon={downloadLoading ? <CircularProgress size={16} /> : <DownloadIcon />}
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
          </Box>

          {/* Resize handle - bottom right corner */}
          <Box
            onMouseDown={handleResizeStart}
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '20px',
              height: '20px',
              cursor: 'nwse-resize',
              background: 'linear-gradient(135deg, transparent 0%, transparent 40%, #3b82f6 40%, #3b82f6 50%, transparent 50%, transparent 100%)',
              '&:hover': {
                background: 'linear-gradient(135deg, transparent 0%, transparent 40%, #2563eb 40%, #2563eb 50%, transparent 50%, transparent 100%)',
              },
            }}
          />
        </Paper>
      </Box>
    </Portal>
  );
};

export default FilePreviewDialog;
