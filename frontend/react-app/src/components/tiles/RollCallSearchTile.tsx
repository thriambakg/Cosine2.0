/**
 * Roll Call Search Tile — ported from CongressBillsSearchTile.
 * Search by politician (SEARCH#VOTE) or by congress/session/roll (SEARCH#ROLL).
 * Same patterns: single/ctrl/shift click, right-click context menu, drag to context, delete tile.
 */
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  Button,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Checkbox,
  Chip,
  Pagination,
  Alert,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Dashboard as AddToContextIcon,
  Folder as FolderIcon,
  Visibility as ViewDetailsIcon,
  ViewColumn as ViewColumnIcon,
  FilterList as FilterIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';
import { useAuth } from '../../contexts/AuthContext';
import { useDemoDashboard } from '@/contexts/DemoDashboardContext';
import { congressBillsSearchAPI } from '../../services/api';
import { politicianSuggestionsService } from '../../services/politicianSuggestions';
import { filesystemAPI } from '../../services/api';
import {
  useTilePinning,
  TileHeaderActions,
  TileCustomizationDialog,
  addRollCallToContext,
  addMultipleRollCallsToContext,
  addBillToContext,
  addMultipleBillsToContext,
  getIconByName,
  getDefaultIconForTileType,
} from './common';
import MultiSelectField from '../MultiSelectField';
import { getTileBatchSize, getTileMaxPages, getTileMaxPaginationKeys } from './config/tileConfig';

const ROLL_CALL_TILE_TYPE = 'congress_roll_calls';

export type RollCallSearchParamsType = {
  politician_names?: string[];
  congress?: number;
  session?: number;
  roll?: number;
};

export type RollCallResultRow = {
  congress: number;
  session: number;
  roll: number;
  roll_display?: string;
  bill_id_associated?: string;
  search_index_sk?: string;
  politician?: string;
  voteType?: 'Yea' | 'Nay' | 'Present' | 'Not Voting';
  bill_id?: string;
  rowKey: string;
  latest_action_date?: string;
};

/** One row per (bill_id, politician, voteType) for Bills view when searching by politician */
export type VoteBillRow = {
  bill_id: string;
  politician?: string;
  voteType?: 'Yea' | 'Nay' | 'Present' | 'Not Voting';
  congress: number;
  rowKey: string;
};

interface RollCallSearchTileProps {
  id: string;
  size?: { width: number; height: number };
  dashboardContext?: string;
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (id: string, selected: boolean) => void;
  searchParams?: RollCallSearchParamsType;
  results?: RollCallResultRow[];
  billDetails?: Record<string, any>;
  rollDates?: Record<string, string>;
  searchIndex?: 'SEARCH#VOTE' | 'SEARCH#ROLL' | null;
  paginationState?: { last_evaluated_key?: any; has_more?: boolean; lastEvaluatedKeys?: any[] };
  isPinned?: boolean;
  customTitle?: string;
  customColor?: string;
  customIcon?: string;
}

const BATCH_SIZE = getTileBatchSize(ROLL_CALL_TILE_TYPE) || 100;
const MAX_PAGES = getTileMaxPages(ROLL_CALL_TILE_TYPE);
const MAX_PAGINATION_KEYS = getTileMaxPaginationKeys(ROLL_CALL_TILE_TYPE);

const parseRollKey = (key: string): { congress: number; session: number; roll: number } => {
  const parts = String(key).split('#');
  return {
    congress: parts[0] != null ? parseInt(parts[0], 10) : NaN,
    session: parts[1] != null ? parseInt(parts[1], 10) : NaN,
    roll: parts[2] != null ? parseInt(parts[2], 10) : NaN,
  };
};

/** Flatten SEARCH#VOTE API response (one object per politician with roll_yea/roll_nea/etc.) into one row per roll call. */
function flattenVoteResults(
  rawResults: any[],
  rollDates: Record<string, string>
): RollCallResultRow[] {
  const rows: RollCallResultRow[] = [];
  const voteTypes = [
    { rollKey: 'roll_yea', billKey: 'bill_yea', voteType: 'Yea' as const },
    { rollKey: 'roll_nea', billKey: 'bill_nea', voteType: 'Nay' as const },
    { rollKey: 'roll_present', billKey: 'bill_present', voteType: 'Present' as const },
    { rollKey: 'roll_not_voting', billKey: 'bill_not_voting', voteType: 'Not Voting' as const },
  ];
  rawResults.forEach((r: any, idx: number) => {
    const displayName = r.display_name || r.search_value || '';
    voteTypes.forEach(({ rollKey, billKey, voteType }) => {
      const rollArr = Array.isArray(r[rollKey]) ? r[rollKey] : [];
      const billArr = Array.isArray(r[billKey]) ? r[billKey] : undefined;
      rollArr.forEach((key: string, i: number) => {
        const { congress, session, roll } = parseRollKey(key);
        if (!isNaN(congress) && !isNaN(session) && !isNaN(roll)) {
          const billId = billArr && billArr[i] ? billArr[i] : undefined;
          const rollKeyStr = `${congress}#${session}#${roll}`;
          rows.push({
            politician: displayName,
            congress,
            session,
            roll,
            roll_display: `Roll no. ${roll}`,
            voteType,
            bill_id: billId,
            latest_action_date: rollDates[rollKeyStr] ?? '',
            rowKey: `vote-${idx}-${voteType}-${key}-${i}`,
          });
        }
      });
    });
  });
  if (rows.length === 0) {
    rawResults.forEach((r: any, idx: number) => {
      const displayName = r.display_name || r.search_value || '';
      const rollNea = Array.isArray(r.roll_nea) ? r.roll_nea : [];
      const billNea = Array.isArray(r.bill_nea) ? r.bill_nea : undefined;
      rollNea.forEach((key: string, i: number) => {
        const { congress, session, roll } = parseRollKey(key);
        if (!isNaN(congress) && !isNaN(session) && !isNaN(roll)) {
          const rollKeyStr = `${congress}#${session}#${roll}`;
          rows.push({
            politician: displayName,
            congress,
            session,
            roll,
            roll_display: `Roll no. ${roll}`,
            voteType: 'Nay' as const,
            bill_id: billNea && billNea[i] ? billNea[i] : undefined,
            latest_action_date: rollDates[rollKeyStr] ?? '',
            rowKey: `vote-legacy-${r.bill_id || idx}-${i}-${key}`,
          });
        }
      });
    });
  }
  return rows;
}

function rowsWithKeys(raw: any[]): RollCallResultRow[] {
  return raw.map((r, i) => ({
    ...r,
    rowKey: r.search_index_sk ?? `roll-${r.congress}-${r.session}-${r.roll}-${i}`,
  }));
}

const AVAILABLE_COLUMNS = ['congress', 'session', 'roll', 'associated_bill', 'politician', 'vote', 'bill'] as const;
const DEFAULT_VISIBLE_COLUMNS_ROLL = ['congress', 'session', 'roll', 'associated_bill'];
const DEFAULT_VISIBLE_COLUMNS_VOTE = ['congress', 'session', 'roll', 'politician', 'vote', 'bill'];

