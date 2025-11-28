import React, { useState, useEffect, useMemo } from 'react';
import {
  TextField,
  Autocomplete,
  Typography,
  Box,
  Card,
  CardContent,
  Container,
  Alert,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Grid,
  Menu,
} from '@mui/material';
import {
  Search as SearchIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Dashboard as AddToContextIcon,
  AddComment as NewChatIcon,
  Chat as SidebarChatIcon,
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
          subtitle: `${trade.transactionType || 'N/A'} on ${trade.transactionDate ? new Date(trade.transactionDate * 1000).toLocaleDateString() : 'N/A'}`,
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
    if (trade.amountRange) {
      return trade.amountRange;
    }
    if (trade.amountMin && trade.amountMax) {
      return `$${formatNumber(trade.amountMin)} - $${formatNumber(trade.amountMax)}`;
    }
    if (trade.amountMin) {
      return `$${formatNumber(trade.amountMin)}+`;
    }
    return 'N/A';
  };
  
  // Format number with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString('en-US');
  };
  
  // Format date from timestamp
  const formatDate = (timestamp?: number): string => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };
  
  const totalPages = Math.ceil(totalFound / pageSize);
  
  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Typography variant="h4" sx={{ color: '#ffffff', mb: 3, fontWeight: 600 }}>
        Politician Trades Search
      </Typography>
      
      {/* Search Form */}
      <GlassCard sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Politician Name"
                value={searchParams.politicianName || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, politicianName: e.target.value || undefined }))}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#6b7280' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                }}
              />
            </Grid>
            
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel sx={{ color: '#9ca3af' }}>Position</InputLabel>
                <Select
                  value={searchParams.position || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, position: e.target.value || undefined }))}
                  label="Position"
                  sx={{
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#6b7280' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                  }}
                >
                  <MenuItem value="">All</MenuItem>
                  {POSITIONS.map(pos => (
                    <MenuItem key={pos} value={pos}>{pos}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel sx={{ color: '#9ca3af' }}>Party</InputLabel>
                <Select
                  value={searchParams.party || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, party: e.target.value || undefined }))}
                  label="Party"
                  sx={{
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#6b7280' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                  }}
                >
                  <MenuItem value="">All</MenuItem>
                  {PARTIES.map(party => (
                    <MenuItem key={party} value={party}>{party}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Security Symbol"
                value={searchParams.securitySymbol || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, securitySymbol: e.target.value.toUpperCase() || undefined }))}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#6b7280' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                }}
              />
            </Grid>
            
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Security Name"
                value={searchParams.securityName || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, securityName: e.target.value || undefined }))}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#6b7280' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                }}
              />
            </Grid>
            
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel sx={{ color: '#9ca3af' }}>Transaction Type</InputLabel>
                <Select
                  value={searchParams.transactionType || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, transactionType: e.target.value || undefined }))}
                  label="Transaction Type"
                  sx={{
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#6b7280' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                  }}
                >
                  <MenuItem value="">All</MenuItem>
                  {TRANSACTION_TYPES.map(type => (
                    <MenuItem key={type} value={type}>{type}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                type="date"
                label="Date From"
                value={searchParams.dateFrom || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#6b7280' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                }}
              />
            </Grid>
            
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                type="date"
                label="Date To"
                value={searchParams.dateTo || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#6b7280' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                }}
              />
            </Grid>
            
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="State/District"
                value={searchParams.stateDistrict || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, stateDistrict: e.target.value || undefined }))}
                placeholder="e.g., CA, TX31, IL"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#6b7280' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                }}
              />
            </Grid>
            
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Form Type"
                value={searchParams.formType || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, formType: e.target.value || undefined }))}
                placeholder="e.g., PTR"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(31, 41, 55, 0.8)',
                    color: '#ffffff',
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#6b7280' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                }}
              />
            </Grid>
            
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
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
                    backgroundColor: '#3b82f6',
                    '&:hover': { backgroundColor: '#2563eb' },
                    '&:disabled': { backgroundColor: '#374151', color: '#6b7280' },
                  }}
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </Button>
              </Box>
            </Grid>
          </Grid>
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
            <Typography variant="h6" sx={{ color: '#ffffff' }}>
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
                  <TableCell padding="checkbox">
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
                    />
                  </TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Politician</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Position</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Party</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Security</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Transaction</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Amount</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Confidence</TableCell>
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
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedTrades.has(trade.tradeId)}
                        onChange={() => toggleTradeSelection(trade.tradeId)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' } }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      {trade.politicianName || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      {trade.position || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      {trade.party || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      <Box>
                        <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                          {trade.securitySymbol || 'N/A'}
                        </Typography>
                        {trade.securityName && (
                          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                            {trade.securityName}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      {trade.transactionType || 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      {formatDate(trade.transactionDate)}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      {formatAmountRange(trade)}
                    </TableCell>
                    <TableCell sx={{ color: '#ffffff' }}>
                      {trade.matchConfidence ? `${(trade.matchConfidence * 100).toFixed(0)}%` : 'N/A'}
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
    </Container>
  );
};

export default PoliticianTradesSearchPage;

