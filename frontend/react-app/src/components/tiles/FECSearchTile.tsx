import React, { useState, useCallback } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import { Close as CloseIcon, Search as SearchIcon } from '@mui/icons-material';
import ApiErrorAlert from '../common/ApiErrorAlert';
import { fecSearchAPI, FECSearchHit, FECSearchFilters } from '../../services/api';

const DEFAULT_CYCLE =
  new Date().getFullYear() % 2 === 0
    ? new Date().getFullYear()
    : new Date().getFullYear() + 1;

interface FECSearchTileProps {
  id: string;
  size?: { width: number; height: number };
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: unknown) => void;
  onSettingsChange: (id: string, settings: unknown) => void;
  searchParams?: FECSearchFilters;
  results?: FECSearchHit[];
  customTitle?: string;
  isPinned?: boolean;
}

const FECSearchTile: React.FC<FECSearchTileProps> = ({
  id,
  onRemove,
  onUpdate,
  searchParams: initialParams,
  results: initialResults,
  customTitle,
  isPinned,
}) => {
  const [query, setQuery] = useState(initialParams?.q || '');
  const [cycle, setCycle] = useState(initialParams?.cycle || DEFAULT_CYCLE);
  const [results, setResults] = useState<FECSearchHit[]>(initialResults || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const filters: FECSearchFilters = { q: query.trim(), cycle };
      const resp = await fecSearchAPI.search({ filters, limit: 15 });
      const hits = resp.results || [];
      setResults(hits);
      onUpdate(id, { searchParams: filters, results: hits });
    } catch (e: unknown) {
      console.error('FEC tile search failed:', e);
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [query, cycle, id, onUpdate]);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid #374151',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 1,
          borderBottom: '1px solid #374151',
        }}
      >
        <Typography variant="subtitle2" sx={{ color: '#f8fafc', fontWeight: 600 }}>
          {customTitle || 'Campaign Finance'}
        </Typography>
        <Button size="small" color="inherit" onClick={() => onRemove(id)} sx={{ minWidth: 32, p: 0.5 }}>
          <CloseIcon fontSize="small" />
        </Button>
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          sx={{ flex: 1, minWidth: 120 }}
        />
        <TextField
          size="small"
          type="number"
          label="Cycle"
          value={cycle}
          onChange={(e) => setCycle(parseInt(e.target.value, 10) || DEFAULT_CYCLE)}
          sx={{ width: 90 }}
        />
        <Button
          size="small"
          variant="contained"
          onClick={runSearch}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} /> : <SearchIcon />}
        >
          Go
        </Button>
      </Box>
      {error != null && (
        <Box sx={{ px: 1, pb: 1 }}>
          <ApiErrorAlert title="Search failed" error={error} onClose={() => setError(null)} />
        </Box>
      )}
      <Box sx={{ flex: 1, overflow: 'auto', px: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ color: '#64748b', py: 0.5 }}>Name</TableCell>
              <TableCell sx={{ color: '#64748b', py: 0.5 }}>ID</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {results.map((hit) => (
              <TableRow key={`${hit.entity_type}-${hit.entity_id}`}>
                <TableCell sx={{ color: '#e2e8f0', py: 0.5, fontSize: '0.75rem' }}>
                  <Chip label={hit.entity_type[0].toUpperCase()} size="small" sx={{ mr: 0.5, height: 18 }} />
                  {hit.name}
                </TableCell>
                <TableCell sx={{ color: '#94a3b8', py: 0.5, fontSize: '0.7rem', fontFamily: 'monospace' }}>
                  {hit.entity_id}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
};

export default FECSearchTile;