const RollCallSearchTile: React.FC<RollCallSearchTileProps> = ({
  id,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isSelected = false,
  onSelectionChange,
  searchParams = {},
  results = [],
  billDetails: initialBillDetails = {},
  rollDates: initialRollDates = {},
  searchIndex: initialSearchIndex = null,
  paginationState: initialPaginationState,
  isPinned = false,
  customTitle,
  customColor,
  customIcon,
}) => {
  const { user } = useAuth();
  const { isDemo } = useDemoDashboard();
  const { openItemDetails } = useDialogManagerHelpers();
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);

  const [politicianNames, setPoliticianNames] = useState<string[]>(searchParams.politician_names ?? []);
  const [congressNum, setCongressNum] = useState<number>(searchParams.congress ?? 119);
  const [rollInput, setRollInput] = useState<string>(searchParams.roll != null ? String(searchParams.roll) : '');

  // Initial state from props only — no useEffect syncing to avoid max update depth
  const [allResults, setAllResults] = useState<RollCallResultRow[]>(() => (results && results.length) ? results : []);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(initialPaginationState?.last_evaluated_key ?? null);
  const [lastEvaluatedKeys, setLastEvaluatedKeys] = useState<any[]>(() => {
    const keys = initialPaginationState?.lastEvaluatedKeys ?? (initialPaginationState?.last_evaluated_key ? [initialPaginationState.last_evaluated_key] : []);
    return keys.slice(0, MAX_PAGINATION_KEYS);
  });
  const [hasMore, setHasMore] = useState(!!initialPaginationState?.has_more);
  const [hasPerformedInitialSearch, setHasPerformedInitialSearch] = useState((results && results.length) > 0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(`rollCall_pageSize_${id}`) : null;
      return saved ? parseInt(saved, 10) : 10;
    } catch { return 10; }
  });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    initialSearchIndex === 'SEARCH#VOTE' ? [...DEFAULT_VISIBLE_COLUMNS_VOTE] : [...DEFAULT_VISIBLE_COLUMNS_ROLL]
  );
  const [searchIndex, setSearchIndex] = useState<'SEARCH#VOTE' | 'SEARCH#ROLL' | null>(initialSearchIndex);
  const [billDetails, setBillDetails] = useState<Record<string, any>>(initialBillDetails);
  const [rollDates, setRollDates] = useState<Record<string, string>>(initialRollDates);
  const [isPoliticianDataLoaded, setIsPoliticianDataLoaded] = useState(false);
  /** When searching by politician: 'rollcalls' = one row per roll, 'bills' = one row per bill */
  const [politicianResultView, setPoliticianResultView] = useState<'rollcalls' | 'bills'>('rollcalls');
  const [selectedVoteBills, setSelectedVoteBills] = useState<Set<string>>(new Set());
  const [voteBillCurrentPage, setVoteBillCurrentPage] = useState(1);

  const [selectedRollCalls, setSelectedRollCalls] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [lastSelectedVoteBillIndex, setLastSelectedVoteBillIndex] = useState<number | null>(null);

  /** Roll call view filters (Congress, Session, Vote type, Politician) */
  const [rollCallSelectedFilters, setRollCallSelectedFilters] = useState<{
    congresses: Set<number>;
    sessions: Set<number>;
    voteTypes: Set<string>;
    politicians: Set<string>;
  }>({ congresses: new Set(), sessions: new Set(), voteTypes: new Set(), politicians: new Set() });
  /** Bills view filters (Congress, Vote type, Politician, Bill type, Sponsor party) */
  const [billSelectedFilters, setBillSelectedFilters] = useState<{
    congresses: Set<number>;
    voteTypes: Set<string>;
    politicians: Set<string>;
    billTypes: Set<string>;
    sponsorParties: Set<string>;
  }>({ congresses: new Set(), voteTypes: new Set(), politicians: new Set(), billTypes: new Set(), sponsorParties: new Set() });

  const tileRef = useRef<HTMLDivElement>(null);

  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => onSettingsChange(id, { isPinned: pinned }),
  });

  useEffect(() => {
    politicianSuggestionsService.loadPoliticians().then(() => setIsPoliticianDataLoaded(true)).catch(() => {});
  }, []);

  /** Bills view: one row per (bill_id, politician, voteType) derived from roll-call rows when searching by politician */
  const voteBillRows = React.useMemo((): VoteBillRow[] => {
    if (searchIndex !== 'SEARCH#VOTE' || !allResults.length) return [];
    const rows: VoteBillRow[] = [];
    const seen = new Set<string>();
    allResults.forEach((r) => {
      if (!r.bill_id) return;
      const key = `${r.bill_id}|${r.politician ?? ''}|${r.voteType ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        bill_id: r.bill_id,
        politician: r.politician,
        voteType: r.voteType,
        congress: r.congress,
        rowKey: `bill-${r.bill_id}-${r.politician ?? ''}-${r.voteType ?? ''}-${rows.length}`,
      });
    });
    return rows;
  }, [searchIndex, allResults]);

  /** Available filter options for roll call view (from current allResults) */
  const availableRollCallFilters = React.useMemo(() => {
    const congressMap = new Map<number, number>();
    const sessionMap = new Map<number, number>();
    const voteTypeMap = new Map<string, number>();
    const politicianMap = new Map<string, number>();
    allResults.forEach((r) => {
      congressMap.set(r.congress, (congressMap.get(r.congress) ?? 0) + 1);
      sessionMap.set(r.session, (sessionMap.get(r.session) ?? 0) + 1);
      if (r.voteType) voteTypeMap.set(r.voteType, (voteTypeMap.get(r.voteType) ?? 0) + 1);
      if (r.politician) politicianMap.set(r.politician, (politicianMap.get(r.politician) ?? 0) + 1);
    });
    return {
      congresses: Array.from(congressMap.entries()).map(([c, count]) => ({ value: c, count })).sort((a, b) => b.value - a.value),
      sessions: Array.from(sessionMap.entries()).map(([s, count]) => ({ value: s, count })).sort((a, b) => a.value - b.value),
      voteTypes: Array.from(voteTypeMap.entries()).map(([v, count]) => ({ value: v, count })).sort((a, b) => a.value.localeCompare(b.value)),
      politicians: Array.from(politicianMap.entries()).map(([p, count]) => ({ value: p, count })).sort((a, b) => b.count - a.count).slice(0, 50),
    };
  }, [allResults]);

  /** Available filter options for bills view (from voteBillRows + billDetails) */
  const availableBillFilters = React.useMemo(() => {
    const congressMap = new Map<number, number>();
    const voteTypeMap = new Map<string, number>();
    const politicianMap = new Map<string, number>();
    const billTypeMap = new Map<string, number>();
    const sponsorPartyMap = new Map<string, number>();
    voteBillRows.forEach((r) => {
      congressMap.set(r.congress, (congressMap.get(r.congress) ?? 0) + 1);
      if (r.voteType) voteTypeMap.set(r.voteType, (voteTypeMap.get(r.voteType) ?? 0) + 1);
      if (r.politician) politicianMap.set(r.politician, (politicianMap.get(r.politician) ?? 0) + 1);
      const d = billDetails[r.bill_id];
      if (d?.bill_type) billTypeMap.set(d.bill_type, (billTypeMap.get(d.bill_type) ?? 0) + 1);
      if (d?.sponsor_party) sponsorPartyMap.set(d.sponsor_party, (sponsorPartyMap.get(d.sponsor_party) ?? 0) + 1);
    });
    return {
      congresses: Array.from(congressMap.entries()).map(([c, count]) => ({ value: c, count })).sort((a, b) => b.value - a.value),
      voteTypes: Array.from(voteTypeMap.entries()).map(([v, count]) => ({ value: v, count })).sort((a, b) => a.value.localeCompare(b.value)),
      politicians: Array.from(politicianMap.entries()).map(([p, count]) => ({ value: p, count })).sort((a, b) => b.count - a.count).slice(0, 50),
      billTypes: Array.from(billTypeMap.entries()).map(([t, count]) => ({ value: t, count })).sort((a, b) => a.value.localeCompare(b.value)),
      sponsorParties: Array.from(sponsorPartyMap.entries()).map(([p, count]) => ({ value: p, count })).sort((a, b) => a.value.localeCompare(b.value)),
    };
  }, [voteBillRows, billDetails]);

  /** Filtered roll call rows (for roll call view) */
  const filteredRollCallRows = React.useMemo(() => {
    let rows = [...allResults];
    if (rollCallSelectedFilters.congresses.size > 0) rows = rows.filter((r) => rollCallSelectedFilters.congresses.has(r.congress));
    if (rollCallSelectedFilters.sessions.size > 0) rows = rows.filter((r) => rollCallSelectedFilters.sessions.has(r.session));
    if (rollCallSelectedFilters.voteTypes.size > 0) rows = rows.filter((r) => r.voteType && rollCallSelectedFilters.voteTypes.has(r.voteType));
    if (rollCallSelectedFilters.politicians.size > 0) rows = rows.filter((r) => r.politician && rollCallSelectedFilters.politicians.has(r.politician));
    return rows;
  }, [allResults, rollCallSelectedFilters]);

  /** Filtered bill rows (for bills view) */
  const filteredBillRows = React.useMemo(() => {
    let rows = [...voteBillRows];
    if (billSelectedFilters.congresses.size > 0) rows = rows.filter((r) => billSelectedFilters.congresses.has(r.congress));
    if (billSelectedFilters.voteTypes.size > 0) rows = rows.filter((r) => r.voteType && billSelectedFilters.voteTypes.has(r.voteType));
    if (billSelectedFilters.politicians.size > 0) rows = rows.filter((r) => r.politician && billSelectedFilters.politicians.has(r.politician));
    if (billSelectedFilters.billTypes.size > 0) {
      rows = rows.filter((r) => {
        const d = billDetails[r.bill_id];
        return d?.bill_type && billSelectedFilters.billTypes.has(d.bill_type);
      });
    }
    if (billSelectedFilters.sponsorParties.size > 0) {
      rows = rows.filter((r) => {
        const d = billDetails[r.bill_id];
        return d?.sponsor_party && billSelectedFilters.sponsorParties.has(d.sponsor_party);
      });
    }
    return rows;
  }, [voteBillRows, billDetails, billSelectedFilters]);

  const handleColumnToggle = useCallback((column: string) => {
    setVisibleColumns((prev) =>
      prev.includes(column) ? prev.filter((c) => c !== column) : [...prev, column]
    );
  }, []);

  const performSearch = useCallback(async (clearPagination: boolean = true) => {
    if (isDemo) {
      const source = results?.length ? results : [];
      setAllResults(source);
      setHasPerformedInitialSearch(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    if (clearPagination) {
      setLastEvaluatedKeys([]);
      setRollCallSelectedFilters({ congresses: new Set(), sessions: new Set(), voteTypes: new Set(), politicians: new Set() });
      setBillSelectedFilters({ congresses: new Set(), voteTypes: new Set(), politicians: new Set(), billTypes: new Set(), sponsorParties: new Set() });
    }

    try {
      const hasPoliticians = politicianNames.length > 0;
      const rollNum = rollInput.trim() ? parseInt(rollInput.trim(), 10) : undefined;
      const validRoll = rollNum != null && !isNaN(rollNum);

      if (hasPoliticians) {
        const ids = politicianNames.map((name) => {
          const p = politicianSuggestionsService.getAllPoliticians().find((x) => x.fullName === name);
          return p?.bioguide_id ?? `NAME#${(name || '').replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;
        });
        const res = await congressBillsSearchAPI.rollCallSearch({
          search_index: 'SEARCH#VOTE',
          politician_ids: ids,
          limit: BATCH_SIZE,
        });
        if (res.success && res.results) {
          const resAny = res as any;
          const details = resAny.bill_details && typeof resAny.bill_details === 'object' ? resAny.bill_details : {};
          const dates = resAny.roll_dates && typeof resAny.roll_dates === 'object' ? resAny.roll_dates : {};
          setBillDetails((prev) => ({ ...prev, ...details }));
          setRollDates(dates);
          setSearchIndex('SEARCH#VOTE');
          setVisibleColumns((prev) => (prev.length === 4 && prev.every((c) => ['congress', 'session', 'roll', 'associated_bill'].includes(c))) ? [...DEFAULT_VISIBLE_COLUMNS_VOTE] : prev);
          const flattened = flattenVoteResults(res.results, dates);
          setAllResults(flattened);
          setHasPerformedInitialSearch(true);
          const lek = res.last_evaluated_key ?? null;
          setLastEvaluatedKey(lek);
          setHasMore(!!res.has_more && !!lek);
          const keys = lek ? [lek].slice(0, MAX_PAGINATION_KEYS) : [];
          setLastEvaluatedKeys(keys);
          onUpdate(id, {
            searchParams: { politician_names: politicianNames, congress: congressNum, session: searchParams.session, roll: validRoll ? rollNum : undefined },
            results: flattened,
            billDetails: { ...billDetails, ...details },
            rollDates: dates,
            searchIndex: 'SEARCH#VOTE',
            paginationState: { last_evaluated_key: lek, has_more: !!res.has_more && !!lek, lastEvaluatedKeys: keys },
          });
        }
      } else {
        const res = await congressBillsSearchAPI.rollCallSearch({
          search_index: 'SEARCH#ROLL',
          congress: congressNum,
          roll: validRoll ? rollNum : undefined,
          limit: BATCH_SIZE,
        });
        if (res.success && res.results) {
          const newRows = rowsWithKeys(res.results);
          setAllResults(newRows);
          setSearchIndex('SEARCH#ROLL');
          setHasPerformedInitialSearch(true);
          const lek = res.last_evaluated_key ?? null;
          setLastEvaluatedKey(lek);
          setHasMore(!!res.has_more && !!lek);
          const keys = lek ? [lek].slice(0, MAX_PAGINATION_KEYS) : [];
          setLastEvaluatedKeys(keys);
          onUpdate(id, {
            searchParams: { politician_names: [], congress: congressNum, session: searchParams.session, roll: validRoll ? rollNum : undefined },
            results: newRows,
            searchIndex: 'SEARCH#ROLL',
            paginationState: { last_evaluated_key: lek, has_more: !!res.has_more && !!lek, lastEvaluatedKeys: keys },
          });
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Search failed');
      setAllResults([]);
      setHasPerformedInitialSearch(true);
    } finally {
      setIsLoading(false);
    }
  }, [politicianNames, congressNum, rollInput, id, onUpdate, searchParams.session, isDemo, results]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore || lastEvaluatedKeys.length >= MAX_PAGES) return;
    setIsLoadingMore(true);
    try {
      const hasPoliticians = politicianNames.length > 0;
      const rollNum = rollInput.trim() ? parseInt(rollInput.trim(), 10) : undefined;
      const validRoll = rollNum != null && !isNaN(rollNum);

      if (hasPoliticians) {
        const ids = politicianNames.map((name) => {
          const p = politicianSuggestionsService.getAllPoliticians().find((x) => x.fullName === name);
          return p?.bioguide_id ?? `NAME#${(name || '').replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;
        });
        const res = await congressBillsSearchAPI.rollCallSearch({
          search_index: 'SEARCH#VOTE',
          politician_ids: ids,
          limit: BATCH_SIZE,
          last_evaluated_key: lastEvaluatedKey,
        });
        if (res.success && res.results) {
          const resAny = res as any;
          const details = resAny.bill_details && typeof resAny.bill_details === 'object' ? resAny.bill_details : {};
          const dates = resAny.roll_dates && typeof resAny.roll_dates === 'object' ? resAny.roll_dates : {};
          setBillDetails((prev) => ({ ...prev, ...details }));
          setRollDates((prev) => ({ ...prev, ...dates }));
          const flattenedNew = flattenVoteResults(res.results, { ...rollDates, ...dates });
          const merged = [...allResults, ...flattenedNew];
          setAllResults(merged);
          const lek = res.last_evaluated_key ?? null;
          setLastEvaluatedKey(lek);
          const newKeys = lek ? [...lastEvaluatedKeys, lek].slice(0, MAX_PAGINATION_KEYS) : lastEvaluatedKeys;
          setLastEvaluatedKeys(newKeys);
          setHasMore(!!res.has_more && !!lek && newKeys.length < MAX_PAGES);
          onUpdate(id, {
            results: merged,
            billDetails: { ...billDetails, ...details },
            rollDates: { ...rollDates, ...dates },
            paginationState: { last_evaluated_key: lek, has_more: !!res.has_more && !!lek, lastEvaluatedKeys: newKeys },
          });
        }
      } else {
        const res = await congressBillsSearchAPI.rollCallSearch({
          search_index: 'SEARCH#ROLL',
          congress: congressNum,
          roll: validRoll ? rollNum : undefined,
          limit: BATCH_SIZE,
          last_evaluated_key: lastEvaluatedKey,
        });
        if (res.success && res.results) {
          const newRows = rowsWithKeys(res.results);
          const merged = [...allResults, ...newRows];
          setAllResults(merged);
          const lek = res.last_evaluated_key ?? null;
          const newKeys = lek ? [...lastEvaluatedKeys, lek].slice(0, MAX_PAGINATION_KEYS) : lastEvaluatedKeys;
          setLastEvaluatedKeys(newKeys);
          setLastEvaluatedKey(lek);
          setHasMore(!!res.has_more && !!lek && newKeys.length < MAX_PAGES);
          onUpdate(id, {
            results: merged,
            paginationState: { last_evaluated_key: lek, has_more: !!res.has_more && !!lek, lastEvaluatedKeys: newKeys },
          });
        }
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, lastEvaluatedKeys, politicianNames, congressNum, rollInput, allResults, id, onUpdate]);

  const handleRemove = useCallback(() => {
    onRemove(id);
  }, [id, onRemove]);

  const handleRowClick = (e: React.MouseEvent, rowKey: string, index: number) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button, a, input, [role="button"]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    setSelectedRollCalls((prev) => {
      const next = new Set(prev);
      if (shift && lastSelectedIndex != null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        allResults.slice(start, end + 1).forEach((r) => next.add(r.rowKey));
      } else if (ctrl) {
        if (next.has(rowKey)) next.delete(rowKey);
        else next.add(rowKey);
        setLastSelectedIndex(index);
      } else {
        next.clear();
        next.add(rowKey);
        setLastSelectedIndex(index);
      }
      return next;
    });
    if (!shift) setLastSelectedIndex(index);
  };

  const handleDragStart = (e: React.DragEvent, rowKey: string) => {
    e.stopPropagation();
    const toDrag = selectedRollCalls.has(rowKey) ? selectedRollCalls : new Set([rowKey]);
    const rows = allResults.filter((r) => toDrag.has(r.rowKey));
    const rollCalls = rows.map((r) => ({
      congress: r.congress,
      session: r.session,
      roll: r.roll,
      roll_display: r.roll_display,
      bill_id_associated: r.bill_id_associated,
      search_index_sk: r.search_index_sk,
    }));
    if (rollCalls.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'roll_calls', rollCalls }));
    }
  };

  const handleRowContextMenu = (e: React.MouseEvent, rowKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedRollCalls.has(rowKey)) setSelectedRollCalls(new Set([rowKey]));
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleContextMenuClose = () => setContextMenuPosition(null);

  const handleAddToContext = () => {
    const rows = allResults.filter((r) => selectedRollCalls.has(r.rowKey));
    const items = rows.map((r) => ({
      congress: r.congress,
      session: r.session,
      roll: r.roll,
      roll_display: r.roll_display,
      bill_id_associated: r.bill_id_associated,
      search_index_sk: r.search_index_sk,
    }));
    if (items.length === 1) addRollCallToContext(items[0], items[0].roll_display ?? `Roll ${items[0].congress}-${items[0].session}-${items[0].roll}`);
    else if (items.length > 1) addMultipleRollCallsToContext(items);
    setSelectedRollCalls(new Set());
    handleContextMenuClose();
  };

  const handleVoteBillClick = (e: React.MouseEvent, billId: string, globalIndex: number) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    if (shift && lastSelectedVoteBillIndex !== null) {
      const start = Math.min(lastSelectedVoteBillIndex, globalIndex);
      const end = Math.max(lastSelectedVoteBillIndex, globalIndex);
      const slice = voteBillRows.slice(start, end + 1);
      const toAdd = new Set(slice.map((r) => r.bill_id));
      setSelectedVoteBills((prev) => new Set([...prev, ...toAdd]));
    } else if (ctrl) {
      setSelectedVoteBills((prev) => {
        const next = new Set(prev);
        if (next.has(billId)) next.delete(billId);
        else next.add(billId);
        return next;
      });
    } else {
      setSelectedVoteBills(selectedVoteBills.has(billId) ? new Set() : new Set([billId]));
    }
    if (!shift) setLastSelectedVoteBillIndex(globalIndex);
  };

  const handleVoteBillAddToContext = () => {
    const bills = Array.from(selectedVoteBills)
      .map((id) => billDetails[id])
      .filter(Boolean);
    if (bills.length === 1) addBillToContext(bills[0]);
    else if (bills.length > 1) addMultipleBillsToContext(bills);
    setSelectedVoteBills(new Set());
    handleContextMenuClose();
  };

  const handleVoteBillRowContextMenu = (e: React.MouseEvent, billId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedVoteBills.has(billId)) setSelectedVoteBills(new Set([billId]));
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleVoteBillDragStart = (e: React.DragEvent, billId: string) => {
    e.stopPropagation();
    const toDrag = selectedVoteBills.has(billId) ? selectedVoteBills : new Set([billId]);
    const bills = Array.from(toDrag)
      .map((id) => billDetails[id])
      .filter(Boolean);
    if (bills.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'bills', bills }));
    }
  };

  const handleAddToFiles = () => {
    setContextMenuPosition(null);
    setFileBrowserOpen(true);
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user?.id) return;
    const isBills = searchIndex === 'SEARCH#VOTE' && politicianResultView === 'bills';
    if (isBills) {
      if (selectedVoteBills.size === 0) return;
      const items = Array.from(selectedVoteBills).map((bill_id) => {
        const d = billDetails[bill_id];
        return {
          context_data: d ?? { bill_id },
          title: d?.bill_title ?? bill_id,
          item_type: 'congress_bill' as const,
        };
      });
      const response = await filesystemAPI.addBulkContextItems({
        user_id: user.id,
        folder_path: folderPath,
        items,
      });
      if (response.success) setSelectedVoteBills(new Set());
      setFileBrowserOpen(false);
      return;
    }
    if (selectedRollCalls.size === 0) return;
    const rows = allResults.filter((r) => selectedRollCalls.has(r.rowKey));
    const items = rows.map((r) => ({
      context_data: r,
      title: r.roll_display ?? `Roll ${r.congress}-${r.session}-${r.roll}`,
      item_type: 'roll_call' as const,
    }));
    const response = await filesystemAPI.addBulkContextItems({
      user_id: user.id,
      folder_path: folderPath,
      items,
    });
    if (response.success) {
      setSelectedRollCalls(new Set());
    }
    setFileBrowserOpen(false);
  };

  const handleRefresh = useCallback(async () => {
    await performSearch(false);
  }, [performSearch]);

  const politicianSuggestions = isPoliticianDataLoaded
    ? politicianSuggestionsService.getAllPoliticians().map((p) => p.fullName)
    : [];

  const tileColor = customColor || '#3b82f6';
  const isBillsView = searchIndex === 'SEARCH#VOTE' && politicianResultView === 'bills';
  const displayRows = isBillsView ? filteredBillRows : filteredRollCallRows;
  const totalPages = Math.max(1, Math.ceil(displayRows.length / resultsPerPage));
  const displayPage = isBillsView ? voteBillCurrentPage : currentPage;
  const setDisplayPage = isBillsView ? setVoteBillCurrentPage : setCurrentPage;
  const startIndex = (displayPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = displayRows.slice(startIndex, endIndex);

  /** Active filter count for current view (for toolbar tooltip and badge) */
  const currentViewActiveFilterCount = isBillsView
    ? billSelectedFilters.congresses.size + billSelectedFilters.voteTypes.size + billSelectedFilters.politicians.size + billSelectedFilters.billTypes.size + billSelectedFilters.sponsorParties.size
    : rollCallSelectedFilters.congresses.size + rollCallSelectedFilters.sessions.size + rollCallSelectedFilters.voteTypes.size + rollCallSelectedFilters.politicians.size;

  const handleContextMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };

  return (
    <Box
      ref={tileRef}
      sx={{
        p: 3,
        background: 'rgba(15, 23, 42, 0.8)',
        border: `1px solid ${tileColor}40`,
        borderRadius: '0px',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        cursor: pinnedState ? 'default' : (isDragging ? 'grabbing' : (onDragStart ? 'grab' : 'default')),
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: isDragging ? 0.8 : 1,
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          borderColor: tileColor,
          transform: (isDragging || pinnedState) ? 'none' : 'translateY(-2px)',
          boxShadow: (isDragging || pinnedState) ? 'none' : `0 8px 25px ${tileColor}25`,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: allResults.length > 0 ? tileColor : '#dc2626',
        },
      }}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Header with controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onSelectionChange(id, !isSelected);
              }}
              sx={{
                color: '#9ca3af',
                '&.Mui-checked': { color: '#3b82f6' },
                p: 0.5,
                '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
              }}
              size="small"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            />
          )}
          {(() => {
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType(ROLL_CALL_TILE_TYPE));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'Roll Call Search';
            return (
              <>
                <TileIcon sx={{ color: iconColor, fontSize: '1.5rem', mr: 1 }} />
                <Typography variant="h6" color="white" fontWeight={600}>
                  {displayTitle}
                </Typography>
              </>
            );
          })()}
          <Chip
            label={
              isLoadingMore
                ? 'Loading...'
                : hasMore && allResults.length > 0
                  ? `Load More (${allResults.length} loaded)`
                  : displayRows.length !== (isBillsView ? voteBillRows.length : allResults.length)
                    ? `${displayRows.length} of ${isBillsView ? voteBillRows.length : allResults.length} results`
                    : `${displayRows.length} results`
            }
            size="small"
            onClick={hasMore && allResults.length > 0 && !isLoadingMore && !isLoading ? handleLoadMore : undefined}
            disabled={isLoadingMore || isLoading || !hasMore}
            sx={{
              backgroundColor: hasMore && allResults.length > 0 && !isLoadingMore && !isLoading ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              fontSize: '0.75rem',
              height: '20px',
              cursor: hasMore && allResults.length > 0 && !isLoadingMore && !isLoading ? 'pointer' : 'default',
              '&:hover': hasMore && allResults.length > 0 && !isLoadingMore && !isLoading ? { backgroundColor: 'rgba(59, 130, 246, 0.4)', transform: 'scale(1.05)' } : {},
              '&.Mui-disabled': { backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#6b7280', borderColor: '#4b5563', cursor: 'not-allowed' },
            }}
          />
        </Box>

        <TileHeaderActions
          pinButton={{ isPinned: pinnedState, onTogglePin: togglePin }}
          contextButton={{
            onClick: handleContextMenuClick,
            disabled: isBillsView ? selectedVoteBills.size === 0 : selectedRollCalls.size === 0,
            tooltip: isBillsView
              ? (selectedVoteBills.size > 0 ? `Add ${selectedVoteBills.size} bill(s) to context` : 'Add selected to context')
              : (selectedRollCalls.size > 0 ? `Add ${selectedRollCalls.size} roll call(s) to context` : 'Add selected to context'),
            icon: <AddToContextIcon fontSize="small" />,
          }}
          deleteButton={{
            onClick: (e) => { e.stopPropagation(); handleRemove(); },
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
          }}
          customizeButton={{
            onClick: (e) => { e.stopPropagation(); setCustomizeDialogOpen(true); },
          }}
          refreshButton={{
            onClick: (e) => { e.stopPropagation(); handleRefresh(); },
            disabled: isLoading,
            isLoading: isLoading,
            icon: isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />,
          }}
          collapsibleActions={
            <>
              <Tooltip title="Refresh" arrow>
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
                    disabled={isLoading}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{ color: isLoading ? '#6b7280' : '#9ca3af', '&:hover': { color: isLoading ? '#6b7280' : '#3b82f6' }, '&.Mui-disabled': { color: '#6b7280' }, padding: '6px' }}
                  >
                    {isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              {!isBillsView && (
              <Tooltip title="Select columns to display">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); setColumnMenuAnchor(e.currentTarget); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <ViewColumnIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              )}
              <Tooltip
                title={
                  currentViewActiveFilterCount > 0
                    ? `Filter Results (${currentViewActiveFilterCount} active) — ${isBillsView ? 'Bills' : 'Roll calls'} view`
                    : `Filter Results — ${isBillsView ? 'Bills' : 'Roll calls'} view`
                }
              >
                <Box sx={{ position: 'relative' }}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterDialogOpen(true);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{
                      color: currentViewActiveFilterCount > 0 ? '#3b82f6' : '#9ca3af',
                      '&:hover': { color: '#3b82f6' },
                    }}
                  >
                    <FilterIcon fontSize="small" />
                  </IconButton>
                  {currentViewActiveFilterCount > 0 && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        width: 8,
                        height: 8,
                        backgroundColor: '#3b82f6',
                        borderRadius: '50%',
                        border: '1px solid #1e293b',
                      }}
                    />
                  )}
                </Box>
              </Tooltip>
              <Tooltip title="Edit Search Criteria">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); setSearchDialogOpen(true); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <SearchIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
        />
      </Box>

      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 2, flexShrink: 0 }}>
          <CircularProgress size={24} sx={{ color: '#3b82f6', mb: 1 }} />
          <Typography variant="body2" color="#9ca3af">Searching roll calls...</Typography>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 1, backgroundColor: 'rgba(220, 38, 38, 0.1)', flexShrink: 0 }}>{error}</Alert>
      )}

      {/* Results Table */}
      {(allResults.length > 0 || (searchIndex === 'SEARCH#VOTE' && voteBillRows.length > 0)) && !isLoading && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, mt: 1 }}>
          {searchIndex && (
            <Typography variant="caption" sx={{ color: '#94a3b8', mb: 0.5 }}>
              {searchIndex === 'SEARCH#VOTE' ? 'By politician' : 'By roll'}
            </Typography>
          )}
          {searchIndex === 'SEARCH#VOTE' && (
            <Tabs
              value={politicianResultView}
              onChange={(_, v: 'rollcalls' | 'bills') => setPoliticianResultView(v)}
              sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { color: '#94a3b8', minHeight: 36 }, '& .Mui-selected': { color: '#3b82f6' }, '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' } }}
            >
              <Tab label="Roll calls" value="rollcalls" />
              <Tab label="Bills" value="bills" />
            </Tabs>
          )}
          <TableContainer
            sx={{
              flex: 1,
              backgroundColor: 'transparent',
              borderRadius: 0,
              boxShadow: 'none',
              border: 'none',
              overflow: 'auto',
              '&::-webkit-scrollbar': { width: '6px', height: '6px' },
              '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' },
              '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: '3px' },
              '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' },
              '&::-webkit-scrollbar-corner': { backgroundColor: 'rgba(55, 65, 81, 0.3)' },
            }}
          >
            <Table
              size="small"
              sx={{
                tableLayout: 'fixed',
                width: 'max-content',
                minWidth: '100%',
                '& .MuiTableCell-root': { borderBottom: '1px solid rgba(55, 65, 81, 0.3)', padding: '8px 12px', overflow: 'hidden', wordBreak: 'break-word' },
                '& .MuiTableHead-root .MuiTableCell-root': { borderBottom: '2px solid rgba(59, 130, 246, 0.5)', backgroundColor: 'rgba(15, 23, 42, 0.5)' },
                '& .MuiTableRow-root:hover': { backgroundColor: 'rgba(59, 130, 246, 0.05)' },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell padding="none" sx={{ color: '#9ca3af', fontWeight: 600, width: '40px', minWidth: '40px', maxWidth: '40px', padding: '8px 4px' }}>
                    <Checkbox
                      size="small"
                      indeterminate={
                        isBillsView
                          ? selectedVoteBills.size > 0 && selectedVoteBills.size < currentPageResults.length
                          : selectedRollCalls.size > 0 && selectedRollCalls.size < currentPageResults.length
                      }
                      checked={
                        currentPageResults.length > 0 &&
                        (isBillsView
                          ? (currentPageResults as VoteBillRow[]).every((r) => selectedVoteBills.has(r.bill_id))
                          : (currentPageResults as RollCallResultRow[]).every((r) => selectedRollCalls.has(r.rowKey)))
                      }
                      onChange={() => {
                        if (isBillsView) {
                          const billRows = currentPageResults as VoteBillRow[];
                          const billIds = new Set(billRows.map((r) => r.bill_id));
                          const allSelected = billRows.every((r) => selectedVoteBills.has(r.bill_id));
                          setSelectedVoteBills((prev) => {
                            const next = new Set(prev);
                            if (allSelected) billIds.forEach((id) => next.delete(id));
                            else billIds.forEach((id) => next.add(id));
                            return next;
                          });
                        } else {
                          const rows = currentPageResults as RollCallResultRow[];
                          if (selectedRollCalls.size === rows.length) {
                            setSelectedRollCalls((prev) => {
                              const next = new Set(prev);
                              rows.forEach((r) => next.delete(r.rowKey));
                              return next;
                            });
                          } else {
                            setSelectedRollCalls((prev) => {
                              const next = new Set(prev);
                              rows.forEach((r) => next.add(r.rowKey));
                              return next;
                            });
                          }
                        }
                      }}
                      sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#10b981' } }}
                    />
                  </TableCell>
                  {isBillsView ? (
                    <>
                      <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Bill</TableCell>
                      <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Politician</TableCell>
                      <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Vote</TableCell>
                      <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Congress</TableCell>
                    </>
                  ) : (
                    <>
                      {visibleColumns.includes('congress') && <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Congress</TableCell>}
                      {visibleColumns.includes('session') && <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Session</TableCell>}
                      {visibleColumns.includes('roll') && <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Roll</TableCell>}
                      {visibleColumns.includes('associated_bill') && <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Associated Bill</TableCell>}
                      {visibleColumns.includes('politician') && <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Politician</TableCell>}
                      {visibleColumns.includes('vote') && <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Vote</TableCell>}
                      {visibleColumns.includes('bill') && <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>Bill</TableCell>}
                    </>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {isBillsView
                  ? (currentPageResults as VoteBillRow[]).map((row, index) => {
                      const detail = billDetails[row.bill_id];
                      const title = detail?.bill_title ?? row.bill_id;
                      const isSelected = selectedVoteBills.has(row.bill_id);
                      return (
                        <TableRow
                          key={row.rowKey}
                          draggable={isSelected}
                          onDragStart={(e) => handleVoteBillDragStart(e, row.bill_id)}
                          onClick={(e) => handleVoteBillClick(e, row.bill_id, startIndex + index)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (user?.id || isDemo) openItemDetails('congress_bill', detail ?? { bill_id: row.bill_id }, (detail?.bill_title ?? row.bill_id) as string, { user_id: user?.id, constrainToDemo: isDemo });
                          }}
                          onContextMenu={(e) => handleVoteBillRowContextMenu(e, row.bill_id)}
                          sx={{
                            backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                            cursor: 'pointer',
                            userSelect: 'none',
                            '&:hover': { backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)' },
                          }}
                        >
                          <TableCell padding="none" sx={{ width: '40px', minWidth: '40px', maxWidth: '40px', padding: '8px 4px' }} />
                          <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem', maxWidth: 280 }}>
                            {(() => {
                              const str = typeof title === 'string' ? title : String(title ?? '');
                              const display = str.length > 60 ? `${str.slice(0, 60)}…` : str || 'N/A';
                              return str.length > 60 ? <Tooltip title={str} placement="top"><span>{display}</span></Tooltip> : <span>{display}</span>;
                            })()}
                          </TableCell>
                          <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>{row.politician ?? 'N/A'}</TableCell>
                          <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                            {row.voteType ? (
                              <Chip
                                size="small"
                                label={row.voteType}
                                sx={{
                                  backgroundColor: row.voteType === 'Yea' ? 'rgba(34, 197, 94, 0.2)' : row.voteType === 'Nay' ? 'rgba(239, 68, 68, 0.2)' : row.voteType === 'Present' ? 'rgba(245, 158, 11, 0.2)' : row.voteType === 'Not Voting' ? 'rgba(100, 116, 139, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                                  color: row.voteType === 'Yea' ? '#86efac' : row.voteType === 'Nay' ? '#fca5a5' : row.voteType === 'Present' ? '#fcd34d' : row.voteType === 'Not Voting' ? '#94a3b8' : '#d1d5db',
                                  fontWeight: 600,
                                  fontSize: '0.75rem',
                                }}
                              />
                            ) : (
                              'N/A'
                            )}
                          </TableCell>
                          <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>{row.congress}</TableCell>
                        </TableRow>
                      );
                    })
                  : (currentPageResults as RollCallResultRow[]).map((row, index) => (
                      <TableRow
                        key={row.rowKey}
                        draggable
                        onDragStart={(e) => handleDragStart(e, row.rowKey)}
                        onClick={(e) => handleRowClick(e, row.rowKey, startIndex + index)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (user?.id || isDemo) openItemDetails('roll_call', row, row.roll_display ?? `Roll ${row.congress}-${row.session}-${row.roll}`, { user_id: user?.id, constrainToDemo: isDemo });
                        }}
                        onContextMenu={(e) => handleRowContextMenu(e, row.rowKey)}
                        sx={{
                          backgroundColor: selectedRollCalls.has(row.rowKey) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                          cursor: 'pointer',
                          userSelect: 'none',
                          '&:hover': { backgroundColor: selectedRollCalls.has(row.rowKey) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)' },
                        }}
                      >
                        <TableCell padding="none" sx={{ width: '40px', minWidth: '40px', maxWidth: '40px', padding: '8px 4px' }} />
                        {visibleColumns.includes('congress') && <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>{row.congress}</TableCell>}
                        {visibleColumns.includes('session') && <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>{row.session}</TableCell>}
                        {visibleColumns.includes('roll') && <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>{row.roll_display ?? row.roll}</TableCell>}
                        {visibleColumns.includes('associated_bill') && <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>{row.bill_id_associated ?? 'N/A'}</TableCell>}
                        {visibleColumns.includes('politician') && <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>{row.politician ?? 'N/A'}</TableCell>}
                        {visibleColumns.includes('vote') && (
                          <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                            {row.voteType ? (
                              <Chip
                                size="small"
                                label={row.voteType}
                                sx={{
                                  backgroundColor: row.voteType === 'Yea' ? 'rgba(34, 197, 94, 0.2)' : row.voteType === 'Nay' ? 'rgba(239, 68, 68, 0.2)' : row.voteType === 'Present' ? 'rgba(245, 158, 11, 0.2)' : row.voteType === 'Not Voting' ? 'rgba(100, 116, 139, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                                  color: row.voteType === 'Yea' ? '#86efac' : row.voteType === 'Nay' ? '#fca5a5' : row.voteType === 'Present' ? '#fcd34d' : row.voteType === 'Not Voting' ? '#94a3b8' : '#d1d5db',
                                  fontWeight: 600,
                                  fontSize: '0.75rem',
                                }}
                              />
                            ) : (
                              'N/A'
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.includes('bill') && (
                          <TableCell sx={{ color: '#ffffff', fontSize: '0.875rem' }}>
                            {row.bill_id ? (() => {
                              const detail = billDetails[row.bill_id];
                              const title = detail?.bill_title ?? row.bill_id;
                              const str = typeof title === 'string' ? title : String(title ?? '');
                              const display = str.length > 80 ? `${str.slice(0, 80)}…` : str || 'N/A';
                              const cell = <span>{display}</span>;
                              return str.length > 80 ? <Tooltip title={str} placement="top">{cell}</Tooltip> : cell;
                            })() : 'N/A'}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableContainer>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, flexShrink: 0 }}>
              <Pagination
                count={totalPages}
                page={displayPage}
                onChange={(_: React.ChangeEvent<unknown>, page: number) => setDisplayPage(page)}
                size="small"
                sx={{
                  '& .MuiPaginationItem-root': { color: '#9ca3af' },
                  '& .Mui-selected': { backgroundColor: '#3b82f6', color: 'white' },
                }}
              />
            </Box>
          )}
        </Box>
      )}

      {/* Empty state */}
      {allResults.length === 0 && !isLoading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, px: 3, flexShrink: 0, minHeight: '200px' }}>
          {(() => {
            const hasSearchCriteria = politicianNames.length > 0 || rollInput.trim() !== '';
            if (!hasPerformedInitialSearch && !hasSearchCriteria) {
              return (
                <>
                  <IconButton
                    onClick={() => setSearchDialogOpen(true)}
                    sx={{ color: '#3b82f6', mb: 2, '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)', transform: 'scale(1.1)' }, transition: 'all 0.2s ease' }}
                  >
                    <SearchIcon sx={{ fontSize: '4rem' }} />
                  </IconButton>
                  <Typography variant="h6" color="#3b82f6" sx={{ fontWeight: 600, mb: 1 }}>Start Your Search</Typography>
                  <Typography variant="body2" color="#9ca3af" sx={{ textAlign: 'center', maxWidth: '300px' }}>
                    Click the magnifying glass above to configure your search parameters
                  </Typography>
                </>
              );
            }
            return (
              <>
                <Typography variant="body2" color="#9ca3af" sx={{ mb: 2 }}>No results found</Typography>
                <Button variant="outlined" onClick={() => setSearchDialogOpen(true)} sx={{ borderColor: '#3b82f6', color: '#3b82f6' }}>Edit Search</Button>
              </>
            );
          })()}
        </Box>
      )}

      {/* Column Selection Menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={() => setColumnMenuAnchor(null)}
        PaperProps={{ sx: { backgroundColor: 'rgba(15, 23, 42, 0.98)', border: '2px solid #374151', color: '#ffffff' } }}
      >
        {AVAILABLE_COLUMNS.map((column) => {
          const labels: Record<string, string> = {
            congress: 'Congress',
            session: 'Session',
            roll: 'Roll',
            associated_bill: 'Associated Bill',
            politician: 'Politician',
            vote: 'Vote',
            bill: 'Bill',
          };
          return (
            <MenuItem
              key={column}
              onClick={() => handleColumnToggle(column)}
              sx={{ color: visibleColumns.includes(column) ? '#3b82f6' : '#94a3b8' }}
            >
              <Checkbox checked={visibleColumns.includes(column)} sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }} />
              {labels[column] || column.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Search Dialog */}
      <Dialog
        open={searchDialogOpen}
        onClose={() => setSearchDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { backgroundColor: '#1e293b', color: '#fff', border: '1px solid #334155' } }}
      >
        <DialogTitle>Search Roll Calls</DialogTitle>
        <DialogContent>
          <MultiSelectField<string>
            label="Politician (votes by member)"
            selectedItems={politicianNames}
            onItemsChange={setPoliticianNames}
            suggestions={politicianSuggestions}
            onSearch={(q) => (q.length >= 2 ? politicianSuggestions.filter((s) => s.toLowerCase().includes(q.toLowerCase())).slice(0, 20) : [])}
            renderItem={(x) => x}
            placeholder="Select politicians..."
            allowCustomInput={false}
            isLoading={!isPoliticianDataLoaded}
          />
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#94a3b8' }}>
            Or search by Congress / Roll (leave politicians empty):
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setCongressNum(119)}
              sx={{ borderColor: '#475569', color: '#e2e8f0' }}
            >
              Congress 119
            </Button>
            <input
              type="number"
              placeholder="Roll #"
              value={rollInput}
              onChange={(e) => setRollInput(e.target.value)}
              style={{
                width: 100,
                padding: '8px 12px',
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid #475569',
                borderRadius: 4,
                color: '#e2e8f0',
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155' }}>
          <Button onClick={() => setSearchDialogOpen(false)} sx={{ color: '#9ca3af' }}>Cancel</Button>
          <Button
            variant="contained"
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={16} /> : <SearchIcon />}
            onClick={() => {
              performSearch(true);
              setSearchDialogOpen(false);
            }}
            sx={{ backgroundColor: '#3b82f6', '&:hover': { backgroundColor: '#2563eb' } }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Filter Results Dialog — content reflects current view (Roll calls vs Bills) */}
      <Dialog
        open={filterDialogOpen}
        onClose={() => setFilterDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { backgroundColor: '#1e293b', color: '#ffffff', border: '1px solid #334155' },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #334155' }}>
          <Box display="flex" alignItems="center" gap={1}>
            <FilterIcon />
            <Typography variant="h6">
              Filter Results {isBillsView ? '(Bills view)' : '(Roll calls view)'}
            </Typography>
            <Chip
              label={`${displayRows.length} of ${isBillsView ? voteBillRows.length : allResults.length} results`}
              size="small"
              sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', border: '1px solid #3b82f6', ml: 1 }}
            />
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }} key={isBillsView ? 'bills' : 'rollcalls'}>
          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
            Refine results by: click a row to toggle. Counts shown in <span style={{ color: '#3b82f6' }}>#</span>
          </Typography>

          {isBillsView ? (
            /* Bills view filters */
            <>
              {(billSelectedFilters.congresses.size > 0 || billSelectedFilters.voteTypes.size > 0 || billSelectedFilters.politicians.size > 0 || billSelectedFilters.billTypes.size > 0 || billSelectedFilters.sponsorParties.size > 0) && (
                <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
                  <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>Applied filters:</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {Array.from(billSelectedFilters.congresses).map((c) => (
                      <Chip key={`rc-${c}`} label={`Congress: ${c}`} size="small" onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.congresses); n.delete(c); return { ...prev, congresses: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                    {Array.from(billSelectedFilters.voteTypes).map((v) => (
                      <Chip key={`rv-${v}`} label={`Vote: ${v}`} size="small" onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.voteTypes); n.delete(v); return { ...prev, voteTypes: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                    {Array.from(billSelectedFilters.politicians).map((p) => (
                      <Chip key={`rp-${p}`} label={`Politician: ${p}`} size="small" onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.politicians); n.delete(p); return { ...prev, politicians: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                    {Array.from(billSelectedFilters.billTypes).map((t) => (
                      <Chip key={`rt-${t}`} label={`Bill type: ${t}`} size="small" onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.billTypes); n.delete(t); return { ...prev, billTypes: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                    {Array.from(billSelectedFilters.sponsorParties).map((p) => (
                      <Chip key={`rsp-${p}`} label={`Sponsor party: ${p}`} size="small" onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.sponsorParties); n.delete(p); return { ...prev, sponsorParties: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                  </Box>
                </Box>
              )}
              <Box display="flex" flexDirection="column" gap={2} sx={{ '& .MuiAccordion-root': { backgroundColor: '#334155', border: '1px solid #475569', borderRadius: '4px', boxShadow: 'none', '&:before': { display: 'none' } }, '& .MuiAccordionSummary-root': { backgroundColor: '#475569', borderRadius: '4px 4px 0 0', minHeight: 48 }, '& .MuiAccordionDetails-root': { backgroundColor: '#334155', borderRadius: '0 0 4px 4px' } }}>
                {availableBillFilters.congresses.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Congress ({availableBillFilters.congresses.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableBillFilters.congresses.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: billSelectedFilters.congresses.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(billSelectedFilters.congresses); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setBillSelectedFilters((prev) => ({ ...prev, congresses: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>Congress {f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
                {availableBillFilters.voteTypes.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Vote type ({availableBillFilters.voteTypes.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableBillFilters.voteTypes.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: billSelectedFilters.voteTypes.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(billSelectedFilters.voteTypes); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setBillSelectedFilters((prev) => ({ ...prev, voteTypes: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
                {availableBillFilters.politicians.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Politician ({availableBillFilters.politicians.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableBillFilters.politicians.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: billSelectedFilters.politicians.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(billSelectedFilters.politicians); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setBillSelectedFilters((prev) => ({ ...prev, politicians: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
                {availableBillFilters.billTypes.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Bill type ({availableBillFilters.billTypes.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableBillFilters.billTypes.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: billSelectedFilters.billTypes.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(billSelectedFilters.billTypes); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setBillSelectedFilters((prev) => ({ ...prev, billTypes: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
                {availableBillFilters.sponsorParties.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Sponsor party ({availableBillFilters.sponsorParties.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableBillFilters.sponsorParties.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: billSelectedFilters.sponsorParties.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(billSelectedFilters.sponsorParties); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setBillSelectedFilters((prev) => ({ ...prev, sponsorParties: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
              </Box>
            </>
          ) : (
            /* Roll call view filters */
            <>
              {(rollCallSelectedFilters.congresses.size > 0 || rollCallSelectedFilters.sessions.size > 0 || rollCallSelectedFilters.voteTypes.size > 0 || rollCallSelectedFilters.politicians.size > 0) && (
                <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
                  <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>Applied filters:</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {Array.from(rollCallSelectedFilters.congresses).map((c) => (
                      <Chip key={`c-${c}`} label={`Congress: ${c}`} size="small" onDelete={() => setRollCallSelectedFilters((prev) => { const n = new Set(prev.congresses); n.delete(c); return { ...prev, congresses: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                    {Array.from(rollCallSelectedFilters.sessions).map((s) => (
                      <Chip key={`s-${s}`} label={`Session: ${s}`} size="small" onDelete={() => setRollCallSelectedFilters((prev) => { const n = new Set(prev.sessions); n.delete(s); return { ...prev, sessions: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                    {Array.from(rollCallSelectedFilters.voteTypes).map((v) => (
                      <Chip key={`v-${v}`} label={`Vote: ${v}`} size="small" onDelete={() => setRollCallSelectedFilters((prev) => { const n = new Set(prev.voteTypes); n.delete(v); return { ...prev, voteTypes: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                    {Array.from(rollCallSelectedFilters.politicians).map((p) => (
                      <Chip key={`p-${p}`} label={`Politician: ${p}`} size="small" onDelete={() => setRollCallSelectedFilters((prev) => { const n = new Set(prev.politicians); n.delete(p); return { ...prev, politicians: n }; })} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', '& .MuiChip-deleteIcon': { color: '#3b82f6' } }} />
                    ))}
                  </Box>
                </Box>
              )}
              <Box display="flex" flexDirection="column" gap={2} sx={{ '& .MuiAccordion-root': { backgroundColor: '#334155', border: '1px solid #475569', borderRadius: '4px', boxShadow: 'none', '&:before': { display: 'none' } }, '& .MuiAccordionSummary-root': { backgroundColor: '#475569', borderRadius: '4px 4px 0 0', minHeight: 48 }, '& .MuiAccordionDetails-root': { backgroundColor: '#334155', borderRadius: '0 0 4px 4px' } }}>
                {availableRollCallFilters.congresses.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Congress ({availableRollCallFilters.congresses.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableRollCallFilters.congresses.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: rollCallSelectedFilters.congresses.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(rollCallSelectedFilters.congresses); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setRollCallSelectedFilters((prev) => ({ ...prev, congresses: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>Congress {f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
                {availableRollCallFilters.sessions.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Session ({availableRollCallFilters.sessions.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableRollCallFilters.sessions.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: rollCallSelectedFilters.sessions.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(rollCallSelectedFilters.sessions); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setRollCallSelectedFilters((prev) => ({ ...prev, sessions: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>Session {f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
                {availableRollCallFilters.voteTypes.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Vote type ({availableRollCallFilters.voteTypes.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableRollCallFilters.voteTypes.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: rollCallSelectedFilters.voteTypes.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(rollCallSelectedFilters.voteTypes); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setRollCallSelectedFilters((prev) => ({ ...prev, voteTypes: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
                {availableRollCallFilters.politicians.length > 0 && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0' }}>Politician ({availableRollCallFilters.politicians.length})</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {availableRollCallFilters.politicians.map((f) => (
                          <Box key={f.value} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, cursor: 'pointer', borderRadius: '4px', backgroundColor: rollCallSelectedFilters.politicians.has(f.value) ? 'rgba(59, 130, 246, 0.15)' : 'transparent', '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' } }} onClick={() => { const n = new Set(rollCallSelectedFilters.politicians); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setRollCallSelectedFilters((prev) => ({ ...prev, politicians: n })); }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.value}</Typography>
                            <Chip label={f.count} size="small" sx={{ backgroundColor: '#3b82f6', color: '#fff', minWidth: 28, height: 22, fontSize: '0.75rem' }} />
                          </Box>
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #334155', p: 2 }}>
          <Button onClick={() => setFilterDialogOpen(false)} sx={{ color: '#9ca3af' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tile-level context menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={() => setContextMenuAnchor(null)}
        PaperProps={{ sx: { backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid #374151' } }}
      >
        <MenuItem
          onClick={() => { (isBillsView ? handleVoteBillAddToContext : handleAddToContext)(); setContextMenuAnchor(null); }}
          disabled={isBillsView ? selectedVoteBills.size === 0 : selectedRollCalls.size === 0}
          sx={{ color: '#fff' }}
        >
          <AddToContextIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context
        </MenuItem>
        <MenuItem
          onClick={() => { handleAddToFiles(); setContextMenuAnchor(null); }}
          disabled={(isBillsView ? selectedVoteBills.size === 0 : selectedRollCalls.size === 0) || !user}
          sx={{ color: '#fff' }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files
        </MenuItem>
      </Menu>

      {/* Row context menu */}
      <Menu
        open={contextMenuPosition !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={contextMenuPosition ? { top: contextMenuPosition.y, left: contextMenuPosition.x } : undefined}
        PaperProps={{ sx: { backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid #374151' } }}
      >
        <MenuItem
          onClick={() => { (isBillsView ? handleVoteBillAddToContext : handleAddToContext)(); handleContextMenuClose(); }}
          disabled={isBillsView ? selectedVoteBills.size === 0 : selectedRollCalls.size === 0}
          sx={{ color: '#fff' }}
        >
          <AddToContextIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add {isBillsView
            ? (selectedVoteBills.size > 1 ? `${selectedVoteBills.size} bills` : 'bill')
            : (selectedRollCalls.size > 1 ? `${selectedRollCalls.size} roll calls` : 'roll call')} to Context
        </MenuItem>
        <MenuItem
          onClick={() => { handleAddToFiles(); handleContextMenuClose(); }}
          disabled={(isBillsView ? selectedVoteBills.size === 0 : selectedRollCalls.size === 0) || !user}
          sx={{ color: '#fff' }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (isBillsView && selectedVoteBills.size === 1) {
              const billId = Array.from(selectedVoteBills)[0];
              const d = billDetails[billId];
              if (d) openItemDetails('congress_bill', d, d.bill_title ?? billId, { user_id: user?.id, constrainToDemo: isDemo });
            } else if (!isBillsView && selectedRollCalls.size === 1) {
              const r = allResults.find((x) => selectedRollCalls.has(x.rowKey));
              if (r) openItemDetails('roll_call', r, r.roll_display ?? `Roll ${r.congress}-${r.session}-${r.roll}`, { user_id: user?.id, constrainToDemo: isDemo });
            }
            handleContextMenuClose();
          }}
          disabled={(isBillsView ? selectedVoteBills.size : selectedRollCalls.size) !== 1}
          sx={{ color: '#fff' }}
        >
          <ViewDetailsIcon sx={{ mr: 1, fontSize: 18 }} />
          View details
        </MenuItem>
      </Menu>

      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
        title="Save roll calls to folder"
      />

      <TileCustomizationDialog
        open={customizeDialogOpen}
        onClose={() => setCustomizeDialogOpen(false)}
        onSave={(customizations) => onSettingsChange(id, customizations)}
        currentTitle={customTitle || 'Roll Call Search'}
        currentColor={customColor}
        currentIcon={customIcon}
      />
    </Box>
  );
};

const RollCallSearchTileMemo = memo(RollCallSearchTile);
RollCallSearchTileMemo.displayName = 'RollCallSearchTile';
export default RollCallSearchTileMemo;

