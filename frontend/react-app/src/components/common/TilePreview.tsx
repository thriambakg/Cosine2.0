import React, { useState, useCallback, useMemo } from 'react';
import { Box } from '@mui/material';
import CryptoTile from '../tiles/CryptoTile';
import StockTile from '../tiles/StockTile';
import StockScreenerTile from '../tiles/StockScreenerTile';
import NewsTile from '../tiles/NewsTile';
import PortfolioTile from '../tiles/PortfolioTile';
import PoliticianTradesSearchTile from '../tiles/PoliticianTradesSearchTile';
import SECSearchTile from '../tiles/SECSearchTile';
import GovtContractsSearchTile from '../tiles/GovtContractsSearchTile';
import CongressBillsSearchTile from '../tiles/CongressBillsSearchTile';
import LDASearchTile from '../tiles/LDASearchTile';
import { UnifiedTile } from '../../types/dashboardTypes';
import { filesystemAPI } from '@/services/api';

interface TilePreviewProps {
  tile: UnifiedTile;
  user_id: string;
  folder_path: string;
  item_id: string;
  onUpdate: (updatedTile: UnifiedTile) => void;
}

const TilePreview: React.FC<TilePreviewProps> = ({
  tile,
  user_id,
  folder_path,
  item_id,
  onUpdate,
}) => {
  const [currentTile, setCurrentTile] = useState<UnifiedTile>(tile);

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

  // Common props for all tiles (excluding grid-related props)
  const commonProps = useMemo(() => ({
    id: currentTile.id,
    size: {
      width: 600, // Fixed size for preview
      height: 600,
    },
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
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        p: 3,
        maxHeight: '80vh',
        overflow: 'auto',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
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
      <Box sx={{ width: '600px', maxWidth: '100%' }}>
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
        ) : currentTile.type === 'lda_disclosures' ? (
          <LDASearchTile key={currentTile.id} {...ldaSearchProps} />
        ) : null}
      </Box>
    </Box>
  );
};

export default TilePreview;

