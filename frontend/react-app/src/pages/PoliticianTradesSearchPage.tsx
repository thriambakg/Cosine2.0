import React, { useState } from 'react';
import {
  TextField,
  Typography,
  Box,
  Card,
  CardContent,
  Container,
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Menu,
  Collapse,
} from '@mui/material';
import {
  Search as SearchIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Dashboard as AddToContextIcon,
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Download as DownloadIcon,
  OpenInNew as OpenInNewIcon,
  VerifiedUser as VerifiedUserIcon,
} from '@mui/icons-material';
import { politicianTradesSearchAPI, PoliticianTradesSearchParams, PoliticianTrade } from '../services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';

// Custom styled components
const GlassCard = ({ children, sx = {}, ...props }: any) => {
  const safeSx = sx && typeof sx === 'object' ? sx : {};
  
  return (
    <Card
      sx={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '0px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        ...safeSx
      }}
      {...props}
    >
      <CardContent sx={{ p: 0 }}>
        {children}
      </CardContent>
    </Card>
  );
};

// Transaction types
const TRANSACTION_TYPES = [
  'Purchase',
  'Sale',
  'Exchange',
  'Gift',
  'Other',
];

// Positions
const POSITIONS = [
  'Senate',
  'House',
];

// Parties
const PARTIES = [
  'Republican',
  'Democratic',
  'Independent',
];

