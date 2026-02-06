import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Box, Typography, Button, Menu, MenuItem, IconButton, Chip, Tooltip } from '@mui/material';
import { Add as AddIcon, ZoomIn, ZoomOut, ZoomOutMap, PlayArrow as PlayIcon, Replay as ReplayIcon } from '@mui/icons-material';
import GridDashboard from '../dashboard/GridDashboard';
import DemoChatSidebar, { DEMO_CHAT_SIDEBAR_WIDTH } from '../layout/DemoChatSidebar';
import { DemoDashboardProvider } from '@/contexts/DemoDashboardContext';
import { getDefaultTileSize } from '../tiles/tileConfig';
import { UnifiedTile, GridPosition } from '@/types/dashboardTypes';
import type { SECSearchResult } from '@/services/api';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

const DEMO_DASHBOARD_ID = 'demo';
const SIM_SEC_TILE_ID = 'demo-sim-sec-tile';

/** Optional: set to e.g. '/sim-cursor.png' to use a custom cursor image from public/.
 *  Use a 32×32 PNG of the default Windows arrow. Set SIM_CURSOR_HOTSPOT to the pixel coords of the arrow tip in the image (e.g. { x: 0, y: 0 } if tip is top-left). */
const SIM_CURSOR_IMAGE = '/sim-cursor.png';
const SIM_CURSOR_HOTSPOT = { x: 0, y: 0 };

// Dummy data for demo tiles (no API calls)
const DUMMY_SEC_RESULTS: SECSearchResult[] = [
  {
    form: '10-K',
    filingDate: '2024-02-15',
    reportingFor: 'FY 2023',
    filingEntity: 'Acme Corp',
    cik: '0001234567',
    located: 'DE',
    incorporated: 'DE',
    fileNumber: '001-12345',
    filmNumber: '24123456',
    accession: '0001234567-24-000012',
    filingPageUrl: null,
    documentUrls: [],
    dataFileUrls: [],
    adsh: '0001234567-24-000012',
  },
  {
    form: '10-Q',
    filingDate: '2024-11-08',
    reportingFor: 'Q3 2024',
    filingEntity: 'Sample Inc',
    cik: '0009876543',
    located: 'CA',
    incorporated: 'DE',
    fileNumber: '001-98765',
    filmNumber: '24198765',
    accession: '0009876543-24-000098',
    filingPageUrl: null,
    documentUrls: [],
    dataFileUrls: [],
    adsh: '0009876543-24-000098',
  },
  {
    form: '8-K',
    filingDate: '2024-10-01',
    reportingFor: 'Current',
    filingEntity: 'Demo Holdings',
    cik: '0005555555',
    located: 'NY',
    incorporated: 'NY',
    fileNumber: '001-55555',
    filmNumber: '24555555',
    accession: '0005555555-24-000055',
    filingPageUrl: null,
    documentUrls: [],
    dataFileUrls: [],
    adsh: '0005555555-24-000055',
  },
];

const DUMMY_GOVT_CONTRACTS = [
  {
    award_id: 'demo-award-1',
    recipient_name: 'Demo Defense Co',
    awarding_agency_name: 'Department of Defense',
    total_obligated_amount: 2500000,
    action_date: '2024-09-15',
  },
  {
    award_id: 'demo-award-2',
    recipient_name: 'Sample Research Inc',
    awarding_agency_name: 'National Science Foundation',
    total_obligated_amount: 850000,
    action_date: '2024-08-20',
  },
];

const DUMMY_CONGRESS_BILLS = [
  {
    bill_id: 'hr-demo-1',
    bill_title: 'Demo Infrastructure Act of 2024',
    bill_type: 'hr',
    sponsor_full_name: 'Smith, Jane',
    introduced_date: '2024-01-10',
  },
  {
    bill_id: 's-demo-2',
    bill_title: 'Sample Energy Efficiency Bill',
    bill_type: 's',
    sponsor_full_name: 'Doe, John',
    introduced_date: '2024-02-05',
  },
];

