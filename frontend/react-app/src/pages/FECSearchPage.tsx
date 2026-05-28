import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Chip,
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Dashboard as AddToContextIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import ApiErrorAlert from '../components/common/ApiErrorAlert';
import FileBrowserDialog from '../components/common/FileBrowserDialog';
import { useAuth } from '../contexts/AuthContext';
import { useDialogManagerHelpers } from '../hooks/useDialogManagerHelpers';
import { compressedSessionStorage } from '../utils/compressedStorage';
import { getSearchPageBatchSize } from './config/searchPageConfig';
import {
  fecSearchAPI,
  FECSearchHit,
  FECSearchFilters,
  filesystemAPI,
} from '../services/api';
import {
  addFECEntityToContext,
  addMultipleFECEntitiesToContext,
} from '../components/tiles/common/contextManager';
import {
  DEFAULT_FEC_CYCLE,
  fecHitKey,
  buildFECEntityTitle,
  buildFECEntityContextData,
  loadFECEntityDetails,
} from '../utils/fecEntityUtils';

const SESSION_STORAGE_KEY = 'fec-search-page-state';

const GlassCard = ({ children, sx = {}, ...props }: React.ComponentProps<typeof Card>) => {
  const safeSx = sx && typeof sx === 'object' ? sx : {};
  return (
    <Card
      sx={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '0px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        ...safeSx,
      }}
      {...props}
    >
      <CardContent sx={{ p: 0 }}>{children}</CardContent>
    </Card>
  );
};

