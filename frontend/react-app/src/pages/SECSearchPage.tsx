import React, { useState, useEffect } from 'react';
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
  Link,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  FormGroup,
} from '@mui/material';
import {
  Search as SearchIcon,
  Description as DocumentIcon,
  OpenInNew as OpenInNewIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { useSECSearch, useSECAutocomplete } from '../hooks/useAPI';
import { SECSearchParams, SECSearchResult, SECAutocompleteSuggestion } from '../services/api';

// Custom styled components
const GlassCard = ({ children, sx = {}, ...props }: any) => (
  <Card
    sx={{
      background: 'rgba(15, 23, 42, 0.95)',
      border: '2px solid #374151',
      borderRadius: '0px',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      ...sx
    }}
    {...props}
  >
    <CardContent sx={{ p: 0 }}>
      {children}
    </CardContent>
  </Card>
);

const FORM_TYPES = ['3', '4', '5', '8-K', '10-K', '10-Q', '13F', '13D', '13G', 'SC 13D', 'SC 13G'];

const DEFAULT_COLUMNS = [
  'Form & File',
  'Filed',
  'Reporting for',
  'Filing entity/person',
  'CIK',
  'Located',
  'Incorporated',
  'File number',
  'Film number',
];

const SECSearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useState<SECSearchParams>({
    dateFrom: '2001-01-01',
    dateTo: new Date().toISOString().split('T')[0],
  });
  const [companyInput, setCompanyInput] = useState<string>('');
  const [companySuggestions, setCompanySuggestions] = useState<SECAutocompleteSuggestion[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<SECAutocompleteSuggestion | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const { execute: executeSearch, data: searchResults, loading: searchLoading, error: searchError } = useSECSearch();
  const { execute: executeAutocomplete, loading: autocompleteLoading } = useSECAutocomplete();

  // Debounced autocomplete
  useEffect(() => {
    if (!companyInput || companyInput.length < 2) {
      setCompanySuggestions([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const result = await executeAutocomplete(companyInput);
        if (result?.suggestions) {
          setCompanySuggestions(result.suggestions);
        }
      } catch (error) {
        console.error('Autocomplete error:', error);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [companyInput, executeAutocomplete]);

  // Update search params when company is selected
  useEffect(() => {
    if (selectedCompany) {
      setSearchParams(prev => ({
        ...prev,
        cik: selectedCompany.cik,
        entityName: selectedCompany.name,
      }));
      // Reset to page 1 when search params change
      setCurrentPage(1);
    }
  }, [selectedCompany]);

  // Reset page when search params change (except page itself)
  useEffect(() => {
    setCurrentPage(1);
  }, [searchParams.keywords, searchParams.formTypes, searchParams.dateFrom, searchParams.dateTo, 
      searchParams.reportingFor, searchParams.located, searchParams.incorporated, 
      searchParams.fileNumber, searchParams.filmNumber, searchParams.cik, searchParams.entityName]);

  const handleSearch = async (page: number = 1) => {
    const params: SECSearchParams = {
      ...searchParams,
      page,
      columns: selectedColumns.length === DEFAULT_COLUMNS.length ? [] : selectedColumns,
    };

    // Remove empty strings
    Object.keys(params).forEach(key => {
      const value = params[key as keyof SECSearchParams];
      if (value === '' || (Array.isArray(value) && value.length === 0)) {
        delete params[key as keyof SECSearchParams];
      }
    });

    await executeSearch(params);
  };

  const handlePageChange = async (newPage: number) => {
    if (newPage < 1) return;
    setCurrentPage(newPage);
    await handleSearch(newPage);
  };

  const handleColumnToggle = (column: string) => {
    setSelectedColumns(prev => {
      if (prev.includes(column)) {
        const newCols = prev.filter(c => c !== column);
        return newCols.length === 0 ? DEFAULT_COLUMNS : newCols;
      } else {
        return [...prev, column];
      }
    });
  };

  const getColumnValue = (result: SECSearchResult, column: string): string => {
    switch (column) {
      case 'Form & File':
        return result.form || 'N/A';
      case 'Filed':
        return result.filingDate || 'N/A';
      case 'Reporting for':
        return result.reportingFor || 'N/A';
      case 'Filing entity/person':
        return result.filingEntity || 'N/A';
      case 'CIK':
        return result.cik || 'N/A';
      case 'Located':
        return result.located || 'N/A';
      case 'Incorporated':
        return result.incorporated || 'N/A';
      case 'File number':
        return result.fileNumber || 'N/A';
      case 'Film number':
        return result.filmNumber || 'N/A';
      default:
        return 'N/A';
    }
  };

  const shouldShowColumn = (column: string): boolean => {
    return selectedColumns.length === 0 || selectedColumns.includes(column);
  };

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth="xl">
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
            SEC EDGAR Search
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Search SEC filings with advanced filters and access document links
          </Typography>
        </Box>

        {/* Search Form */}
        <GlassCard sx={{ p: 4, mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '0px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #1d4ed8',
              }}
            >
              <SearchIcon sx={{ color: 'white', fontSize: 24 }} />
            </Box>
            <Typography
              variant="h6"
              sx={{
                color: '#ffffff',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Search Parameters
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Company Name with Autocomplete */}
            <Autocomplete
              freeSolo
              options={companySuggestions}
              getOptionLabel={(option) => typeof option === 'string' ? option : `${option.name} (${option.ticker || 'N/A'}) - CIK: ${option.cik}`}
              filterOptions={(x) => x} // Disable filtering since API already filters
              loading={autocompleteLoading}
              value={selectedCompany}
              onChange={(_, newValue) => {
                if (typeof newValue === 'string') {
                  setCompanyInput(newValue);
                  setSelectedCompany(null);
                } else {
                  setSelectedCompany(newValue);
                  setCompanyInput(newValue?.name || '');
                }
              }}
              inputValue={companyInput}
              onInputChange={(_, newInputValue) => {
                setCompanyInput(newInputValue);
                if (!newInputValue) {
                  setSelectedCompany(null);
                  setSearchParams(prev => ({ ...prev, cik: undefined, entityName: undefined }));
                }
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Company name, ticker, CIK number or individual's name"
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
              )}
            />

            {/* Keywords */}
            <TextField
              label="Document word or phrase (Keywords)"
              value={searchParams.keywords || ''}
              onChange={(e) => setSearchParams(prev => ({ ...prev, keywords: e.target.value || undefined }))}
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

            {/* Form Types */}
            <Autocomplete
              multiple
              options={FORM_TYPES}
              value={searchParams.formTypes || []}
              onChange={(_, newValue) => setSearchParams(prev => ({ ...prev, formTypes: newValue.length > 0 ? newValue : undefined }))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Filing category"
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
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option}
                    label={option}
                    sx={{
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      color: '#93c5fd',
                      border: '1px solid #3b82f6',
                    }}
                  />
                ))
              }
            />

            {/* Date Range */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Filed from"
                type="date"
                value={searchParams.dateFrom || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
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
                label="Filed to"
                type="date"
                value={searchParams.dateTo || ''}
                onChange={(e) => setSearchParams(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
                InputLabelProps={{ shrink: true }}
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

            {/* Advanced Filters Toggle */}
            <Button
              onClick={() => setShowAdvanced(!showAdvanced)}
              sx={{
                color: '#9ca3af',
                textTransform: 'none',
                '&:hover': { color: '#3b82f6' },
              }}
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Filters
            </Button>

            {/* Advanced Filters */}
            {showAdvanced && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', border: '1px solid #374151' }}>
                <TextField
                  label="Reporting for"
                  value={searchParams.reportingFor || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, reportingFor: e.target.value || undefined }))}
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
                  label="Located"
                  value={searchParams.located || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, located: e.target.value || undefined }))}
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
                  label="Incorporated"
                  value={searchParams.incorporated || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, incorporated: e.target.value || undefined }))}
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
                  label="File number"
                  value={searchParams.fileNumber || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, fileNumber: e.target.value || undefined }))}
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
                  label="Film number"
                  value={searchParams.filmNumber || ''}
                  onChange={(e) => setSearchParams(prev => ({ ...prev, filmNumber: e.target.value || undefined }))}
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
            )}

            {/* Column Selection */}
            <Box sx={{ p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', border: '1px solid #374151' }}>
              <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                Select columns to display:
              </Typography>
              <FormGroup row>
                {DEFAULT_COLUMNS.map((col) => (
                  <FormControlLabel
                    key={col}
                    control={
                      <Checkbox
                        checked={selectedColumns.length === 0 || selectedColumns.includes(col)}
                        onChange={() => handleColumnToggle(col)}
                        sx={{
                          color: '#9ca3af',
                          '&.Mui-checked': { color: '#3b82f6' },
                        }}
                      />
                    }
                    label={col}
                    sx={{ color: '#9ca3af', '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }}
                  />
                ))}
              </FormGroup>
            </Box>

            {/* Search Button */}
            <Button
              variant="contained"
              onClick={() => handleSearch(1)}
              disabled={searchLoading}
              startIcon={searchLoading ? <CircularProgress size={20} /> : <SearchIcon />}
              sx={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                py: 1.5,
                '&:hover': {
                  background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                },
                '&:disabled': {
                  background: 'rgba(59, 130, 246, 0.3)',
                },
              }}
            >
              {searchLoading ? 'Searching...' : 'Search SEC Filings'}
            </Button>
          </Box>
        </GlassCard>

        {/* Error Display */}
        {searchError && (
          <GlassCard sx={{ p: 4, mb: 4 }}>
            <Alert severity="error" sx={{
              backgroundColor: 'rgba(220, 38, 38, 0.1)',
              border: '1px solid #dc2626',
              color: '#fca5a5',
              '& .MuiAlert-icon': { color: '#fca5a5' },
            }}>
              {searchError}
            </Alert>
          </GlassCard>
        )}

        {/* Results */}
        {searchResults && (
          <GlassCard sx={{ p: 4 }}>
            <Typography
              variant="h6"
              sx={{
                color: '#ffffff',
                fontWeight: 600,
                mb: 3,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Search Results
              {searchResults.total_found !== undefined && (
                <Chip
                  label={`Showing ${((currentPage - 1) * 10) + 1}-${Math.min(currentPage * 10, searchResults.total_found)} of ${searchResults.total_found} results`}
                  sx={{
                    ml: 2,
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    color: '#93c5fd',
                    border: '1px solid #3b82f6',
                  }}
                />
              )}
            </Typography>

            {searchResults.results && searchResults.results.length > 0 ? (
              <TableContainer 
                component={Paper} 
                sx={{ 
                  backgroundColor: 'rgba(15, 23, 42, 0.8)', 
                  border: '1px solid #374151',
                  '&::-webkit-scrollbar': {
                    width: '6px',
                  },
                  '&::-webkit-scrollbar-track': {
                    backgroundColor: 'rgba(55, 65, 81, 0.3)',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: 'rgba(59, 130, 246, 0.5)',
                    borderRadius: '3px',
                  },
                  '&::-webkit-scrollbar-thumb:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                  },
                }}
              >
                <Table>
                  <TableHead>
                    <TableRow>
                      {shouldShowColumn('Form & File') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Form & File</TableCell>
                      )}
                      {shouldShowColumn('Filed') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Filed</TableCell>
                      )}
                      {shouldShowColumn('Reporting for') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Reporting for</TableCell>
                      )}
                      {shouldShowColumn('Filing entity/person') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Filing entity/person</TableCell>
                      )}
                      {shouldShowColumn('CIK') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>CIK</TableCell>
                      )}
                      {shouldShowColumn('Located') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Located</TableCell>
                      )}
                      {shouldShowColumn('Incorporated') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Incorporated</TableCell>
                      )}
                      {shouldShowColumn('File number') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>File number</TableCell>
                      )}
                      {shouldShowColumn('Film number') && (
                        <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Film number</TableCell>
                      )}
                      <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Documents</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {searchResults.results.map((result, index) => (
                      <TableRow key={index} sx={{ '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' } }}>
                        {shouldShowColumn('Form & File') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'Form & File')}</TableCell>
                        )}
                        {shouldShowColumn('Filed') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'Filed')}</TableCell>
                        )}
                        {shouldShowColumn('Reporting for') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'Reporting for')}</TableCell>
                        )}
                        {shouldShowColumn('Filing entity/person') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'Filing entity/person')}</TableCell>
                        )}
                        {shouldShowColumn('CIK') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'CIK')}</TableCell>
                        )}
                        {shouldShowColumn('Located') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'Located')}</TableCell>
                        )}
                        {shouldShowColumn('Incorporated') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'Incorporated')}</TableCell>
                        )}
                        {shouldShowColumn('File number') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'File number')}</TableCell>
                        )}
                        {shouldShowColumn('Film number') && (
                          <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>{getColumnValue(result, 'Film number')}</TableCell>
                        )}
                        <TableCell sx={{ color: '#ffffff', borderColor: '#374151' }}>
                          {result.documentUrls && result.documentUrls.length > 0 ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              {result.documentUrls.slice(0, 3).map((url, urlIndex) => (
                                <Link
                                  key={urlIndex}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  sx={{
                                    color: '#3b82f6',
                                    textDecoration: 'none',
                                    fontSize: '0.875rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    '&:hover': { color: '#60a5fa' },
                                  }}
                                >
                                  <DocumentIcon sx={{ fontSize: 16 }} />
                                  {url.split('/').pop()?.substring(0, 30)}...
                                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                                </Link>
                              ))}
                              {result.documentUrls.length > 3 && (
                                <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                                  +{result.documentUrls.length - 3} more
                                </Typography>
                              )}
                            </Box>
                          ) : (
                            <Typography variant="body2" sx={{ color: '#9ca3af' }}>No documents</Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info" sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid #3b82f6',
                color: '#93c5fd',
                '& .MuiAlert-icon': { color: '#93c5fd' },
              }}>
                No results found. Try adjusting your search parameters.
              </Alert>
            )}

            {/* Pagination Controls */}
            {searchResults && searchResults.results && searchResults.results.length > 0 && searchResults.total_found !== undefined && searchResults.total_found > 10 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, pt: 3, borderTop: '1px solid #374151' }}>
                <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                  Page {currentPage} of {Math.ceil(searchResults.total_found / 10)}
                  {' '}(Showing {((currentPage - 1) * 10) + 1}-{Math.min(currentPage * 10, searchResults.total_found)} of {searchResults.total_found} results)
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="outlined"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || searchLoading}
                    startIcon={<ChevronLeftIcon />}
                    sx={{
                      color: '#9ca3af',
                      borderColor: '#374151',
                      '&:hover': {
                        borderColor: '#3b82f6',
                        color: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      },
                      '&:disabled': {
                        borderColor: '#374151',
                        color: '#6b7280',
                      },
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= Math.ceil(searchResults.total_found / 10) || searchLoading}
                    endIcon={<ChevronRightIcon />}
                    sx={{
                      color: '#9ca3af',
                      borderColor: '#374151',
                      '&:hover': {
                        borderColor: '#3b82f6',
                        color: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      },
                      '&:disabled': {
                        borderColor: '#374151',
                        color: '#6b7280',
                      },
                    }}
                  >
                    Next
                  </Button>
                </Box>
              </Box>
            )}
          </GlassCard>
        )}
      </Container>
    </Box>
  );
};

export default SECSearchPage;