const DUMMY_TRADES = [
  {
    politician_name: 'Sample Senator',
    party: 'D',
    position: 'Senator',
    asset_name: 'AAPL',
    transaction_type: 'Purchase',
    amount: '$15,001 - $50,000',
    transaction_date: '2024-09-01',
  },
  {
    politician_name: 'Demo Representative',
    party: 'R',
    position: 'Representative',
    asset_name: 'MSFT',
    transaction_type: 'Sale',
    amount: '$1,001 - $15,000',
    transaction_date: '2024-08-15',
  },
];

function createDemoTile(
  type: UnifiedTile['type'],
  overrides: Partial<UnifiedTile> & { gridPosition: GridPosition }
): UnifiedTile {
  const defaultSize = getDefaultTileSize(type);
  return {
    id: `demo-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    title: overrides.title ?? `Demo ${type.replace('_', ' ')}`,
    displayOptions: {},
    autoRefresh: false,
    isPinned: false,
    size: { width: defaultSize.width * 96, height: defaultSize.height * 80 },
    gridSize: { width: defaultSize.width, height: defaultSize.height },
    dashboard_id: DEMO_DASHBOARD_ID,
    ...overrides,
  };
}

/** Single SEC tile used when simulation starts; fixed id for DOM lookup */
function getSimulationStartTile(): UnifiedTile {
  return createDemoTile('sec_search', {
    id: SIM_SEC_TILE_ID,
    title: 'SEC Search (Demo)',
    gridPosition: { x: 0, y: 0 },
    results: DUMMY_SEC_RESULTS,
    searchParams: {},
    paginationState: {
      totalResultsLoaded: DUMMY_SEC_RESULTS.length,
      lastEvaluatedKeys: [],
      hasMore: false,
    },
  });
}

const DEMO_TILE_WIDTH = 6;
const DEMO_TILE_HEIGHT = 8; // default 6 + 2

function getInitialDemoTiles(): UnifiedTile[] {
  return [
    createDemoTile('sec_search', {
      title: 'SEC Search (Demo)',
      gridPosition: { x: 0, y: 0 },
      gridSize: { width: DEMO_TILE_WIDTH, height: DEMO_TILE_HEIGHT },
      size: { width: DEMO_TILE_WIDTH * 96, height: DEMO_TILE_HEIGHT * 80 },
      results: DUMMY_SEC_RESULTS,
      searchParams: {},
      paginationState: {
        totalResultsLoaded: DUMMY_SEC_RESULTS.length,
        lastEvaluatedKeys: [],
        hasMore: false,
      },
    }),
    createDemoTile('govt_contracts', {
      title: 'Government Contracts (Demo)',
      gridPosition: { x: 6, y: 0 },
      gridSize: { width: DEMO_TILE_WIDTH, height: DEMO_TILE_HEIGHT },
      size: { width: DEMO_TILE_WIDTH * 96, height: DEMO_TILE_HEIGHT * 80 },
      isPinned: true,
      results: DUMMY_GOVT_CONTRACTS as any,
      searchParams: {},
      paginationState: {
        totalResultsLoaded: DUMMY_GOVT_CONTRACTS.length,
        lastEvaluatedKeys: [],
        hasMore: false,
      },
    }),
    createDemoTile('politician_trades', {
      title: 'Politician Trades (Demo)',
      gridPosition: { x: 12, y: 0 },
      gridSize: { width: DEMO_TILE_WIDTH, height: DEMO_TILE_HEIGHT },
      size: { width: DEMO_TILE_WIDTH * 96, height: DEMO_TILE_HEIGHT * 80 },
      results: DUMMY_TRADES as any,
      searchParams: {},
      paginationState: {
        totalResultsLoaded: DUMMY_TRADES.length,
        lastEvaluatedKeys: [],
        hasMore: false,
      },
    }),
    createDemoTile('congress_bills', {
      title: 'Congress Bills (Demo)',
      gridPosition: { x: 18, y: 0 },
      gridSize: { width: DEMO_TILE_WIDTH, height: DEMO_TILE_HEIGHT },
      size: { width: DEMO_TILE_WIDTH * 96, height: DEMO_TILE_HEIGHT * 80 },
      results: DUMMY_CONGRESS_BILLS as any,
      searchParams: {},
      paginationState: {
        totalResultsLoaded: DUMMY_CONGRESS_BILLS.length,
        lastEvaluatedKeys: [],
        hasMore: false,
      },
    }),
  ];
}

const DEMO_TILE_TYPES: { type: UnifiedTile['type']; label: string }[] = [
  { type: 'sec_search', label: 'SEC Search' },
  { type: 'govt_contracts', label: 'Government Contracts' },
  { type: 'congress_bills', label: 'Congress Bills' },
  { type: 'politician_trades', label: 'Politician Trades' },
  { type: 'stock', label: 'Stock' },
  { type: 'crypto', label: 'Crypto' },
  { type: 'news', label: 'News' },
];

export default function LandingDemoDashboard() {
  const [tiles, setTiles] = useState<UnifiedTile[]>(getInitialDemoTiles);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isSimulationActive, setIsSimulationActive] = useState(false);
  const [simCursorPosition, setSimCursorPosition] = useState<{ x: number; y: number }>({ x: -100, y: -100 });
  const [showSimResetButton, setShowSimResetButton] = useState(false);
  const [simDragPreview, setSimDragPreview] = useState<{ title: string; subtitle?: string } | null>(null);
  const simTimeoutRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const simAnimationRef = useRef<number | null>(null);

  const findNextPosition = useCallback(() => {
    const occupied = new Set<string>();
    tiles.forEach((t) => {
      const pos = t.gridPosition ?? { x: 0, y: 0 };
      const size = t.gridSize ?? getDefaultTileSize(t.type);
      for (let dx = 0; dx < size.width; dx++) {
        for (let dy = 0; dy < size.height; dy++) {
          occupied.add(`${pos.x + dx},${pos.y + dy}`);
        }
      }
    });
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 12; x++) {
        const size = getDefaultTileSize('sec_search');
        let ok = true;
        for (let dx = 0; dx < size.width && ok; dx++) {
          for (let dy = 0; dy < size.height && dy >= 0; dy++) {
            if (occupied.has(`${x + dx},${y + dy}`)) {
              ok = false;
              break;
            }
          }
        }
        if (ok) return { x, y };
      }
    }
    return { x: 0, y: 20 };
  }, [tiles]);

  const handleRemoveTile = useCallback((id: string) => {
    setTiles((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleUpdateTile = useCallback((id: string, data: any) => {
    setTiles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...data } : t))
    );
  }, []);

  const handleSettingsChange = useCallback((id: string, settings: any) => {
    setTiles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...settings } : t))
    );
  }, []);

  const GRID_CELL_SIZE = 80;
  const GRID_GAP = 16;
  const handleResizeTile = useCallback((id: string, size: { width: number; height: number }) => {
    const gridSize = {
      width: Math.round((size.width + GRID_GAP) / (GRID_CELL_SIZE + GRID_GAP)),
      height: Math.round((size.height + GRID_GAP) / (GRID_CELL_SIZE + GRID_GAP)),
    };
    setTiles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, size, gridSize } : t))
    );
  }, []);

  const handleMoveTile = useCallback((id: string, position: GridPosition) => {
    setTiles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, gridPosition: position } : t))
    );
  }, []);

  const clearSimTimeouts = useCallback(() => {
    simTimeoutRef.current.forEach((t) => clearTimeout(t));
    simTimeoutRef.current = [];
  }, []);

  const startSimulation = useCallback(() => {
    setTiles([getSimulationStartTile()]);
    window.dispatchEvent(new CustomEvent('demo-reset-context'));
    setShowSimResetButton(false);
    setSimCursorPosition({ x: -100, y: -100 });
    setIsSimulationActive(true);
    // Bring demo front and center so the cursor is visible during the sim
    requestAnimationFrame(() => {
      document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    // Let DOM update with single tile, then run steps
    const t = setTimeout(() => runSimulationSteps(), 400);
    simTimeoutRef.current.push(t);
  }, []);

  const runSimulationSteps = useCallback(() => {
    const gridEl = gridContainerRef.current;
    const sidebarEl = sidebarRef.current?.querySelector<HTMLElement>('[data-demo-context-area]');
    const tileEl = gridEl?.querySelector<HTMLElement>(`[data-demo-tile-id="${SIM_SEC_TILE_ID}"]`);
    if (!tileEl || !sidebarEl) return;

    const push = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      simTimeoutRef.current.push(t);
    };

    const tileRect = tileEl.getBoundingClientRect();
    const sidebarRect = sidebarEl.getBoundingClientRect();
    const resizeHandleX = tileRect.right - 20;
    const resizeHandleY = tileRect.bottom - 20;
    const sidebarCenterX = sidebarRect.left + sidebarRect.width / 2;
    const sidebarCenterY = sidebarRect.top + sidebarRect.height / 2;

    const size6 = 6 * (GRID_CELL_SIZE + GRID_GAP) - GRID_GAP;
    const size7 = 7 * (GRID_CELL_SIZE + GRID_GAP) - GRID_GAP;

    setSimCursorPosition({ x: resizeHandleX, y: resizeHandleY });
    push(() => {
      const duration = 450;
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / duration);
        const ease = 1 - (1 - t) * (1 - t);
        const w = Math.round(size6 + (size7 - size6) * ease);
        const h = w;
        handleResizeTile(SIM_SEC_TILE_ID, { width: w, height: h });
        if (elapsed < duration) simAnimationRef.current = requestAnimationFrame(tick);
      };
      simAnimationRef.current = requestAnimationFrame(tick);
    }, 600);

    push(() => {
      const r = gridEl?.querySelector<HTMLElement>(`[data-demo-tile-id="${SIM_SEC_TILE_ID}"]`)?.getBoundingClientRect();
      if (r) setSimCursorPosition({ x: r.left + r.width / 2, y: r.top + 40 });
    }, 2000);
    push(() => handleMoveTile(SIM_SEC_TILE_ID, { x: 1, y: 0 }), 2400);
    push(() => handleMoveTile(SIM_SEC_TILE_ID, { x: 2, y: 0 }), 2600);
    push(() => handleMoveTile(SIM_SEC_TILE_ID, { x: 2, y: 1 }), 2800);
    push(() => handleMoveTile(SIM_SEC_TILE_ID, { x: 2, y: 2 }), 3000);

    push(() => {
      const r = gridEl?.querySelector<HTMLElement>(`[data-demo-tile-id="${SIM_SEC_TILE_ID}"]`)?.getBoundingClientRect();
      if (r) setSimCursorPosition({ x: r.left + r.width / 2, y: r.top + 120 });
    }, 3600);
    push(() => {
      setSimDragPreview({
        title: `${DUMMY_SEC_RESULTS[0].form || 'SEC Filing'} - ${DUMMY_SEC_RESULTS[0].filingEntity || 'Unknown'}`,
        subtitle: DUMMY_SEC_RESULTS[0].filingDate ? `Filed: ${DUMMY_SEC_RESULTS[0].filingDate}` : undefined,
      });
    }, 3800);
    push(() => setSimCursorPosition({ x: sidebarCenterX, y: sidebarCenterY }), 4200);
    push(() => {
      setSimDragPreview(null);
      const ts = Date.now();
      const item = {
        id: `ctx-sim-${ts}`,
        type: 'sec_filing' as const,
        title: `${DUMMY_SEC_RESULTS[0].form || 'SEC Filing'} - ${DUMMY_SEC_RESULTS[0].filingEntity || 'Unknown'}`,
        subtitle: DUMMY_SEC_RESULTS[0].filingDate ? `Filed: ${DUMMY_SEC_RESULTS[0].filingDate}` : undefined,
        data: DUMMY_SEC_RESULTS[0],
        timestamp: ts,
      };
      window.dispatchEvent(new CustomEvent('add-multiple-to-sidebar-context', { detail: [item] }));
    }, 5200);

    push(() => {
      const inputEl = sidebarRef.current?.querySelector<HTMLElement>('[data-demo-input]');
      const rect = inputEl?.getBoundingClientRect();
      if (rect) setSimCursorPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }, 5600);
    push(() => {
      window.dispatchEvent(
        new CustomEvent('demo-sim-send-message', {
          detail: {
            text: 'Summarize the key points from the Acme Corp 10-K.',
            response:
              "Based on the context you added, Acme Corp's 10-K for FY 2023 would be summarized here. In the full app, the AI uses your selected filings and data to answer. Sign up to try it with real data.",
          },
        })
      );
    }, 6400);
    push(() => setShowSimResetButton(true), 7600);
    push(() => {
      const resetBtn = document.querySelector<HTMLElement>('[data-demo-sim-reset]');
      const rect = resetBtn?.getBoundingClientRect();
      if (rect) setSimCursorPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }, 8000);
  }, [handleResizeTile, handleMoveTile]);

  const resetSimulation = useCallback(() => {
    clearSimTimeouts();
    if (simAnimationRef.current != null) {
      cancelAnimationFrame(simAnimationRef.current);
      simAnimationRef.current = null;
    }
    setTiles(getInitialDemoTiles());
    window.dispatchEvent(new CustomEvent('demo-reset-context'));
    setIsSimulationActive(false);
    setShowSimResetButton(false);
    setSimDragPreview(null);
    setSimCursorPosition({ x: -100, y: -100 });
  }, [clearSimTimeouts]);

  useEffect(() => {
    return () => clearSimTimeouts();
  }, [clearSimTimeouts]);

  const handleAddTile = useCallback((type: UnifiedTile['type']) => {
    setAddMenuAnchor(null);
    const pos = findNextPosition();
    let newTile: UnifiedTile;
    if (type === 'sec_search') {
      newTile = createDemoTile(type, {
        title: 'SEC Search (Demo)',
        gridPosition: pos,
        results: DUMMY_SEC_RESULTS,
        searchParams: {},
        paginationState: {
          totalResultsLoaded: DUMMY_SEC_RESULTS.length,
          lastEvaluatedKeys: [],
          hasMore: false,
        },
      });
    } else if (type === 'govt_contracts') {
      newTile = createDemoTile(type, {
        title: 'Government Contracts (Demo)',
        gridPosition: pos,
        results: DUMMY_GOVT_CONTRACTS as any,
        searchParams: {},
        paginationState: {
          totalResultsLoaded: DUMMY_GOVT_CONTRACTS.length,
          lastEvaluatedKeys: [],
          hasMore: false,
        },
      });
    } else if (type === 'congress_bills') {
      newTile = createDemoTile(type, {
        title: 'Congress Bills (Demo)',
        gridPosition: pos,
        results: DUMMY_CONGRESS_BILLS as any,
        searchParams: {},
        paginationState: {
          totalResultsLoaded: DUMMY_CONGRESS_BILLS.length,
          lastEvaluatedKeys: [],
          hasMore: false,
        },
      });
    } else if (type === 'politician_trades') {
      newTile = createDemoTile(type, {
        title: 'Politician Trades (Demo)',
        gridPosition: pos,
        results: DUMMY_TRADES as any,
        searchParams: {},
        paginationState: {
          totalResultsLoaded: DUMMY_TRADES.length,
          lastEvaluatedKeys: [],
          hasMore: false,
        },
      });
    } else if (type === 'stock') {
      newTile = createDemoTile(type, {
        gridPosition: pos,
        title: 'Stock (Demo)',
        symbol: 'AAPL',
        timeframe: '1d',
      });
    } else if (type === 'crypto') {
      newTile = createDemoTile(type, {
        gridPosition: pos,
        title: 'Crypto (Demo)',
        symbol: 'BTC',
        timeframe: '1d',
      });
    } else if (type === 'news') {
      newTile = createDemoTile(type, { gridPosition: pos, title: 'News (Demo)' });
    } else {
      newTile = createDemoTile(type, { gridPosition: pos });
    }
    setTiles((prev) => [...prev, newTile]);
  }, [findNextPosition]);

  const tilesWithUniqueIds = useMemo(() => {
    const seen = new Set<string>();
    return tiles.map((t) => {
      let id = t.id;
      if (seen.has(id)) {
        id = `${t.id}_${Date.now()}`;
      }
      seen.add(id);
      return { ...t, id };
    });
  }, [tiles]);

  const [zoomLevel, setZoomLevel] = useState(1.0);

  return (
    <DemoDashboardProvider isDemo>
      <Box sx={{ width: '100%', minHeight: 520, bgcolor: 'grey.900', display: 'flex', flexDirection: 'column' }}>
        {/* Header: title, description, zoom - full width */}
        <Box sx={{ flexShrink: 0, py: 4, px: 2 }}>
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary', mb: 1, fontSize: { xs: '1.75rem', md: '2rem' } }}>
              Try out FinGov
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '1.125rem' }}>
              Drag and resize tiles, add items to the chat sidebar. This demo uses sample data only.
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, justifyContent: 'center', mb: 2 }}>
            {!isSimulationActive && (
              <Button
                variant="contained"
                startIcon={<PlayIcon />}
                onClick={startSimulation}
                sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 0, boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
              >
                Start simulation
              </Button>
            )}
            {showSimResetButton && (
              <Button
                data-demo-sim-reset
                variant="outlined"
                color="primary"
                startIcon={<ReplayIcon />}
                onClick={resetSimulation}
                sx={{
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: 0,
                  animation: 'simResetGlow 2s ease-in-out infinite',
                  '@keyframes simResetGlow': {
                    '0%, 100%': { boxShadow: '0 0 12px rgba(59, 130, 246, 0.5), 0 0 24px rgba(59, 130, 246, 0.25)' },
                    '50%': { boxShadow: '0 0 20px rgba(59, 130, 246, 0.8), 0 0 40px rgba(59, 130, 246, 0.4)' },
                  },
                }}
              >
                Reset demo
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={(e) => setAddMenuAnchor(e.currentTarget)}
              disabled={isSimulationActive}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 0 }}
            >
              Add tile
            </Button>
            <Menu
              anchorEl={addMenuAnchor}
              open={Boolean(addMenuAnchor)}
              onClose={() => setAddMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              PaperProps={{ sx: { bgcolor: 'grey.800', mt: 1.5 } }}
            >
              {DEMO_TILE_TYPES.map(({ type, label }) => (
                <MenuItem
                  key={type}
                  onClick={() => handleAddTile(type)}
                  sx={{ color: 'text.primary' }}
                >
                  {label}
                </MenuItem>
              ))}
            </Menu>
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              justifyContent: 'flex-start',
            }}
          >
            <Tooltip title="Zoom Out (Ctrl/Cmd + -)">
              <IconButton
                onClick={() => setZoomLevel((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM))}
                disabled={zoomLevel <= MIN_ZOOM}
                size="small"
                sx={{
                  color: '#94a3b8',
                  '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                  '&:disabled': { color: '#475569' },
                }}
              >
                <ZoomOut fontSize="small" />
              </IconButton>
            </Tooltip>
            <Chip
              label={`${Math.round(zoomLevel * 100)}%`}
              size="small"
              sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                color: '#60a5fa',
                fontWeight: 600,
                minWidth: 60,
                cursor: 'default',
              }}
            />
            <Tooltip title="Zoom In (Ctrl/Cmd + +)">
              <IconButton
                onClick={() => setZoomLevel((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM))}
                disabled={zoomLevel >= MAX_ZOOM}
                size="small"
                sx={{
                  color: '#94a3b8',
                  '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                  '&:disabled': { color: '#475569' },
                }}
              >
                <ZoomIn fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reset Zoom (Ctrl/Cmd + 0)">
              <IconButton
                onClick={() => setZoomLevel(1.0)}
                disabled={zoomLevel === 1.0}
                size="small"
                sx={{
                  color: '#94a3b8',
                  '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.2)' },
                  '&:disabled': { color: '#475569' },
                }}
              >
                <ZoomOutMap fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Grid | sidebar row: reduced height so demo fits on 1080p without cutoff */}
        <Box
          sx={{
            flex: 1,
            minHeight: 320,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            px: 2,
          }}
        >
          <Box ref={gridContainerRef} sx={{ flex: 1, minWidth: 0 }}>
            <Box data-tutorial="demo-dashboard-grid" sx={{ position: 'relative', height: '100%' }}>
              <GridDashboard
                tiles={tilesWithUniqueIds}
                dashboardContext={DEMO_DASHBOARD_ID}
                onRemoveTile={handleRemoveTile}
                onUpdateTile={handleUpdateTile}
                onSettingsChange={handleSettingsChange}
                onResizeTile={handleResizeTile}
                onMoveTile={handleMoveTile}
                zoomLevel={zoomLevel}
              />
            </Box>
          </Box>

          {/* Demo chat sidebar: same height as grid only; borders top, left, bottom */}
          <Box
            ref={sidebarRef}
            sx={{
              flexShrink: 0,
              width: DEMO_CHAT_SIDEBAR_WIDTH,
              borderLeft: '2px solid #374151',
              borderTop: '2px solid #374151',
              borderBottom: '2px solid #374151',
              display: 'flex',
              flexDirection: 'column',
              ml: 2,
            }}
          >
            <DemoChatSidebar />
          </Box>
        </Box>

        {/* Simulation cursor and drag preview: portaled to body so position:fixed uses viewport coords (demo section has zoom: 0.8) */}
        {typeof document !== 'undefined' &&
          createPortal(
            <>
              {isSimulationActive && !showSimResetButton && (
                <Box
                  sx={{
                    position: 'fixed',
                    left: simCursorPosition.x,
                    top: simCursorPosition.y,
                    width: SIM_CURSOR_IMAGE ? 32 : 24,
                    height: SIM_CURSOR_IMAGE ? 32 : 24,
                    marginLeft: SIM_CURSOR_IMAGE ? -SIM_CURSOR_HOTSPOT.x : -2,
                    marginTop: SIM_CURSOR_IMAGE ? -SIM_CURSOR_HOTSPOT.y : -2,
                    pointerEvents: 'none',
                    zIndex: 10001,
                    transition: 'left 0.35s ease-out, top 0.35s ease-out',
                  }}
                >
                  {SIM_CURSOR_IMAGE ? (
                    <Box
                      component="img"
                      src={SIM_CURSOR_IMAGE}
                      alt=""
                      sx={{ width: '100%', height: '100%', display: 'block' }}
                    />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M2 2L2 28L12 18L18 28L22 26L16 16L28 14L2 2Z"
                        fill="#fff"
                        stroke="#000"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </Box>
              )}
              {isSimulationActive && simDragPreview && (
                <Box
                  sx={{
                    position: 'fixed',
                    left: simCursorPosition.x + 18,
                    top: simCursorPosition.y + 18,
                    minWidth: 160,
                    maxWidth: 220,
                    py: 1,
                    px: 1.5,
                    borderRadius: 1,
                    bgcolor: 'grey.800',
                    border: '1px solid #3b82f6',
                    boxShadow: 3,
                    pointerEvents: 'none',
                    zIndex: 10000,
                    transition: 'left 0.35s ease-out, top 0.35s ease-out',
                  }}
                >
                  <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.8125rem' }} noWrap>
                    {simDragPreview.title}
                  </Typography>
                  {simDragPreview.subtitle && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }} noWrap>
                      {simDragPreview.subtitle}
                    </Typography>
                  )}
                </Box>
              )}
            </>,
            document.body
          )}
      </Box>
    </DemoDashboardProvider>
  );
}