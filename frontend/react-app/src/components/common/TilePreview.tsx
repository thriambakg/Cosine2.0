import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import CryptoTile from '../tiles/CryptoTile';
import StockTile from '../tiles/StockTile';
import StockScreenerTile from '../tiles/StockScreenerTile';
import NewsTile from '../tiles/NewsTile';
import PortfolioTile from '../tiles/PortfolioTile';
import PoliticianTradesSearchTile from '../tiles/PoliticianTradesSearchTile';
import SECSearchTile from '../tiles/SECSearchTile';
import GovtContractsSearchTile from '../tiles/GovtContractsSearchTile';
import CongressBillsSearchTile from '../tiles/CongressBillsSearchTile';
import RollCallSearchTile from '../tiles/RollCallSearchTile';
import LDASearchTile from '../tiles/LDASearchTile';
import { UnifiedTile } from '../../types/dashboardTypes';
import { filesystemAPI } from '@/services/api';

interface TilePreviewProps {
  tile: UnifiedTile;
  user_id: string;
  folder_path: string;
  item_id: string;
  onUpdate: (updatedTile: UnifiedTile) => void;
  containerSize?: { width: number; height: number }; // Optional container size from dialog
}

const TilePreview: React.FC<TilePreviewProps> = ({
  tile,
  user_id,
  folder_path,
  item_id,
  onUpdate,
  containerSize,
}) => {
  const [currentTile, setCurrentTile] = useState<UnifiedTile>(tile);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Handle tile updates (from tile data changes like portfolio recalculations)
  const handleTileUpdate = useCallback((_id: string, data: any) => {
    setCurrentTile(prev => {
      const updated = { ...prev, ...data };
      
      // Save to filesystem when tile data changes (e.g., portfolio recalculations)
      const saveTile = async () => {
        try {
          // Remove gridSize and gridPosition before saving
          const { gridSize, gridPosition, ...tileToSave } = updated;
          await filesystemAPI.updateItem({
            user_id,
            folder_path,
            item_id,
            content_data: tileToSave,
          });
          onUpdate(updated);
        } catch (error) {
          console.error('Error saving tile update:', error);
        }
      };
      
      saveTile();
      
      return updated;
    });
  }, [user_id, folder_path, item_id, onUpdate]);

  // Handle tile settings changes
  const handleSettingsChange = useCallback(async (_id: string, settings: any) => {
    setCurrentTile(prev => {
      const updated = { ...prev, ...settings };
      
      // Save to filesystem
      const saveTile = async () => {
        try {
          // Remove gridSize and gridPosition before saving
          const { gridSize, gridPosition, ...tileToSave } = updated;
          await filesystemAPI.updateItem({
            user_id,
            folder_path,
            item_id,
            content_data: tileToSave,
          });
          onUpdate(updated);
        } catch (error) {
          console.error('Error saving tile:', error);
        }
      };
      
      saveTile();
      
      return updated;
    });
  }, [user_id, folder_path, item_id, onUpdate]);

  // Calculate tile size based on container or default
  const tileSize = useMemo(() => {
    if (containerSize) {
      // Use container size minus padding, with some margin
      const padding = 48; // 24px on each side
      const headerHeight = 80; // Approximate header height
      const actionsHeight = 80; // Approximate actions height
      const availableWidth = containerSize.width - padding;
      const availableHeight = containerSize.height - headerHeight - actionsHeight - padding;
      // Use the smaller dimension to maintain square-ish aspect, or use available space
      const size = Math.min(availableWidth, availableHeight, 1200); // Max 1200px
      return {
        width: Math.max(400, size), // Min 400px
        height: Math.max(400, size), // Min 400px
      };
    }
    return {
      width: 600, // Default size
      height: 600,
    };
  }, [containerSize]);

  // Handle wheel zoom - use native event listener to allow preventDefault
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.max(0.5, Math.min(3, prev + delta))); // Zoom between 0.5x and 3x
  }, []);

  // Handle pan start
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button
    setIsPanning(true);
    setPanStart({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    });
  }, [pan]);

  // Handle pan move
  const handlePanMove = useCallback((e: MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    });
  }, [isPanning, panStart]);

  // Handle pan end
  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Mouse event listeners for panning
  useEffect(() => {
    if (isPanning) {
      document.addEventListener('mousemove', handlePanMove);
      document.addEventListener('mouseup', handlePanEnd);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handlePanMove);
      document.removeEventListener('mouseup', handlePanEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      document.removeEventListener('mousemove', handlePanMove);
      document.removeEventListener('mouseup', handlePanEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isPanning, handlePanMove, handlePanEnd]);

  // Reset zoom and pan when tile changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [currentTile.id]);

  // Attach wheel event listener directly to container (non-passive)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Common props for all tiles (excluding grid-related props)
  const commonProps = useMemo(() => ({
    id: currentTile.id,
    size: tileSize,
    dashboardContext: 'filesystem_preview',
    onRemove: () => {}, // No-op in preview
    onUpdate: handleTileUpdate,
    onSettingsChange: handleSettingsChange,
    onResize: () => {}, // No-op in preview
    onDragStart: () => {}, // No-op in preview
    onResizeStart: () => {}, // No-op in preview
    isDragging: false,
    isResizing: false,
    isSelected: false,
    onSelectionChange: () => {}, // No-op in preview
  }), [currentTile.id, handleTileUpdate, handleSettingsChange]);

  // Type-specific props
  const cryptoProps = useMemo(() => ({
    ...commonProps,
    symbol: currentTile.symbol || 'BTC',
    timeframe: currentTile.timeframe || '1d',
    displayOptions: (currentTile.displayOptions as any) || {
      showPrice: true,
      showPriceMarker: false,
      show24hChange: true,
      showAnnualReturn: true,
      showVolatility: true,
      showChart: true,
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const stockProps = useMemo(() => ({
    ...commonProps,
    symbol: currentTile.symbol || 'AAPL',
    timeframe: currentTile.timeframe || '1d',
    displayOptions: (currentTile.displayOptions as any) || {
      showPrice: true,
      showPriceMarker: false,
      show24hChange: true,
      showAnnualReturn: true,
      showVolatility: true,
      showChart: true,
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const stockScreenerProps = useMemo(() => ({
    ...commonProps,
    criteria: currentTile.criteria,
    results: currentTile.results,
    paginationState: currentTile.paginationState,
    displayOptions: (currentTile.displayOptions as any) || {
      showIndustry: true,
      showMarketCap: true,
      showVolatility: true,
      showPriceChange: true,
      showPERatio: true,
      showDividendYield: true,
      showResultsTable: true,
      showCriteriaSummary: true,
      maxResults: 100000,
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const newsProps = useMemo(() => ({
    ...commonProps,
    searchParams: currentTile.searchParams,
    filterSettings: currentTile.filterSettings,
    articles: currentTile.articles,
    paginationState: currentTile.paginationState,
    displayOptions: (currentTile.displayOptions as any) || {
      showTitle: true,
      showSource: true,
      showDate: true,
      showCategory: true,
      showSentiment: true,
      showCreator: false,
      showCountry: false,
      showImage: true,
      showDescription: false,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const portfolioProps = useMemo(() => ({
    ...commonProps,
    displayOptions: (currentTile.displayOptions as any) || {
      showHoldings: true,
      showPerformance: true,
      showAllocation: false,
      showRiskMetrics: true,
      showStockDetails: true,
    },
    portfolioData: currentTile.portfolioData,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const politicianTradesProps = useMemo(() => ({
    ...commonProps,
    searchParams: currentTile.searchParams,
    results: currentTile.trades,
    paginationState: currentTile.paginationState,
    displayOptions: (currentTile.displayOptions as any) || {
      showPolitician: true,
      showParty: true,
      showPosition: true,
      showSecurity: true,
      showTransactionType: true,
      showAmount: true,
      showDate: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const secSearchProps = useMemo(() => ({
    ...commonProps,
    onSelectionChange: () => {},
    searchParams: currentTile.searchParams,
    displayOptions: {
      showEntity: true,
      showForm: true,
      showFilingDate: true,
      showLocation: true,
      showIncorporation: true,
      showCIK: true,
      showFile: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
      results: currentTile.results,
      ...((currentTile.displayOptions as any) || {}),
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const govtContractsProps = useMemo(() => ({
    ...commonProps,
    onSelectionChange: () => {},
    searchParams: currentTile.searchParams,
    results: currentTile.results as any,
    paginationState: currentTile.paginationState,
    displayOptions: {
      showRecipient: true,
      showAwardingAgency: true,
      showFundingAgency: true,
      showAmount: true,
      showPeriodStartDate: false,
      showPeriodEndDate: false,
      showNaicsCode: false,
      showPscCode: false,
      showLastUpdated: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
      ...((currentTile.displayOptions as any) || {}),
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const congressBillsProps = useMemo(() => ({
    ...commonProps,
    onSelectionChange: () => {},
    searchParams: currentTile.searchParams,
    results: currentTile.results as any,
    paginationState: currentTile.paginationState,
    displayOptions: {
      showBillTitle: true,
      showBillType: true,
      showBillNumber: false,
      showSponsorName: true,
      showSponsorParty: false,
      showSponsorState: false,
      showIntroducedDate: true,
      showLatestActionDate: false,
      showCongress: true,
      showBipartisan: false,
      showPolicyArea: false,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
      ...((currentTile.displayOptions as any) || {}),
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const rollCallProps = useMemo(() => ({
    ...commonProps,
    onSelectionChange: () => {},
    searchParams: currentTile.searchParams,
    results: currentTile.results as any,
    paginationState: currentTile.paginationState,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  const ldaSearchProps = useMemo(() => ({
    ...commonProps,
    onSelectionChange: () => {},
    searchParams: currentTile.searchParams,
    filterSettings: currentTile.filterSettings,
    results: currentTile.results as any,
    paginationState: currentTile.paginationState,
    displayOptions: {
      showFilingType: true,
      showFilingPeriod: true,
      showFilingYear: true,
      showRegistrant: true,
      showClient: true,
      showAmount: true,
      showDatePosted: true,
      showState: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
      ...((currentTile.displayOptions as any) || {}),
    },
    autoRefresh: currentTile.autoRefresh,
    isPinned: currentTile.isPinned,
    customTitle: currentTile.customTitle,
    customColor: currentTile.customColor,
    customIcon: currentTile.customIcon,
  }), [commonProps, currentTile]);

  return (
    <Box
      ref={containerRef}
      onMouseDown={handlePanStart}
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        cursor: isPanning ? 'grabbing' : zoom > 1 ? 'grab' : 'default',
      }}
    >
      <Box
        ref={contentRef}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          width: '100%',
          height: '100%',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          transition: isPanning ? 'none' : 'transform 0.1s ease-out',
          p: 3,
        }}
      >
        <Box 
          sx={{ 
            width: `${tileSize.width}px`,
            height: `${tileSize.height}px`,
            flexShrink: 0,
          }}
        >
          {currentTile.type === 'crypto' ? (
            <CryptoTile key={currentTile.id} {...cryptoProps} />
          ) : currentTile.type === 'stock' ? (
            <StockTile key={currentTile.id} {...stockProps} />
          ) : currentTile.type === 'stock_screener' ? (
            <StockScreenerTile key={currentTile.id} {...stockScreenerProps} />
          ) : currentTile.type === 'news' ? (
            <NewsTile key={currentTile.id} {...newsProps} />
          ) : currentTile.type === 'portfolio' ? (
            <PortfolioTile key={currentTile.id} {...portfolioProps} />
          ) : currentTile.type === 'politician_trades' ? (
            <PoliticianTradesSearchTile key={currentTile.id} {...politicianTradesProps} />
          ) : currentTile.type === 'sec_search' ? (
            <SECSearchTile key={currentTile.id} {...secSearchProps} />
          ) : currentTile.type === 'govt_contracts' ? (
            <GovtContractsSearchTile key={currentTile.id} {...govtContractsProps} />
          ) : currentTile.type === 'congress_bills' ? (
            <CongressBillsSearchTile key={currentTile.id} {...congressBillsProps} />
          ) : currentTile.type === 'congress_roll_calls' ? (
            <RollCallSearchTile key={currentTile.id} {...rollCallProps} />
          ) : currentTile.type === 'lda_disclosures' ? (
            <LDASearchTile key={currentTile.id} {...ldaSearchProps} />
          ) : null}
        </Box>
      </Box>
      {/* Zoom indicator */}
      {zoom !== 1 && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid #374151',
            borderRadius: '4px',
            px: 2,
            py: 1,
            zIndex: 10,
          }}
        >
          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
            {Math.round(zoom * 100)}% {isPanning && '(Panning)'}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default TilePreview;

