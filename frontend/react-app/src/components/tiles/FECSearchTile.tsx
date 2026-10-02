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
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Dashboard as AddToContextIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import ApiErrorAlert from '../common/ApiErrorAlert';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';
import { fecSearchAPI, FECSearchHit, FECSearchFilters, filesystemAPI } from '../../services/api';
import {
  addFECEntityToContext,
  addMultipleFECEntitiesToContext,
} from './common/contextManager';
import {
  DEFAULT_FEC_CYCLE,
  fecHitKey,
  buildFECEntityTitle,
  buildFECEntityContextData,
  loadFECEntityDetails,
} from '../../utils/fecEntityUtils';

interface FECSearchTileProps {
  id: string;
  size?: { width: number; height: number };
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: unknown) => void;
  onSettingsChange: (id: string, settings: unknown) => void;
  searchParams?: FECSearchFilters;
  results?: unknown[];
  customTitle?: string;
  isPinned?: boolean;
}

function isFECSearchHit(value: unknown): value is FECSearchHit {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const entityType = v.entity_type;
  return (
    (entityType === 'candidate' || entityType === 'committee') &&
    typeof v.entity_id === 'string' &&
    typeof v.name === 'string'
  );
}

const FECSearchTile: React.FC<FECSearchTileProps> = ({
  id,
  onRemove,
  onUpdate,
  searchParams: initialParams,
  results: initialResults,
  customTitle,
}) => {
  const { user } = useAuth();
  const { openItemDetails } = useDialogManagerHelpers();
  const [query, setQuery] = useState(initialParams?.q || '');
  const [cycle, setCycle] = useState(initialParams?.cycle || DEFAULT_FEC_CYCLE);
  const [results, setResults] = useState<FECSearchHit[]>(
    (initialResults || []).filter(isFECSearchHit)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedHits, setSelectedHits] = useState<Set<string>>(new Set());
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSelectedHits(new Set());
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

  const handleHitClick = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    setSelectedHits((prev) => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        if (next.has(key)) next.delete(key);
        else next.add(key);
      } else {
        if (next.has(key) && next.size === 1) next.clear();
        else {
          next.clear();
          next.add(key);
        }
      }
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, key: string) => {
    e.stopPropagation();
    const keys = selectedHits.has(key) ? selectedHits : new Set([key]);
    const entities = results
      .filter((h) => keys.has(fecHitKey(h)))
      .map((h) => buildFECEntityContextData(h, cycle));
    if (!entities.length) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'fec_entities', entities }));
  };

  const selectedObjects = results.filter((h) => selectedHits.has(fecHitKey(h)));

  const handleAddToContext = async () => {
    const enriched = await Promise.all(selectedObjects.map((h) => loadFECEntityDetails(h, cycle)));
    if (enriched.length === 1) addFECEntityToContext(enriched[0]);
    else addMultipleFECEntitiesToContext(enriched);
    setSelectedHits(new Set());
    setContextMenuPosition(null);
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user) return;
    const enriched = await Promise.all(selectedObjects.map((h) => loadFECEntityDetails(h, cycle)));
    await filesystemAPI.addBulkContextItems({
      user_id: user.id,
      folder_path: folderPath,
      items: enriched.map((entity) => ({
        context_data: entity,
        title: buildFECEntityTitle(
          { entity_type: entity.entity_type, entity_id: entity.entity_id, name: entity.name },
          entity.cycle
        ),
        item_type: 'fec_entity' as const,
      })),
    });
    setSelectedHits(new Set());
  };

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
      onClick={(e) => e.stopPropagation()}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {results.length > 0 && (
            <Tooltip title="Add selected to context">
              <span>
                <IconButton
                  size="small"
                  disabled={selectedHits.size === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenuPosition({ x: e.clientX, y: e.clientY });
                  }}
                  sx={{ color: selectedHits.size > 0 ? '#10b981' : '#9ca3af' }}
                >
                  <AddToContextIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Button size="small" color="inherit" onClick={() => onRemove(id)} sx={{ minWidth: 32, p: 0.5 }}>
            <CloseIcon fontSize="small" />
          </Button>
        </Box>
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
          onChange={(e) => setCycle(parseInt(e.target.value, 10) || DEFAULT_FEC_CYCLE)}
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
              <TableCell sx={{ width: 32, py: 0.5 }} />
              <TableCell sx={{ color: '#64748b', py: 0.5 }}>Name</TableCell>
              <TableCell sx={{ color: '#64748b', py: 0.5 }}>ID</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {results.map((hit) => {
              const key = fecHitKey(hit);
              const selected = selectedHits.has(key);
              return (
                <TableRow
                  key={key}
                  onClick={(e) => handleHitClick(e, key)}
                  draggable={selected}
                  onDragStart={(e) => handleDragStart(e, key)}
                  onDoubleClick={async (e) => {
                    e.stopPropagation();
                    if (!user?.id) return;
                    const data = await loadFECEntityDetails(hit, cycle);
                    openItemDetails('fec_entity', data, buildFECEntityTitle(hit, cycle), {
                      user_id: user.id,
                    });
                  }}
                  sx={{
                    backgroundColor: selected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <TableCell sx={{ py: 0.5 }}>
                    <Checkbox size="small" checked={selected} sx={{ p: 0, pointerEvents: 'none' }} />
                  </TableCell>
                  <TableCell sx={{ color: '#e2e8f0', py: 0.5, fontSize: '0.75rem' }}>
                    <Chip label={hit.entity_type[0].toUpperCase()} size="small" sx={{ mr: 0.5, height: 18 }} />
                    {hit.name}
                  </TableCell>
                  <TableCell sx={{ color: '#94a3b8', py: 0.5, fontSize: '0.7rem', fontFamily: 'monospace' }}>
                    {hit.entity_id}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>

      <Menu
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenuPosition ? { top: contextMenuPosition.y, left: contextMenuPosition.x } : undefined
        }
        open={Boolean(contextMenuPosition)}
        onClose={() => setContextMenuPosition(null)}
        PaperProps={{ sx: { bgcolor: '#1e293b', border: '1px solid #374151' } }}
      >
        <MenuItem onClick={handleAddToContext} disabled={selectedHits.size === 0}>
          <AddToContextIcon sx={{ mr: 1, fontSize: 16 }} /> Add to Context
        </MenuItem>
        <MenuItem
          onClick={() => {
            setFileBrowserOpen(true);
            setContextMenuPosition(null);
          }}
          disabled={selectedHits.size === 0 || !user}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 16 }} /> Add to Files
        </MenuItem>
      </Menu>

      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
        title="Save to Files"
      />
    </Box>
  );
};

export default FECSearchTile;
