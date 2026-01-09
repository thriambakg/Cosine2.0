import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Card,
  CardActionArea,
  Chip,
  Tooltip,
  Divider,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Info as InfoIcon,
  Close as CloseIcon,
  FileUpload as FileUploadIcon,
} from '@mui/icons-material';
import { TileCategory, TileTypeDefinition } from '../../types/dashboardTypes';
import TileImportDialog from './TileImportDialog';

interface AddTileMenuProps {
  open: boolean;
  onClose: () => void;
  onAddTile: (tileId: string) => void;
  onImportTile?: (tileData: any) => void;
  tileCategories: TileCategory[];
}

interface TileInfoDialogProps {
  open: boolean;
  onClose: () => void;
  tile: TileTypeDefinition | null;
}

const TileInfoDialog: React.FC<TileInfoDialogProps> = ({ open, onClose, tile }) => {
  if (!tile) return null;

  // Get tile-specific information and examples
  const getTileInfo = (tileId: string) => {
    const tileInfoMap: Record<string, {
      description: string;
      features: string[];
      searchParams?: { name: string; description: string; example: string }[];
      imageUrl?: string;
    }> = {
      'news': {
        description: 'Browse and filter financial news articles from multiple sources with advanced search capabilities.',
        features: [
          'Keyword search across article titles and content',
          'Filter by news sources (Reuters, BBC, CNN, etc.)',
          'Filter by categories (business, technology, etc.)',
          'Filter by countries',
          'Date range filtering (12h, 24h, 7d, 30d, all)',
          'Real-time article updates',
        ],
        searchParams: [
          { name: 'Keywords', description: 'Search for specific terms in article titles and content', example: 'Tesla, Apple, Market' },
          { name: 'Sources', description: 'Filter by specific news sources', example: 'Reuters, BBC, CNN' },
          { name: 'Categories', description: 'Filter by news categories', example: 'business, technology' },
          { name: 'Countries', description: 'Filter by country of origin', example: 'United States, United Kingdom' },
          { name: 'Date Range', description: 'Filter articles by publication date', example: 'Last 24 hours, Last 7 days' },
        ],
      },
      'politician_trades': {
        description: 'Search and analyze politician trading disclosures with comprehensive filtering options.',
        features: [
          'Search by politician name',
          'Filter by political party',
          'Filter by position/role',
          'Filter by security symbol or name',
          'Filter by transaction type',
          'Filter by transaction date range',
        ],
        searchParams: [
          { name: 'Politician', description: 'Search by politician name', example: 'Nancy Pelosi, Ted Cruz' },
          { name: 'Party', description: 'Filter by political party', example: 'Democratic, Republican' },
          { name: 'Position', description: 'Filter by politician position', example: 'Senator, Representative' },
          { name: 'Security', description: 'Filter by stock symbol or name', example: 'AAPL, Tesla' },
          { name: 'Transaction Type', description: 'Filter by type of transaction', example: 'Purchase, Sale' },
        ],
      },
      'sec_search': {
        description: 'Search and analyze SEC filing documents with entity and form type filtering.',
        features: [
          'Search by entity name or CIK',
          'Filter by form type (10-K, 10-Q, 8-K, etc.)',
          'Filter by filing date range',
          'Filter by location/state',
          'Filter by incorporation state',
        ],
        searchParams: [
          { name: 'Entity Name', description: 'Search by company or entity name', example: 'Apple Inc., Microsoft' },
          { name: 'CIK', description: 'Search by Central Index Key', example: '0000320193' },
          { name: 'Form Type', description: 'Filter by SEC form type', example: '10-K, 10-Q, 8-K' },
          { name: 'Filing Date', description: 'Filter by filing date range', example: 'Last quarter, Last year' },
        ],
      },
      'govt_contracts': {
        description: 'Search and analyze government contract awards with agency and recipient filtering.',
        features: [
          'Search by contract description or keywords',
          'Filter by awarding agency',
          'Filter by recipient/contractor',
          'Filter by contract value range',
          'Filter by award date range',
        ],
        searchParams: [
          { name: 'Keywords', description: 'Search contract descriptions', example: 'Software, Construction, Services' },
          { name: 'Agency', description: 'Filter by awarding agency', example: 'Department of Defense, NASA' },
          { name: 'Recipient', description: 'Filter by contractor/recipient', example: 'Lockheed Martin, Boeing' },
          { name: 'Value Range', description: 'Filter by contract value', example: '$1M - $10M' },
        ],
      },
      'congress_bills': {
        description: 'Search and analyze congressional bills with sponsor and policy area filtering.',
        features: [
          'Search by bill title or number',
          'Filter by sponsor name or party',
          'Filter by policy area',
          'Filter by bill type',
          'Filter by congress session',
        ],
        searchParams: [
          { name: 'Bill Title', description: 'Search by bill title or keywords', example: 'Infrastructure, Healthcare' },
          { name: 'Sponsor', description: 'Filter by bill sponsor', example: 'Senator Name, Representative Name' },
          { name: 'Policy Area', description: 'Filter by policy area', example: 'Healthcare, Defense, Education' },
          { name: 'Bill Type', description: 'Filter by bill type', example: 'House Bill, Senate Bill' },
        ],
      },
      'lda_disclosures': {
        description: 'Search and analyze Lobbying Disclosure Act filings with registrant, client, and lobbyist filtering.',
        features: [
          'Search by registrant name',
          'Filter by client name',
          'Filter by lobbyist name',
          'Filter by issue area',
          'Filter by filing period',
        ],
        searchParams: [
          { name: 'Registrant', description: 'Search by lobbying firm name', example: 'Firm Name' },
          { name: 'Client', description: 'Filter by client organization', example: 'Company Name, Association' },
          { name: 'Lobbyist', description: 'Filter by lobbyist name', example: 'Lobbyist Name' },
          { name: 'Issue Area', description: 'Filter by policy issue area', example: 'Healthcare, Tax, Defense' },
        ],
      },
      'stock_screener': {
        description: 'Screen stocks based on custom criteria including industry, volatility, price change, and market cap.',
        features: [
          'Filter by industry sector',
          'Filter by market cap range',
          'Filter by volatility range',
          'Filter by price change percentage',
          'Filter by price range',
        ],
        searchParams: [
          { name: 'Industry', description: 'Filter by industry sector', example: 'Technology, Healthcare, Finance' },
          { name: 'Market Cap', description: 'Filter by market capitalization', example: 'Large Cap, Mid Cap, Small Cap' },
          { name: 'Volatility', description: 'Filter by stock volatility', example: 'Low, Medium, High' },
          { name: 'Price Change', description: 'Filter by price change percentage', example: '+5%, -10%' },
        ],
      },
      'portfolio': {
        description: 'Analyze portfolio risk, performance, and allocation with customizable stock holdings.',
        features: [
          'Add multiple stocks with share quantities',
          'Calculate portfolio risk metrics',
          'View performance metrics',
          'Analyze allocation percentages',
          'Timeframe selection (1d to max)',
        ],
        searchParams: [
          { name: 'Stock Holdings', description: 'Add stocks and share quantities', example: 'AAPL: 10 shares, TSLA: 5 shares' },
          { name: 'Timeframe', description: 'Select analysis timeframe', example: '1 Day, 1 Month, 1 Year, Max' },
        ],
      },
      'crypto': {
        description: 'Track cryptocurrency prices, charts, and market data for selected cryptocurrencies.',
        features: [
          'Real-time price tracking',
          'Price charts and historical data',
          'Market cap information',
          'Volume and trading data',
        ],
        searchParams: [
          { name: 'Cryptocurrency', description: 'Select cryptocurrency to track', example: 'Bitcoin, Ethereum, Solana' },
        ],
      },
      'stock': {
        description: 'Monitor individual stock prices, analysis, and alerts for selected stocks.',
        features: [
          'Real-time price tracking',
          'Price charts and historical data',
          'Company information',
          'Financial metrics',
        ],
        searchParams: [
          { name: 'Stock Symbol', description: 'Select stock to track', example: 'AAPL, TSLA, MSFT' },
        ],
      },
      'folder': {
        description: 'Display and manage files in a folder with upload and organization capabilities.',
        features: [
          'View files in folder structure',
          'Upload new files',
          'Organize files',
          'File preview and management',
        ],
        searchParams: [],
      },
    };

    return tileInfoMap[tileId] || {
      description: tile.description || 'No description available.',
      features: [],
      searchParams: [],
    };
  };

  const tileInfo = getTileInfo(tile.id);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1f2937',
          border: '1px solid #374151',
        }
      }}
    >
      <DialogTitle 
        component="div" 
        sx={{ 
          color: '#ffffff', 
          borderBottom: '1px solid #374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ color: tile.color || '#3b82f6' }}>
            {tile.icon}
          </Box>
          <Typography variant="h6">{tile.name}</Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ color: '#9ca3af' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Typography variant="body1" sx={{ color: '#e5e7eb', mb: 3 }}>
          {tileInfo.description}
        </Typography>

        {tileInfo.features.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ color: '#ffffff', mb: 2 }}>
              Features
            </Typography>
            <Box component="ul" sx={{ pl: 2, m: 0 }}>
              {tileInfo.features.map((feature, index) => (
                <li key={index}>
                  <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                    {feature}
                  </Typography>
                </li>
              ))}
            </Box>
          </Box>
        )}

        {tileInfo.searchParams && tileInfo.searchParams.length > 0 && (
          <Box>
            <Typography variant="h6" sx={{ color: '#ffffff', mb: 2 }}>
              Search Parameters
            </Typography>
            {tileInfo.searchParams.map((param, index) => (
              <Box key={index} sx={{ mb: 2, p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: 1 }}>
                <Typography variant="subtitle2" sx={{ color: '#3b82f6', mb: 0.5 }}>
                  {param.name}
                </Typography>
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  {param.description}
                </Typography>
                <Chip 
                  label={`Example: ${param.example}`} 
                  size="small" 
                  sx={{ 
                    backgroundColor: '#374151', 
                    color: '#60a5fa',
                    fontSize: '0.75rem'
                  }} 
                />
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
        <Button onClick={onClose} sx={{ color: '#9ca3af' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const AddTileMenu: React.FC<AddTileMenuProps> = ({ open, onClose, onAddTile, onImportTile, tileCategories }) => {
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  const [infoTile, setInfoTile] = useState<TileTypeDefinition | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const handleTileClick = useCallback((tile: TileTypeDefinition) => {
    onAddTile(tile.id);
    onClose();
  }, [onAddTile, onClose]);

  const handleInfoClick = useCallback((tile: TileTypeDefinition, event: React.MouseEvent) => {
    event.stopPropagation();
    setInfoTile(tile);
    setInfoDialogOpen(true);
  }, []);

  const handleImportClick = useCallback(() => {
    setInfoDialogOpen(false);
    setImportDialogOpen(true);
  }, []);

  const handleImportSuccess = useCallback((tileData: any) => {
    if (onImportTile) {
      onImportTile(tileData);
    }
    onClose();
  }, [onImportTile, onClose]);


  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#0f172a',
            border: '1px solid #374151',
            maxHeight: '90vh',
          }
        }}
      >
        <DialogTitle component="div" sx={{ 
          color: '#ffffff', 
          borderBottom: '1px solid #374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2
        }}>
          <>
            <Typography variant="h6">Add New Tile</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                startIcon={<FileUploadIcon />}
                onClick={handleImportClick}
                variant="outlined"
                size="small"
                sx={{
                  color: '#3b82f6',
                  borderColor: '#3b82f6',
                  borderRadius: '0px',
                  textTransform: 'none',
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderColor: '#60a5fa',
                  },
                }}
              >
                Import
              </Button>
              <IconButton onClick={onClose} sx={{ color: '#9ca3af' }}>
                <CloseIcon />
              </IconButton>
            </Box>
          </>
        </DialogTitle>
        <DialogContent sx={{ p: 2, maxHeight: 'calc(90vh - 80px)', overflowY: 'auto' }}>
          {tileCategories.map((category) => (
            <Accordion
              key={category.id}
              defaultExpanded={false}
              sx={{
                backgroundColor: 'rgba(15, 23, 42, 0.5)',
                border: '1px solid #374151',
                mb: 1,
                '&:before': { display: 'none' },
                '&.Mui-expanded': {
                  margin: '0 0 8px 0',
                }
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon sx={{ color: '#9ca3af' }} />}
                sx={{
                  '& .MuiAccordionSummary-content': {
                    alignItems: 'center',
                  }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
                  <Box sx={{ color: category.color }}>
                    {category.icon}
                  </Box>
                  <Typography variant="h6" sx={{ color: '#ffffff' }}>
                    {category.name}
                  </Typography>
                  <Chip 
                    label={`${category.subcategories.reduce((sum: number, sub: any) => sum + sub.tiles.length, 0)} tiles`}
                    size="small"
                    sx={{ 
                      backgroundColor: '#374151', 
                      color: '#9ca3af',
                      ml: 'auto'
                    }} 
                  />
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 2 }}>
                  {category.description}
                </Typography>
                <Divider sx={{ mb: 2, borderColor: '#374151' }} />
                {category.subcategories.map((subcategory: any) => (
                  <Box key={subcategory.id} sx={{ mb: 2 }}>
                    <Typography variant="subtitle1" sx={{ color: '#ffffff', mb: 1 }}>
                      {subcategory.name}
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
                      {subcategory.tiles.map((tile: TileTypeDefinition) => (
                        <Card
                          key={tile.id}
                          sx={{
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            border: '1px solid #374151',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            position: 'relative',
                            '&:hover': {
                              borderColor: tile.color || '#3b82f6',
                              transform: 'translateY(-2px)',
                              boxShadow: `0 4px 12px ${tile.color || '#3b82f6'}30`,
                            }
                          }}
                          onClick={() => handleTileClick(tile)}
                        >
                          <Box sx={{ position: 'relative' }}>
                            <CardActionArea sx={{ p: 2, pr: 6 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Box sx={{ color: tile.color || '#3b82f6' }}>
                                  {tile.icon}
                                </Box>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                                  {tile.name}
                                </Typography>
                              </Box>
                              <Typography 
                                variant="caption" 
                                sx={{ 
                                  color: '#9ca3af', 
                                  display: 'block',
                                  fontSize: '0.75rem',
                                  lineHeight: 1.4
                                }}
                              >
                                {tile.description}
                              </Typography>
                              <Typography 
                                variant="caption" 
                                sx={{ 
                                  color: '#60a5fa', 
                                  display: 'block',
                                  mt: 1,
                                  fontSize: '0.7rem',
                                  fontStyle: 'italic'
                                }}
                              >
                                Click to add tile
                              </Typography>
                            </CardActionArea>
                            <Tooltip title="View tile information">
                              <IconButton
                                size="small"
                                onClick={(e) => handleInfoClick(tile, e)}
                                sx={{ 
                                  position: 'absolute',
                                  top: 8,
                                  right: 8,
                                  color: '#9ca3af',
                                  p: 0.5,
                                  '&:hover': { color: '#3b82f6' }
                                }}
                              >

      <TileImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImportSuccess={handleImportSuccess}
      />
                                <InfoIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Card>
                      ))}
                    </Box>
                  </Box>
                ))}
              </AccordionDetails>
            </Accordion>
          ))}
        </DialogContent>
      </Dialog>

      <TileInfoDialog
        open={infoDialogOpen}
        onClose={() => setInfoDialogOpen(false)}
        tile={infoTile}
      />

      <TileImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImportSuccess={handleImportSuccess}
      />
    </>
  );
};

export default AddTileMenu;