const PoliticianTradesSearchPage: React.FC = () => {
  const { user } = useAuth();
  const { activeSessionId, setIsVisible: setSidebarVisible, setActiveSessionId } = useGlobalChat();
  
  // Search state
  const [searchParams, setSearchParams] = useState<PoliticianTradesSearchParams>({
    dateFrom: '2020-01-01',
    dateTo: new Date().toISOString().split('T')[0],
  });
  const [searchResults, setSearchResults] = useState<PoliticianTrade[]>([]);
  const [totalFound, setTotalFound] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(50);
  
  // Selection state
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set());
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  
  // Perform search
  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setCurrentPage(1);
    
    try {
      const response = await politicianTradesSearchAPI.search({
        ...searchParams,
        page: 1,
        pageSize,
      });
      
      if (response.success && response.results) {
        setSearchResults(response.results);
        setTotalFound(response.total_found || response.results.length);
      } else {
        setSearchError(response.error || 'Search failed');
        setSearchResults([]);
        setTotalFound(0);
      }
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchError(error.message || 'An error occurred during search');
      setSearchResults([]);
      setTotalFound(0);
    } finally {
      setIsSearching(false);
    }
  };
  
  // Handle page change
  const handlePageChange = async (newPage: number) => {
    setIsSearching(true);
    setSearchError(null);
    
    try {
      const response = await politicianTradesSearchAPI.search({
        ...searchParams,
        page: newPage,
        pageSize,
      });
      
      if (response.success && response.results) {
        setSearchResults(response.results);
        setTotalFound(response.total_found || response.results.length);
        setCurrentPage(newPage);
      } else {
        setSearchError(response.error || 'Search failed');
      }
    } catch (error: any) {
      console.error('Page change error:', error);
      setSearchError(error.message || 'An error occurred');
    } finally {
      setIsSearching(false);
    }
  };
  
  // Toggle trade selection
  const toggleTradeSelection = (tradeId: string) => {
    setSelectedTrades(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };
  
  // Select all trades on current page
  const selectAllTrades = () => {
    const allIds = new Set(searchResults.map(trade => trade.tradeId));
    setSelectedTrades(allIds);
  };
  
  // Deselect all trades
  const deselectAllTrades = () => {
    setSelectedTrades(new Set());
  };
  
  // Handle add to context
  const handleAddToContext = (target: 'current' | 'new') => {
    if (selectedTrades.size === 0) return;
    
    const selectedTradeData = searchResults.filter(trade => selectedTrades.has(trade.tradeId));
    
    if (target === 'new') {
      // Create new context session
      const contextItems = selectedTradeData.map(trade => ({
        id: `politician_trade_${trade.tradeId}_${Date.now()}`,
        type: 'politician_trade' as const,
        title: `${trade.politicianName || 'Unknown'} - ${trade.securitySymbol || 'N/A'}`,
        subtitle: `${trade.transactionType || 'N/A'} on ${trade.transactionDate ? new Date(trade.transactionDate * 1000).toLocaleDateString() : 'N/A'}`,
        timestamp: Date.now(),
        data: trade,
      }));
      
      // Dispatch event to create new context session
      const event = new CustomEvent('create-context-session', {
        detail: {
          contextItems,
          userMessage: `I want to analyze these ${contextItems.length} politician trade(s).`,
        }
      });
      window.dispatchEvent(event);
    } else {
      // Add to current session
      selectedTradeData.forEach(trade => {
        const contextItem = {
          id: `politician_trade_${trade.tradeId}_${Date.now()}`,
          type: 'politician_trade' as const,
          title: `${trade.politicianName || 'Unknown'} - ${trade.securitySymbol || 'N/A'}`,
          subtitle: `${trade.transactionType || 'N/A'} on ${formatTransactionDate(trade.transactionDate)}`,
          timestamp: Date.now(),
          data: trade,
        };
        
        if (activeSessionId) {
          const event = new CustomEvent('add-to-sidebar-context', { detail: contextItem });
          window.dispatchEvent(event);
        } else {
          // Open sidebar and add
          setSidebarVisible(true);
          setTimeout(() => {
            const event = new CustomEvent('add-to-sidebar-context', { detail: contextItem });
            window.dispatchEvent(event);
          }, 100);
        }
      });
    }
    
    setContextMenuAnchor(null);
    setSelectedTrades(new Set());
  };
  
  // Format amount range
  const formatAmountRange = (trade: PoliticianTrade): string => {
    const UNPARSED_AMOUNT_VALUE = 999999999999; // High value indicating unparsed/unreadable document
    
    // Check if this is an unparsed document (high amount values)
    const isUnparsed = 
      (trade.amountMin && trade.amountMin >= UNPARSED_AMOUNT_VALUE) ||
      (trade.amountMax && trade.amountMax >= UNPARSED_AMOUNT_VALUE) ||
      (Array.isArray(trade.amountRange) && trade.amountRange[0] >= UNPARSED_AMOUNT_VALUE);
    
    if (isUnparsed) {
      return 'See filing document';
    }
    
    // Handle amountRange array (from DynamoDB)
    if (trade.amountRange) {
      if (Array.isArray(trade.amountRange) && trade.amountRange.length >= 2) {
        const min = trade.amountRange[0];
        const max = trade.amountRange[1];
        return `$${formatNumber(min)} - $${formatNumber(max)}`;
      } else if (typeof trade.amountRange === 'string') {
        return trade.amountRange;
      }
    }
    // Handle amountMin/amountMax
    if (trade.amountMin !== undefined && trade.amountMax !== undefined) {
      return `$${formatNumber(trade.amountMin)} - $${formatNumber(trade.amountMax)}`;
    }
    if (trade.amountMin !== undefined) {
      return `$${formatNumber(trade.amountMin)}+`;
    }
    if (trade.amountMax !== undefined) {
      return `Up to $${formatNumber(trade.amountMax)}`;
    }
    return 'N/A';
  };
  
  // Format number with commas
  const formatNumber = (num: number | string): string => {
    const numValue = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(numValue)) return 'N/A';
    return numValue.toLocaleString('en-US');
  };
  
  // Format transaction date from YYYYMMDD integer
  const formatTransactionDate = (dateNum?: number): string => {
    if (!dateNum) return 'N/A';
    // transactionDate is stored as YYYYMMDD integer (e.g., 20251103)
    const dateStr = dateNum.toString();
    if (dateStr.length === 8) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
    return 'N/A';
  };
  
  // Format filing date (already a string in YYYY-MM-DD format)
  const formatFilingDate = (dateStr?: string): string => {
    if (!dateStr) return 'N/A';
    // filingDate is already in YYYY-MM-DD format
    return dateStr;
  };
  
  const totalPages = Math.ceil(totalFound / pageSize);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  
  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Left Sidebar - Verification Links */}
          <Box sx={{ width: '280px', flexShrink: 0 }}>
            <GlassCard sx={{ p: 2, position: 'sticky', top: 20 }}>
              <Typography
                variant="h6"
                sx={{
                  color: '#ffffff',
                  fontWeight: 600,
                  mb: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <VerifiedUserIcon sx={{ fontSize: '1.5rem', color: '#3b82f6' }} />
                Verify on Official Sources
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: '#9ca3af',
                  mb: 2,
                  fontSize: '0.875rem',
                }}
              >
                Cross-reference findings with official government disclosure databases:
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Button
                  component="a"
                  href="https://efdsearch.senate.gov/search/"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outlined"
                  startIcon={<OpenInNewIcon />}
                  sx={{
                    color: '#3b82f6',
                    borderColor: '#3b82f6',
                    '&:hover': {
                      borderColor: '#2563eb',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                    justifyContent: 'flex-start',
                    textTransform: 'none',
                    fontSize: '0.875rem',
                  }}
                >
                  Senate EFD Search
                </Button>
                <Button
                  component="a"
                  href="https://disclosures-clerk.house.gov/FinancialDisclosure"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outlined"
                  startIcon={<OpenInNewIcon />}
                  sx={{
                    color: '#3b82f6',
                    borderColor: '#3b82f6',
                    '&:hover': {
                      borderColor: '#2563eb',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                    justifyContent: 'flex-start',
                    textTransform: 'none',
                    fontSize: '0.875rem',
                  }}
                >
                  House Clerk Financial Disclosure
                </Button>
              </Box>
              <Typography
                variant="caption"
                sx={{
                  color: '#6b7280',
                  mt: 2,
                  display: 'block',
                  fontSize: '0.75rem',
                  lineHeight: 1.5,
                }}
              >
                Note: These links open the official government websites where you can verify the accuracy of trade data.
              </Typography>
            </GlassCard>
          </Box>

          {/* Main Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
              <Typography
                variant="h4"
                sx={{
                  color: '#ffffff',
                  fontWeight: 700,
                  mb: 1,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Politician Trades Search
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  color: '#9ca3af',
                  fontSize: '1rem',
                }}
              >
                Search politician trades with advanced filters
              </Typography>
            </Box>

        {/* Search Form */}
        <GlassCard sx={{ p: 4, mb: 4 }}>
          {/* Top Bar - Common Search Parameters */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mb: 3 }}>
            {/* Row 1: Politician Name, Position, Party */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
              {/* Politician Name */}
              <TextField
                label="Politician Name"
                value={searchParams.politicianName || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, politicianName: e.target.value || undefined }))}
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />

              {/* Position */}
              <FormControl variant="outlined">
                <InputLabel id="position-label" sx={{ color: '#9ca3af' }}>Position</InputLabel>
                <Select
                  labelId="position-label"
                  value={searchParams.position || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, position: e.target.value || undefined }))}
                  label="Position"
                  sx={{
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                    '& .MuiSelect-select': { color: '#ffffff' },
                  }}
                >
                  <MenuItem value="">All</MenuItem>
                  {POSITIONS.map(pos => (
                    <MenuItem key={pos} value={pos}>{pos}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Party */}
              <FormControl variant="outlined">
                <InputLabel id="party-label" sx={{ color: '#9ca3af' }}>Party</InputLabel>
                <Select
                  labelId="party-label"
                  value={searchParams.party || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, party: e.target.value || undefined }))}
                  label="Party"
                  sx={{
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                    '& .MuiSelect-select': { color: '#ffffff' },
                  }}
                >
                  <MenuItem value="">All</MenuItem>
                  {PARTIES.map(party => (
                    <MenuItem key={party} value={party}>{party}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Row 2: Security Symbol, Security Name, Transaction Type */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
              {/* Security Symbol */}
              <TextField
                label="Security Symbol"
                value={searchParams.securitySymbol || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, securitySymbol: e.target.value.toUpperCase() || undefined }))}
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />

              {/* Security Name */}
              <TextField
                label="Security Name"
                value={searchParams.securityName || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, securityName: e.target.value || undefined }))}
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />

              {/* Transaction Type */}
              <FormControl variant="outlined">
                <InputLabel id="transaction-type-label" sx={{ color: '#9ca3af' }}>Transaction Type</InputLabel>
                <Select
                  labelId="transaction-type-label"
                  value={searchParams.transactionType || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, transactionType: e.target.value || undefined }))}
                  label="Transaction Type"
                  sx={{
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                    '& .MuiSelect-select': { color: '#ffffff' },
                  }}
                >
                  <MenuItem value="">All</MenuItem>
                  {TRANSACTION_TYPES.map(type => (
                    <MenuItem key={type} value={type}>{type}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Row 3: Date Range */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Transaction Date From"
                type="date"
                value={searchParams.dateFrom || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
                inputProps={{
                  min: '2001-01-01',
                  max: new Date().toISOString().split('T')[0],
                }}
                variant="outlined"
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />
              <TextField
                label="Transaction Date To"
                type="date"
                value={searchParams.dateTo || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
                inputProps={{
                  min: '2001-01-01',
                  max: new Date().toISOString().split('T')[0],
                }}
                variant="outlined"
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />
            </Box>
          </Box>

          {/* Advanced Filters Toggle */}
          <Button
            onClick={() => setShowAdvanced(!showAdvanced)}
            startIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{
              color: '#9ca3af',
              textTransform: 'none',
              mb: showAdvanced ? 2 : 0,
              '&:hover': { 
                color: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
              },
            }}
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Filters
          </Button>

          {/* Advanced Filters */}
          <Collapse in={showAdvanced}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', border: '1px solid #374151', borderRadius: '4px', mt: 2 }}>
              <TextField
                label="State/District"
                value={searchParams.stateDistrict || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, stateDistrict: e.target.value || undefined }))}
                placeholder="e.g., CA, TX31, IL"
                variant="outlined"
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />
              <TextField
                label="Form Type"
                value={searchParams.formType || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, formType: e.target.value || undefined }))}
                placeholder="e.g., PTR"
                variant="outlined"
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiInputBase-input': { color: '#ffffff' },
                }}
              />
            </Box>
          </Collapse>

          {/* Search Button */}
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', gap: 2, alignItems: 'center' }}>
            <Button
              variant="outlined"
              onClick={() => {
                setSearchParams({
                  dateFrom: '2020-01-01',
                  dateTo: new Date().toISOString().split('T')[0],
                });
                setSearchResults([]);
                setTotalFound(0);
                setSelectedTrades(new Set());
              }}
              sx={{
                color: '#9ca3af',
                borderColor: '#374151',
                '&:hover': { borderColor: '#6b7280', backgroundColor: 'rgba(55, 65, 81, 0.3)' },
              }}
            >
              Clear
            </Button>
            <Button
              variant="contained"
              onClick={handleSearch}
              disabled={isSearching}
              startIcon={isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
              sx={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
                '&:disabled': { backgroundColor: '#374151', color: '#6b7280' },
              }}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </Button>
          </Box>
        </GlassCard>
      
        {/* Error Alert */}
        {searchError && (
          <Alert severity="error" sx={{ mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
            {searchError}
          </Alert>
        )}
        
        {/* Results */}
        {searchResults.length > 0 && (
          <GlassCard>
            <Box sx={{ p: 2, borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
                Results ({totalFound.toLocaleString()} found)
              </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {selectedTrades.size > 0 && (
                <>
                  <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                    {selectedTrades.size} selected
                  </Typography>
                  <Button
                    size="small"
                    onClick={deselectAllTrades}
                    sx={{ color: '#9ca3af', fontSize: '0.75rem' }}
                  >
                    Clear
                  </Button>
                  <IconButton
                    size="small"
                    onClick={(e) => setContextMenuAnchor(e.currentTarget)}
                    sx={{ color: '#3b82f6' }}
                  >
                    <AddToContextIcon fontSize="small" />
                  </IconButton>
                  <Menu
                    anchorEl={contextMenuAnchor}
                    open={Boolean(contextMenuAnchor)}
                    onClose={() => setContextMenuAnchor(null)}
                    PaperProps={{
                      sx: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        border: '1px solid #374151',
                      }
                    }}
                  >
                    <MenuItem
                      onClick={() => handleAddToContext('current')}
                      sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
                    >
                      <SidebarChatIcon sx={{ mr: 1, fontSize: '1rem' }} />
                      Add to Current Chat
                    </MenuItem>
                    <MenuItem
                      onClick={() => handleAddToContext('new')}
                      sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
                    >
                      <NewChatIcon sx={{ mr: 1, fontSize: '1rem' }} />
                      New Chat Session
                    </MenuItem>
                  </Menu>
                </>
              )}
            </Box>
          </Box>
          
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'rgba(31, 41, 55, 0.5)' }}>
                  <TableCell padding="checkbox" sx={{ py: 1 }}>
                    <Checkbox
                      checked={selectedTrades.size === searchResults.length && searchResults.length > 0}
                      indeterminate={selectedTrades.size > 0 && selectedTrades.size < searchResults.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          selectAllTrades();
                        } else {
                          deselectAllTrades();
                        }
                      }}
                      sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                      size="small"
                    />
                  </TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Politician</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Position</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Party</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Security</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Transaction</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Transaction Date</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Filing Date</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600, py: 1, fontSize: '0.875rem' }}>Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {searchResults.map((trade) => (
                  <TableRow
                    key={trade.tradeId}
                    sx={{
                      '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleTradeSelection(trade.tradeId)}
                  >
                    <TableCell padding="checkbox" sx={{ py: 1 }}>
                      <Checkbox
                        checked={selectedTrades.has(trade.tradeId)}
                        onChange={() => toggleTradeSelection(trade.tradeId)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      {trade.politicianName || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      {trade.position || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      {trade.party || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      <Box>
                        <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.875rem' }}>
                          {trade.securitySymbol || 'N/A'}
                        </Typography>
                        {trade.securityName && (
                          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                            {trade.securityName}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      {trade.transactionType || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      {formatTransactionDate(trade.transactionDate)}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      {formatFilingDate(trade.filingDate)}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff', py: 1, fontSize: '0.875rem' }}>
                      {formatAmountRange(trade)}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      {trade.formS3Key && (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(trade);
                          }}
                          sx={{
                            color: '#3b82f6',
                            '&:hover': {
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            },
                          }}
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #374151' }}>
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                Page {currentPage} of {totalPages}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <IconButton
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1 || isSearching}
                  sx={{ color: '#9ca3af', '&:disabled': { color: '#374151' } }}
                >
                  <ChevronLeftIcon />
                </IconButton>
                <IconButton
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || isSearching}
                  sx={{ color: '#9ca3af', '&:disabled': { color: '#374151' } }}
                >
                  <ChevronRightIcon />
                </IconButton>
              </Box>
            </Box>
          )}
        </GlassCard>
      )}
      
            {/* Empty State */}
            {!isSearching && searchResults.length === 0 && totalFound === 0 && !searchError && (
              <GlassCard>
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="h6" sx={{ color: '#9ca3af', mb: 1 }}>
                    No results yet
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#6b7280' }}>
                    Enter search criteria and click "Search" to find politician trades
                  </Typography>
                </Box>
              </GlassCard>
            )}
          </Box>
        </Box>
      </Container>
    </Box>
  );
};

export default PoliticianTradesSearchPage;