function loadStateFromStorage() {
  try {
    return compressedSessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

const FECSearchPage: React.FC = () => {
  const { user } = useAuth();
  const { openItemDetails } = useDialogManagerHelpers();
  const savedState = loadStateFromStorage();

  const [query, setQuery] = useState(savedState?.query || '');
  const [cycle, setCycle] = useState<number>(savedState?.cycle || DEFAULT_FEC_CYCLE);
  const [results, setResults] = useState<FECSearchHit[]>(savedState?.results || []);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedHits, setSelectedHits] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

  useEffect(() => {
    try {
      compressedSessionStorage.setItem(SESSION_STORAGE_KEY, {
        query,
        cycle,
        results,
      });
    } catch (err) {
      console.warn('FEC search session save failed:', err);
    }
  }, [query, cycle, results]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setSelectedHits(new Set());
    try {
      const filters: FECSearchFilters = { q: query.trim(), cycle };
      const resp = await fecSearchAPI.search({
        filters,
        limit: getSearchPageBatchSize('fec_search'),
      });
      if (!resp.success) {
        setError(new Error(resp.error || 'Search failed'));
        setResults([]);
        return;
      }
      setResults(resp.results || []);
    } catch (e: unknown) {
      console.error('FEC search failed:', e);
      setError(e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, cycle]);

  const handleHitClick = (e: React.MouseEvent, key: string, index: number) => {
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;

    setSelectedHits((prev) => {
      const next = new Set(prev);
      if (isShiftClick && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        results.slice(start, end + 1).forEach((h) => next.add(fecHitKey(h)));
      } else if (isCtrlClick) {
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setLastSelectedIndex(index);
      } else {
        if (next.has(key) && next.size === 1) {
          next.clear();
        } else {
          next.clear();
          next.add(key);
        }
        setLastSelectedIndex(index);
      }
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, key: string) => {
    e.stopPropagation();
    const keysToDrag = selectedHits.has(key) ? selectedHits : new Set([key]);
    const entities = results
      .filter((h) => keysToDrag.has(fecHitKey(h)))
      .map((h) => buildFECEntityContextData(h, cycle));

    if (entities.length === 0) return;

    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(
      'text/plain',
      JSON.stringify({ type: 'fec_entities', entities })
    );

    const dragImage = document.createElement('div');
    dragImage.textContent = `${entities.length} FEC entit${entities.length > 1 ? 'ies' : 'y'}`;
    dragImage.style.cssText =
      'position:absolute;top:-1000px;padding:8px 12px;background:#3b82f6;color:#fff;border-radius:4px;font-size:14px';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  };

  const handleRowContextMenu = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedHits.has(key)) setSelectedHits(new Set([key]));
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleContextMenuClose = () => setContextMenuPosition(null);

  const selectedHitObjects = results.filter((h) => selectedHits.has(fecHitKey(h)));

  const handleAddToContext = async () => {
    if (selectedHitObjects.length === 0) return;
    const enriched = await Promise.all(
      selectedHitObjects.map((h) => loadFECEntityDetails(h, cycle))
    );
    if (enriched.length === 1) addFECEntityToContext(enriched[0]);
    else addMultipleFECEntitiesToContext(enriched);
    setSelectedHits(new Set());
    handleContextMenuClose();
  };

  const handleAddToFiles = () => {
    if (selectedHitObjects.length === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedHitObjects.length === 0) return;
    try {
      const enriched = await Promise.all(
        selectedHitObjects.map((h) => loadFECEntityDetails(h, cycle))
      );
      const response = await filesystemAPI.addBulkContextItems({
        user_id: user.id,
        folder_path: folderPath,
        items: enriched.map((entity) => ({
          context_data: entity,
          title: buildFECEntityTitle(
            {
              entity_type: entity.entity_type,
              entity_id: entity.entity_id,
              name: entity.name,
            },
            entity.cycle
          ),
          item_type: 'fec_entity' as const,
        })),
      });
      if (!response.success) throw new Error(response.error || 'Failed to save');
      setSelectedHits(new Set());
    } catch (err) {
      console.error('Error saving FEC entities to filesystem:', err);
    }
  };

  const handleOpenDetails = async (hit: FECSearchHit) => {
    if (!user?.id) return;
    const data = await loadFECEntityDetails(hit, cycle);
    openItemDetails('fec_entity', data, buildFECEntityTitle(hit, cycle), {
      user_id: user.id,
    });
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Typography variant="h4" sx={{ color: '#f8fafc', mb: 1, fontWeight: 600 }}>
        FEC Campaign Finance
      </Typography>
      <Typography variant="body2" sx={{ color: '#94a3b8', mb: 3 }}>
        Search candidates and committees via openFEC. Click to select, double-click for details,
        drag selected rows to the AI context sidebar.
      </Typography>

      <GlassCard sx={{ mb: 3 }}>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            label="Name or committee"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            sx={{ minWidth: 280, flex: 1 }}
            size="small"
          />
          <TextField
            label="FEC cycle"
            type="number"
            value={cycle}
            onChange={(e) => setCycle(parseInt(e.target.value, 10) || DEFAULT_FEC_CYCLE)}
            sx={{ width: 120 }}
            size="small"
          />
          <Button
            variant="contained"
            startIcon={isSearching ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
            onClick={runSearch}
            disabled={isSearching || !query.trim()}
            sx={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
            }}
          >
            {isSearching ? 'Searching…' : 'Search'}
          </Button>
        </Box>
      </GlassCard>

      {error != null && (
        <ApiErrorAlert
          title="FEC API error (session kept — details below)"
          error={error}
          onClose={() => setError(null)}
        />
      )}

      <GlassCard>
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
              {results.length > 0 ? `${results.length} results` : 'Results'}
            </Typography>
            {results.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip
                  title={
                    selectedHits.size > 0
                      ? `Add ${selectedHits.size} to context`
                      : 'Select rows first'
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      disabled={selectedHits.size === 0}
                      onClick={(e) => {
                        setContextMenuPosition({ x: e.clientX, y: e.clientY });
                      }}
                      sx={{
                        color: selectedHits.size > 0 ? '#10b981' : '#9ca3af',
                        '&:hover': { color: '#10b981' },
                      }}
                    >
                      <AddToContextIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            )}
          </Box>

          <TableContainer
            sx={{
              '& .MuiTableRow-root:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
              },
            }}
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" sx={{ width: 48 }} />
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>ID</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Party</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>State</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Office / Type</TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.map((hit, index) => {
                  const key = fecHitKey(hit);
                  const selected = selectedHits.has(key);
                  return (
                    <TableRow
                      key={key}
                      onClick={(e) => handleHitClick(e, key, index)}
                      onContextMenu={(e) => handleRowContextMenu(e, key)}
                      draggable={selected}
                      onDragStart={(e) => handleDragStart(e, key)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleOpenDetails(hit);
                      }}
                      sx={{
                        backgroundColor: selected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                        '&:hover': {
                          backgroundColor: selected
                            ? 'rgba(16, 185, 129, 0.12)'
                            : 'rgba(59, 130, 246, 0.05)',
                        },
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <TableCell padding="checkbox" sx={{ width: 48 }}>
                        <Checkbox
                          size="small"
                          checked={selected}
                          sx={{
                            color: '#64748b',
                            '&.Mui-checked': { color: '#10b981' },
                            pointerEvents: 'none',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={hit.entity_type}
                          color={hit.entity_type === 'candidate' ? 'primary' : 'secondary'}
                        />
                      </TableCell>
                      <TableCell sx={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {hit.entity_id}
                      </TableCell>
                      <TableCell sx={{ color: '#f8fafc' }}>{hit.name}</TableCell>
                      <TableCell sx={{ color: '#94a3b8' }}>{hit.party || '—'}</TableCell>
                      <TableCell sx={{ color: '#94a3b8' }}>{hit.state || '—'}</TableCell>
                      <TableCell sx={{ color: '#94a3b8' }}>
                        {hit.office || hit.committee_type || '—'}
                      </TableCell>
                      <TableCell sx={{ color: '#64748b', fontSize: '0.8rem' }}>
                        {hit.subtitle || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!isSearching && results.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ color: '#64748b', textAlign: 'center', py: 4 }}>
                      Search for a candidate or committee to begin
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </GlassCard>

      <Menu
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenuPosition ? { top: contextMenuPosition.y, left: contextMenuPosition.x } : undefined
        }
        open={Boolean(contextMenuPosition)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: { backgroundColor: '#1e293b', border: '1px solid #374151', minWidth: 200 },
        }}
      >
        <MenuItem onClick={handleAddToContext} disabled={selectedHits.size === 0}>
          <AddToContextIcon sx={{ mr: 1, fontSize: 18 }} />
          Add to Context
          {selectedHits.size > 0 ? ` (${selectedHits.size})` : ''}
        </MenuItem>
        <MenuItem onClick={handleAddToFiles} disabled={selectedHits.size === 0 || !user}>
          <FolderIcon sx={{ mr: 1, fontSize: 18 }} />
          Add to Files
          {selectedHits.size > 0 ? ` (${selectedHits.size})` : ''}
        </MenuItem>
      </Menu>

      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
        title="Save to Files"
      />
    </Container>
  );
};

export default FECSearchPage;
