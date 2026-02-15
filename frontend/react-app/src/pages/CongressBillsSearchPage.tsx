import React, { useState, useEffect, useCallback } from 'react';
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
  Chip,
  Pagination,
  Tooltip,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  ViewColumn as ViewColumnIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import FileBrowserDialog from '../components/common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../hooks/useDialogManagerHelpers';
import { filesystemAPI } from '../services/api';
import { 
  congressBillsSearchAPI, 
  CongressBillsSearchFilters,
  CongressBill 
} from '../services/api';
import { politicianSuggestionsService } from '../services/politicianSuggestions';
import { policyAreaSuggestionsService } from '../services/policyAreaSuggestions';
import { useAuth } from '@/contexts/AuthContext';
import { useEasyMode } from '@/contexts/EasyModeContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import MultiSelectField from '../components/MultiSelectField';
import { addBillToContext, addMultipleBillsToContext, addRollCallToContext, addMultipleRollCallsToContext } from '../components/tiles/common/contextManager';
import { getSearchPageBatchSize } from './config/searchPageConfig';

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
        '&:hover': {
          background: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid #374151',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          transform: 'none',
          zIndex: 'auto',
        },
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

// Bill Type options (HR, S, HRES, etc.)
const BILL_TYPES = ['HR', 'S', 'HRES', 'SRES', 'HJRES', 'SJRES', 'HCONRES', 'SCONRES'];

// US States - removed unused constant

// Parties
const PARTIES = ['R', 'D', 'I'];

// Minimum date for introduced date (January 3, 2025)
const MIN_INTRODUCED_DATE = '2025-01-03';

// Bipartisan options
const BIPARTISAN_OPTIONS = [
  { value: 1, label: 'Bipartisan' },
  { value: 0, label: 'Not Bipartisan' }
];

const CongressBillsSearchPage: React.FC = () => {
  const { user } = useAuth();
  const { openItemDetails } = useDialogManagerHelpers();
  const {} = useGlobalChat();
  const { isEasyMode } = useEasyMode();

  // Session persistence: load once before any state that depends on it
  const SESSION_STORAGE_KEY = 'congress-bills-search-page-state';
  const loadStateFromStorage = () => {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (error) {
      console.error('❌ Error loading state from sessionStorage:', error);
    }
    return null;
  };
  const savedState = loadStateFromStorage();
  
  // Context menu state
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [fileBrowserFor, setFileBrowserFor] = useState<'bills' | 'vote_bills' | 'roll_calls' | null>(null);
  const [activeTab, setActiveTab] = useState<'bills' | 'rollcall'>(() => (savedState?.activeTab as 'bills' | 'rollcall') || 'bills');

  // Roll Call Search tab: congress '' | '119'; sessions subset of ['1','2']. Selecting 119th auto-selects both sessions.
  const [rollCallCongress, setRollCallCongress] = useState<string>('');
  const [rollCallCongressSectionExpanded, setRollCallCongressSectionExpanded] = useState<boolean>(true);
  const [rollCallRoll, setRollCallRoll] = useState('');
  const [rollCallPoliticianName, setRollCallPoliticianName] = useState<string[]>([]);
  const [rollCallSearchSidebarVisible, setRollCallSearchSidebarVisible] = useState<boolean>(true);
  const [rollCallSearchMessage, setRollCallSearchMessage] = useState<string | null>(null);
  const [rollCallResults, setRollCallResults] = useState<any[]>([]);
  const [rollCallLoading, setRollCallLoading] = useState<boolean>(false);
  const [rollCallError, setRollCallError] = useState<string | null>(null);
  const [rollCallHasMore, setRollCallHasMore] = useState<boolean>(false);
  const [rollCallLastKey, setRollCallLastKey] = useState<any>(null);
  const [rollCallSearchIndex, setRollCallSearchIndex] = useState<string | null>(null);
  /** Bill details from roll call search (same projection as main bill search for Refine + table) */
  const [rollCallBillDetails, setRollCallBillDetails] = useState<Record<string, CongressBill>>({});
  /** Roll key (congress#session#roll) -> update date; from SEARCH#VOTE response for table */
  const [rollCallRollDates, setRollCallRollDates] = useState<Record<string, string>>({});
  const [rollCallResultView, setRollCallResultView] = useState<'rollcalls' | 'bills'>('rollcalls');
  // Roll call table: flattened rows and client-side filters (voteType for SEARCH#VOTE: Yea/Nay/Abstained)
  type RollCallTableRow = { politician?: string; congress: number; session: number; roll: number; roll_display?: string; bill_id?: string; bill_id_associated?: string; bill_title?: string; voteType?: 'Yea' | 'Nay' | 'Abstained'; latest_action_date?: string; rowKey: string; search_index_sk?: string };
  const rollCallFlattenedRows = React.useMemo((): RollCallTableRow[] => {
    if (!rollCallResults.length) return [];
    if (rollCallSearchIndex === 'SEARCH#VOTE') {
      const rows: RollCallTableRow[] = [];
      const parseRollKey = (key: string) => {
        const parts = String(key).split('#');
        return {
          congress: parts[0] != null ? parseInt(parts[0], 10) : NaN,
          session: parts[1] != null ? parseInt(parts[1], 10) : NaN,
          roll: parts[2] != null ? parseInt(parts[2], 10) : NaN,
        };
      };
      rollCallResults.forEach((r: any, idx) => {
        const displayName = r.display_name || r.search_value || '';
        const pushRows = (rollArr: string[], voteType: 'Yea' | 'Nay' | 'Abstained', billArr?: string[]) => {
          (rollArr || []).forEach((key: string, i: number) => {
            const { congress, session, roll } = parseRollKey(key);
            if (!isNaN(congress) && !isNaN(session) && !isNaN(roll)) {
              const billId = Array.isArray(billArr) && billArr[i] ? billArr[i] : undefined;
              const rollKey = `${congress}#${session}#${roll}`;
              rows.push({
                politician: displayName,
                congress,
                session,
                roll,
                roll_display: `Roll no. ${roll}`,
                voteType,
                bill_id: billId,
                latest_action_date: rollCallRollDates[rollKey] ?? '',
                rowKey: `vote-${idx}-${voteType}-${key}-${i}`,
              });
            }
          });
        };
        pushRows(Array.isArray(r.roll_yea) ? r.roll_yea : [], 'Yea', Array.isArray(r.bill_yea) ? r.bill_yea : undefined);
        pushRows(Array.isArray(r.roll_nea) ? r.roll_nea : [], 'Nay', Array.isArray(r.bill_nea) ? r.bill_nea : undefined);
        pushRows(Array.isArray(r.roll_abstained) ? r.roll_abstained : [], 'Abstained', Array.isArray(r.bill_abstained) ? r.bill_abstained : undefined);
      });
      if (rows.length === 0) {
        rollCallResults.forEach((r: any, idx: number) => {
          const displayName = r.display_name || r.search_value || '';
          const rollNea = Array.isArray(r.roll_nea) ? r.roll_nea : [];
          rollNea.forEach((key: string, i: number) => {
            const parts = String(key).split('#');
            const congress = parts[0] != null ? parseInt(parts[0], 10) : NaN;
            const session = parts[1] != null ? parseInt(parts[1], 10) : NaN;
            const roll = parts[2] != null ? parseInt(parts[2], 10) : NaN;
            if (!isNaN(congress) && !isNaN(session) && !isNaN(roll)) {
              const rollKey = `${congress}#${session}#${roll}`;
              rows.push({
                politician: displayName,
                congress,
                session,
                roll,
                roll_display: `Roll no. ${roll}`,
                voteType: 'Nay' as const,
                latest_action_date: rollCallRollDates[rollKey] ?? '',
                rowKey: `vote-legacy-${r.bill_id || idx}-${i}-${key}`,
              });
            }
          });
        });
      }
      return rows;
    }
    if (rollCallSearchIndex === 'SEARCH#ROLL') {
      return rollCallResults.map((r: any, idx: number) => {
        const c = r.congress ?? r.search_index_sk?.split?.('#')?.[0];
        const s = r.session ?? r.search_index_sk?.split?.('#')?.[1];
        const rollNum = r.roll ?? r.search_index_sk?.split?.('#')?.[2];
        const sk = r.search_index_sk ?? undefined;
        return {
          congress: c != null ? Number(c) : 0,
          session: s != null ? Number(s) : 0,
          roll: rollNum != null ? Number(rollNum) : 0,
          roll_display: r.roll_display ?? `Roll no. ${rollNum}`,
          bill_id_associated: r.bill_id_associated,
          bill_title: r.bill_associated?.bill_title,
          latest_action_date: r.latest_action_date ?? r.project_update_date ?? '',
          rowKey: sk ?? `roll-${idx}`,
          search_index_sk: sk,
        };
      });
    }
    return [];
  }, [rollCallResults, rollCallSearchIndex, rollCallRollDates]);

  // Bills from SEARCH#VOTE: one row per bill with voteType (for "Bills" sub-tab)
  type VoteBillRow = { bill_id: string; politician?: string; voteType: 'Yea' | 'Nay' | 'Abstained'; congress: number; rowKey: string };
  const voteBillFlattenedRows = React.useMemo((): VoteBillRow[] => {
    if (!rollCallResults.length || rollCallSearchIndex !== 'SEARCH#VOTE') return [];
    const rows: VoteBillRow[] = [];
    const seen = new Set<string>();
    rollCallResults.forEach((r: any, idx: number) => {
      const displayName = r.display_name || r.search_value || '';
      const push = (billArr: string[], voteType: 'Yea' | 'Nay' | 'Abstained') => {
        (billArr || []).forEach((billId: string, i: number) => {
          if (!billId || seen.has(billId)) return;
          seen.add(billId);
          const congress = parseInt(String(billId).split('-')[0], 10) || 0;
          rows.push({
            bill_id: billId,
            politician: displayName,
            voteType,
            congress: isNaN(congress) ? 0 : congress,
            rowKey: `bill-${idx}-${voteType}-${billId}-${i}`,
          });
        });
      };
      push(Array.isArray(r.bill_yea) ? r.bill_yea : [], 'Yea');
      push(Array.isArray(r.bill_nea) ? r.bill_nea : [], 'Nay');
      push(Array.isArray(r.bill_abstained) ? r.bill_abstained : [], 'Abstained');
    });
    return rows;
  }, [rollCallResults, rollCallSearchIndex]);

  const [billSelectedFilters, setBillSelectedFilters] = useState<{
    congresses: Set<number>;
    voteTypes: Set<'Yea' | 'Nay' | 'Abstained'>;
    bill_types: Set<string>;
    sponsor_parties: Set<string>;
    sponsor_states: Set<string>;
    policy_areas: Set<string>;
    bipartisan: Set<number>;
  }>({
    congresses: new Set(),
    voteTypes: new Set(),
    bill_types: new Set(),
    sponsor_parties: new Set(),
    sponsor_states: new Set(),
    policy_areas: new Set(),
    bipartisan: new Set(),
  });
  const [billExpandedFilters, setBillExpandedFilters] = useState<{
    congresses: boolean;
    voteTypes: boolean;
    billTypes: boolean;
    sponsorParties: boolean;
    sponsorStates: boolean;
    policyAreas: boolean;
    bipartisan: boolean;
  }>({ congresses: false, voteTypes: false, billTypes: false, sponsorParties: false, sponsorStates: false, policyAreas: false, bipartisan: false });

  const billAvailableFilters = React.useMemo(() => {
    const congressMap = new Map<number, number>();
    const voteTypeMap = new Map<string, number>();
    const billTypeMap = new Map<string, number>();
    const sponsorPartyMap = new Map<string, number>();
    const sponsorStateMap = new Map<string, number>();
    const policyAreaMap = new Map<string, number>();
    const bipartisanMap = new Map<number, number>();
    voteBillFlattenedRows.forEach((row) => {
      congressMap.set(row.congress, (congressMap.get(row.congress) || 0) + 1);
      if (row.voteType) voteTypeMap.set(row.voteType, (voteTypeMap.get(row.voteType) || 0) + 1);
      const d = rollCallBillDetails[row.bill_id];
      if (d?.bill_type) billTypeMap.set(d.bill_type, (billTypeMap.get(d.bill_type) || 0) + 1);
      if (d?.sponsor_party) sponsorPartyMap.set(d.sponsor_party, (sponsorPartyMap.get(d.sponsor_party) || 0) + 1);
      if (d?.sponsor_state) sponsorStateMap.set(d.sponsor_state, (sponsorStateMap.get(d.sponsor_state) || 0) + 1);
      if (d?.policy_area) policyAreaMap.set(d.policy_area, (policyAreaMap.get(d.policy_area) || 0) + 1);
      if (d?.bipartisan !== undefined && d?.bipartisan !== null) bipartisanMap.set(d.bipartisan, (bipartisanMap.get(d.bipartisan) || 0) + 1);
    });
    return {
      congress_filters: Array.from(congressMap.entries()).map(([c, count]) => ({ congress: c, count })).sort((a, b) => b.congress - a.congress),
      vote_type_filters: Array.from(voteTypeMap.entries()).map(([voteType, count]) => ({ voteType: voteType as 'Yea' | 'Nay' | 'Abstained', count })).sort((a, b) => a.voteType.localeCompare(b.voteType)),
      bill_type_filters: Array.from(billTypeMap.entries()).map(([billType, count]) => ({ billType, count })).sort((a, b) => (a.billType || '').localeCompare(b.billType || '')),
      sponsor_party_filters: Array.from(sponsorPartyMap.entries()).map(([party, count]) => ({ party, count })).sort((a, b) => (a.party || '').localeCompare(b.party || '')),
      sponsor_state_filters: Array.from(sponsorStateMap.entries()).map(([state, count]) => ({ state, count })).sort((a, b) => (a.state || '').localeCompare(b.state || '')),
      policy_area_filters: Array.from(policyAreaMap.entries()).map(([area, count]) => ({ area, count })).sort((a, b) => (a.area || '').localeCompare(b.area || '')),
      bipartisan_filters: Array.from(bipartisanMap.entries()).map(([bipartisan, count]) => ({ bipartisan, count })).sort((a, b) => a.bipartisan - b.bipartisan),
    };
  }, [voteBillFlattenedRows, rollCallBillDetails]);

  const voteBillFilteredRows = React.useMemo(() => {
    let rows = [...voteBillFlattenedRows];
    if (billSelectedFilters.congresses.size > 0) {
      rows = rows.filter((r) => billSelectedFilters.congresses.has(r.congress));
    }
    if (billSelectedFilters.voteTypes.size > 0) {
      rows = rows.filter((r) => r.voteType && billSelectedFilters.voteTypes.has(r.voteType));
    }
    if (billSelectedFilters.bill_types.size > 0) {
      rows = rows.filter((r) => {
        const d = rollCallBillDetails[r.bill_id];
        return d?.bill_type && billSelectedFilters.bill_types.has(d.bill_type);
      });
    }
    if (billSelectedFilters.sponsor_parties.size > 0) {
      rows = rows.filter((r) => {
        const d = rollCallBillDetails[r.bill_id];
        return d?.sponsor_party && billSelectedFilters.sponsor_parties.has(d.sponsor_party);
      });
    }
    if (billSelectedFilters.sponsor_states.size > 0) {
      rows = rows.filter((r) => {
        const d = rollCallBillDetails[r.bill_id];
        return d?.sponsor_state && billSelectedFilters.sponsor_states.has(d.sponsor_state);
      });
    }
    if (billSelectedFilters.policy_areas.size > 0) {
      rows = rows.filter((r) => {
        const d = rollCallBillDetails[r.bill_id];
        return d?.policy_area && billSelectedFilters.policy_areas.has(d.policy_area);
      });
    }
    if (billSelectedFilters.bipartisan.size > 0) {
      rows = rows.filter((r) => {
        const d = rollCallBillDetails[r.bill_id];
        return d?.bipartisan !== undefined && d?.bipartisan !== null && billSelectedFilters.bipartisan.has(d.bipartisan);
      });
    }
    return rows;
  }, [voteBillFlattenedRows, billSelectedFilters, rollCallBillDetails]);

  const AVAILABLE_VOTE_BILL_COLUMNS = [
    'bill_title', 'bill_type', 'bill_number', 'sponsor_name', 'sponsor_party', 'sponsor_state',
    'introduced_date', 'latest_action_date', 'congress', 'bipartisan', 'policy_area',
    'bill_id', 'vote', 'latest_action',
  ] as const;
  const DEFAULT_VOTE_BILL_COLUMNS = ['bill_title', 'bill_type', 'congress', 'bill_id', 'vote', 'latest_action'];
  const [visibleVoteBillColumns, setVisibleVoteBillColumns] = useState<string[]>(DEFAULT_VOTE_BILL_COLUMNS);
  const [voteBillColumnMenuAnchor, setVoteBillColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const voteBillColumnMenuOpen = Boolean(voteBillColumnMenuAnchor);
  const [selectedVoteBills, setSelectedVoteBills] = useState<Set<string>>(new Set());
  const [lastSelectedVoteBillIndex, setLastSelectedVoteBillIndex] = useState<number | null>(null);
  const [voteBillContextMenuPosition, setVoteBillContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [voteBillPageSize, setVoteBillPageSize] = useState(25);
  const [voteBillCurrentPage, setVoteBillCurrentPage] = useState(1);

  const voteBillTotalPages = Math.max(1, Math.ceil(voteBillFilteredRows.length / voteBillPageSize));
  const voteBillStartIndex = (voteBillCurrentPage - 1) * voteBillPageSize;
  const voteBillEndIndex = Math.min(voteBillStartIndex + voteBillPageSize, voteBillFilteredRows.length);
  const voteBillPaginatedRows = React.useMemo(() => {
    return voteBillFilteredRows.slice(voteBillStartIndex, voteBillEndIndex);
  }, [voteBillFilteredRows, voteBillStartIndex, voteBillEndIndex]);

  const handleVoteBillClick = (e: React.MouseEvent, billId: string, index: number) => {
    e.stopPropagation();
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    setSelectedVoteBills((prev) => {
      const newSelected = new Set(prev);
      if (isShiftClick && lastSelectedVoteBillIndex !== null) {
        const start = Math.min(lastSelectedVoteBillIndex, index);
        const end = Math.max(lastSelectedVoteBillIndex, index);
        const rows = voteBillFilteredRows.slice(start, end + 1);
        rows.forEach((r) => newSelected.add(r.bill_id));
      } else if (isCtrlClick) {
        if (newSelected.has(billId)) newSelected.delete(billId);
        else newSelected.add(billId);
        setLastSelectedVoteBillIndex(index);
      } else {
        if (newSelected.has(billId)) newSelected.delete(billId);
        else { newSelected.clear(); newSelected.add(billId); }
        setLastSelectedVoteBillIndex(index);
      }
      return newSelected;
    });
  };

  const handleVoteBillDragStart = (e: React.DragEvent, billId: string) => {
    e.stopPropagation();
    const toDrag = selectedVoteBills.has(billId) ? selectedVoteBills : new Set([billId]);
    const rows = voteBillFilteredRows.filter((r) => toDrag.has(r.bill_id));
    const bills = rows.map((r) => {
      const d = rollCallBillDetails[r.bill_id];
      return {
        bill_id: r.bill_id,
        bill_title: d?.bill_title,
        congress: r.congress,
        latest_action_text: d?.latest_action_text,
        latest_action_date: d?.latest_action_date,
      };
    });
    if (bills.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'congress_bills', bills }));
      const dragImage = document.createElement('div');
      dragImage.textContent = `${bills.length} bill${bills.length !== 1 ? 's' : ''}`;
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.padding = '8px 12px';
      dragImage.style.backgroundColor = '#3b82f6';
      dragImage.style.color = '#ffffff';
      dragImage.style.borderRadius = '4px';
      dragImage.style.fontSize = '14px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  };

  const handleVoteBillRowContextMenu = (e: React.MouseEvent, billId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedVoteBills.has(billId)) setSelectedVoteBills(new Set([billId]));
    setVoteBillContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleVoteBillContextMenuClose = () => {
    setVoteBillContextMenuPosition(null);
  };

  const handleVoteBillAddToContext = () => {
    const rows = voteBillFilteredRows.filter((r) => selectedVoteBills.has(r.bill_id));
    // Use full bill data from rollCallBillDetails (same shape as bill search) so context shows "HR 7147" + subtitle
    const bills = rows.map((r) => {
      const detail = rollCallBillDetails[r.bill_id];
      if (detail && typeof detail === 'object') {
        return { ...detail, bill_id: detail.bill_id || r.bill_id };
      }
      const d = detail as CongressBill | undefined;
      return {
        bill_id: r.bill_id,
        bill_title: d?.bill_title,
        congress: r.congress,
        latest_action_text: d?.latest_action_text,
        latest_action_date: d?.latest_action_date,
      };
    });
    if (bills.length === 0) return;
    if (bills.length === 1) addBillToContext(bills[0]);
    else addMultipleBillsToContext(bills);
    setSelectedVoteBills(new Set());
    handleVoteBillContextMenuClose();
  };

  const handleVoteBillAddToFiles = () => {
    if (selectedVoteBills.size === 0 || !user) return;
    setFileBrowserFor('vote_bills');
    setFileBrowserOpen(true);
    handleVoteBillContextMenuClose();
  };

  const handleVoteBillFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedVoteBills.size === 0) return;
    const rows = voteBillFilteredRows.filter((r) => selectedVoteBills.has(r.bill_id));
    // Use full bill data and same title/subtitle mechanics as bill search page (HR 7147 + sponsor • party • policy_area • Introduced)
    const items = rows.map((r) => {
      const detail = rollCallBillDetails[r.bill_id];
      const bill =
        detail && typeof detail === 'object'
          ? { ...detail, bill_id: detail.bill_id || r.bill_id }
          : (() => {
              const d = detail as CongressBill | undefined;
              return {
                bill_id: r.bill_id,
                bill_title: d?.bill_title,
                congress: r.congress,
                latest_action_text: d?.latest_action_text,
                latest_action_date: d?.latest_action_date,
              };
            })();
      const title =
        detail?.bill_type != null || detail?.bill_number != null
          ? `${detail?.bill_type || 'Bill'} ${detail?.bill_number ?? ''}`.trim() || (detail?.bill_title || r.bill_id)
          : (detail?.bill_title || r.bill_id).trim() || r.bill_id;
      return { context_data: bill, title, item_type: 'congress_bill' as const };
    });
    try {
      const response = await filesystemAPI.addBulkContextItems({ user_id: user.id, folder_path: folderPath, items });
      if (response.success) setSelectedVoteBills(new Set());
    } catch (err) {
      console.error(err);
    }
    setFileBrowserOpen(false);
    setFileBrowserFor(null);
  };

  const [rollCallSelectedFilters, setRollCallSelectedFilters] = useState<{
    congresses: Set<number>; sessions: Set<number>; politicians: Set<string>; voteTypes: Set<'Yea' | 'Nay' | 'Abstained'>;
  }>({ congresses: new Set(), sessions: new Set(), politicians: new Set(), voteTypes: new Set() });
  const [rollCallExpandedFilters, setRollCallExpandedFilters] = useState<{
    congresses: boolean; sessions: boolean; politicians: boolean; voteTypes: boolean;
  }>({ congresses: false, sessions: false, politicians: false, voteTypes: false });

  const rollCallAvailableFilters = React.useMemo(() => {
    const congressMap = new Map<number, number>();
    const sessionMap = new Map<number, number>();
    const politicianMap = new Map<string, number>();
    const voteTypeMap = new Map<string, number>();
    rollCallFlattenedRows.forEach((row) => {
      congressMap.set(row.congress, (congressMap.get(row.congress) || 0) + 1);
      sessionMap.set(row.session, (sessionMap.get(row.session) || 0) + 1);
      if (row.politician) politicianMap.set(row.politician, (politicianMap.get(row.politician) || 0) + 1);
      if (row.voteType) voteTypeMap.set(row.voteType, (voteTypeMap.get(row.voteType) || 0) + 1);
    });
    return {
      congress_filters: Array.from(congressMap.entries()).map(([c, count]) => ({ congress: c, count })).sort((a, b) => b.congress - a.congress),
      session_filters: Array.from(sessionMap.entries()).map(([s, count]) => ({ session: s, count })).sort((a, b) => a.session - b.session),
      politician_filters: Array.from(politicianMap.entries()).map(([p, count]) => ({ politician: p, count })).sort((a, b) => b.count - a.count),
      vote_type_filters: Array.from(voteTypeMap.entries()).map(([voteType, count]) => ({ voteType: voteType as 'Yea' | 'Nay' | 'Abstained', count })).sort((a, b) => a.voteType.localeCompare(b.voteType)),
    };
  }, [rollCallFlattenedRows]);

  const rollCallFilteredRows = React.useMemo(() => {
    let rows = [...rollCallFlattenedRows];
    if (rollCallSelectedFilters.congresses.size > 0) {
      rows = rows.filter((r) => rollCallSelectedFilters.congresses.has(r.congress));
    }
    if (rollCallSelectedFilters.sessions.size > 0) {
      rows = rows.filter((r) => rollCallSelectedFilters.sessions.has(r.session));
    }
    if (rollCallSelectedFilters.politicians.size > 0) {
      rows = rows.filter((r) => r.politician && rollCallSelectedFilters.politicians.has(r.politician));
    }
    if (rollCallSelectedFilters.voteTypes.size > 0) {
      rows = rows.filter((r) => r.voteType && rollCallSelectedFilters.voteTypes.has(r.voteType));
    }
    return rows;
  }, [rollCallFlattenedRows, rollCallSelectedFilters]);

  const getRollCallColumnsForIndex = () =>
    rollCallSearchIndex === 'SEARCH#VOTE'
      ? ['politician', 'congress', 'session', 'roll', 'vote', 'bill', 'latest_action_date']
      : ['congress', 'session', 'roll', 'associated_bill'];
  const [visibleRollCallColumns, setVisibleRollCallColumns] = useState<string[]>(['congress', 'session', 'roll', 'associated_bill']);
  React.useEffect(() => {
    setVisibleRollCallColumns((prev) => {
      const forIndex = getRollCallColumnsForIndex();
      const valid = prev.filter((c) => forIndex.includes(c));
      return valid.length === prev.length ? prev : forIndex;
    });
  }, [rollCallSearchIndex]);
  const [rollCallColumnMenuAnchor, setRollCallColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const rollCallColumnMenuOpen = Boolean(rollCallColumnMenuAnchor);
  const [selectedRollCalls, setSelectedRollCalls] = useState<Set<string>>(new Set());
  const [lastSelectedRollCallIndex, setLastSelectedRollCallIndex] = useState<number | null>(null);
  const [rollCallContextMenuPosition, setRollCallContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [rollCallPageSize, setRollCallPageSize] = useState(25);
  const [rollCallCurrentPage, setRollCallCurrentPage] = useState(1);

  const rollCallTotalPages = Math.max(1, Math.ceil(rollCallFilteredRows.length / rollCallPageSize));
  const rollCallStartIndex = (rollCallCurrentPage - 1) * rollCallPageSize;
  const rollCallEndIndex = Math.min(rollCallStartIndex + rollCallPageSize, rollCallFilteredRows.length);
  const rollCallPaginatedRows = React.useMemo(
    () => rollCallFilteredRows.slice(rollCallStartIndex, rollCallEndIndex),
    [rollCallFilteredRows, rollCallStartIndex, rollCallEndIndex]
  );

  const handleRollCallClick = (e: React.MouseEvent, rowKey: string, index: number) => {
    e.stopPropagation();
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    setSelectedRollCalls((prev) => {
      const next = new Set(prev);
      if (isShift && lastSelectedRollCallIndex !== null) {
        const start = Math.min(lastSelectedRollCallIndex, index);
        const end = Math.max(lastSelectedRollCallIndex, index);
        rollCallFilteredRows.slice(start, end + 1).forEach((r) => next.add(r.rowKey));
      } else if (isCtrl) {
        if (next.has(rowKey)) next.delete(rowKey);
        else next.add(rowKey);
        setLastSelectedRollCallIndex(index);
      } else {
        if (next.has(rowKey)) next.delete(rowKey);
        else { next.clear(); next.add(rowKey); }
        setLastSelectedRollCallIndex(index);
      }
      return next;
    });
  };

  const handleRollCallDragStart = (e: React.DragEvent, rowKey: string) => {
    e.stopPropagation();
    const toDrag = selectedRollCalls.has(rowKey) ? selectedRollCalls : new Set([rowKey]);
    const rows = rollCallFilteredRows.filter((r) => toDrag.has(r.rowKey));
    const rollCalls = rows.map((r) => ({ congress: r.congress, session: r.session, roll: r.roll, roll_display: r.roll_display }));
    if (rollCalls.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'roll_calls', rollCalls }));
      const dragImage = document.createElement('div');
      dragImage.textContent = `${rollCalls.length} roll call${rollCalls.length !== 1 ? 's' : ''}`;
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.padding = '8px 12px';
      dragImage.style.backgroundColor = '#3b82f6';
      dragImage.style.color = '#ffffff';
      dragImage.style.borderRadius = '4px';
      dragImage.style.fontSize = '14px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  };

  const handleRollCallRowContextMenu = (e: React.MouseEvent, rowKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedRollCalls.has(rowKey)) setSelectedRollCalls(new Set([rowKey]));
    setRollCallContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleRollCallContextMenuClose = () => setRollCallContextMenuPosition(null);

  const handleRollCallAddToContext = () => {
    const rows = rollCallFilteredRows.filter((r) => selectedRollCalls.has(r.rowKey));
    const rollCalls = rows.map((r) => ({
      congress: r.congress,
      session: r.session,
      roll: r.roll,
      roll_display: r.roll_display,
      bill_id_associated: r.bill_id_associated,
      search_index_sk: r.search_index_sk,
    }));
    if (rollCalls.length === 0) return;
    if (rollCalls.length === 1) addRollCallToContext(rollCalls[0], rollCalls[0].roll_display);
    else addMultipleRollCallsToContext(rollCalls);
    setSelectedRollCalls(new Set());
    handleRollCallContextMenuClose();
  };

  const handleRollCallAddToFiles = () => {
    if (selectedRollCalls.size === 0 || !user) return;
    setFileBrowserFor('roll_calls');
    setFileBrowserOpen(true);
    handleRollCallContextMenuClose();
  };

  const handleRollCallFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedRollCalls.size === 0) return;
    const rows = rollCallFilteredRows.filter((r) => selectedRollCalls.has(r.rowKey));
    const items = rows.map((r) => ({
      context_data: {
        congress: r.congress,
        session: r.session,
        roll: r.roll,
        ...(r.roll_display != null && { roll_display: r.roll_display }),
        ...(r.bill_id_associated != null && { bill_id_associated: r.bill_id_associated }),
        ...(r.search_index_sk != null && { search_index_sk: r.search_index_sk }),
      },
      title: r.roll_display || `Roll Call ${r.congress}-${r.session}-${r.roll}`,
      item_type: 'roll_call' as const,
    }));
    try {
      await filesystemAPI.addBulkContextItems({ user_id: user.id, folder_path: folderPath, items });
      setSelectedRollCalls(new Set());
    } catch (err) {
      console.error(err);
    }
    setFileBrowserOpen(false);
    setFileBrowserFor(null);
  };
  
  // Search state
  const [searchParams, setSearchParams] = useState<CongressBillsSearchFilters>(() => {
    const saved = savedState?.searchParams;
    // Support both old sponsor_name and new politician_name for backward compatibility
    const politicianNames = saved?.politician_name || saved?.sponsor_name || [];
    return {
      bill_title: Array.isArray(saved?.bill_title) ? saved.bill_title : [],
      bill_type: Array.isArray(saved?.bill_type) ? saved.bill_type : [],
      politician_name: Array.isArray(politicianNames) ? politicianNames : [],
      politician_role: saved?.politician_role ? (Array.isArray(saved.politician_role) ? saved.politician_role.filter((r: string) => r !== 'both' && (r === 'sponsor' || r === 'cosponsor')) : (saved.politician_role !== 'both' && (saved.politician_role === 'sponsor' || saved.politician_role === 'cosponsor') ? [saved.politician_role] : [])) : [],
      introduced_date_from: saved?.introduced_date_from || '',
      introduced_date_to: saved?.introduced_date_to || '',
      congress: Array.isArray(saved?.congress) ? saved.congress : [],
      policy_area: Array.isArray(saved?.policy_area) ? saved.policy_area : [],
      sponsor_party: Array.isArray(saved?.sponsor_party) ? saved.sponsor_party : [],
      sponsor_state: Array.isArray(saved?.sponsor_state) ? saved.sponsor_state : [],
      latest_action_date_from: saved?.latest_action_date_from || '',
      latest_action_date_to: saved?.latest_action_date_to || '',
      bipartisan: saved?.bipartisan,
      bill_number: saved?.bill_number,
      has_roll_call: saved?.has_roll_call,
    };
  });
  
  const [allSearchResults, setAllSearchResults] = useState<CongressBill[]>(
    savedState?.allSearchResults || []
  );
  const [currentResults, setCurrentResults] = useState<CongressBill[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<any>(savedState?.lastEvaluatedKey || null);
  const [hasMore, setHasMore] = useState<boolean>(savedState?.hasMore || false);
  const [selectedBills, setSelectedBills] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // Client-side filter state
  const [selectedFilters, setSelectedFilters] = useState<{
    bill_types: Set<string>;
    sponsor_parties: Set<string>;
    sponsor_states: Set<string>;
    policy_areas: Set<string>;
    congresses: Set<number>;
    bipartisan: Set<number>;
    politician_roles: Set<string>; // 'sponsor', 'cosponsor', 'both'
  }>(() => {
    const saved = savedState?.selectedFilters;
    if (saved) {
      return {
        bill_types: new Set(saved.bill_types || []),
        sponsor_parties: new Set(saved.sponsor_parties || []),
        sponsor_states: new Set(saved.sponsor_states || []),
        policy_areas: new Set(saved.policy_areas || []),
        congresses: new Set(saved.congresses || []),
        bipartisan: new Set(saved.bipartisan || []),
        politician_roles: new Set(saved.politician_roles || []),
      };
    }
    return {
      bill_types: new Set(),
      sponsor_parties: new Set(),
      sponsor_states: new Set(),
      policy_areas: new Set(),
      congresses: new Set(),
      bipartisan: new Set(),
      politician_roles: new Set(),
    };
  });

  const [availableFilters, setAvailableFilters] = useState<{
    bill_type_filters: Array<{ billType: string; count: number }>;
    sponsor_party_filters: Array<{ party: string; count: number }>;
    sponsor_state_filters: Array<{ state: string; count: number }>;
    policy_area_filters: Array<{ area: string; count: number }>;
    congress_filters: Array<{ congress: number; count: number }>;
    bipartisan_filters: Array<{ bipartisan: number; count: number }>;
  }>(savedState?.availableFilters || {
    bill_type_filters: [],
    sponsor_party_filters: [],
    sponsor_state_filters: [],
    policy_area_filters: [],
    congress_filters: [],
    bipartisan_filters: [],
  });

  const [expandedFilters, setExpandedFilters] = useState<{
    billTypes: boolean;
    sponsorParties: boolean;
    sponsorStates: boolean;
    policyAreas: boolean;
    congresses: boolean;
    bipartisan: boolean;
  }>(savedState?.expandedFilters || {
    billTypes: false,
    sponsorParties: false,
    sponsorStates: false,
    policyAreas: false,
    congresses: false,
    bipartisan: false,
  });

  const [isFiltered, setIsFiltered] = useState<boolean>(() => {
    const saved = savedState?.selectedFilters;
    if (saved) {
      return (
        (saved.bill_types && saved.bill_types.length > 0) ||
        (saved.sponsor_parties && saved.sponsor_parties.length > 0) ||
        (saved.policy_areas && saved.policy_areas.length > 0) ||
        (saved.congresses && saved.congresses.length > 0) ||
        (saved.bipartisan && saved.bipartisan.length > 0)
      );
    }
    return false;
  });

  // Compute available filters from results
  const computeFiltersFromResults = useCallback((results: CongressBill[]) => {
    const billTypeMap = new Map<string, number>();
    const sponsorPartyMap = new Map<string, number>();
    const sponsorStateMap = new Map<string, number>();
    const policyAreaMap = new Map<string, number>();
    const congressMap = new Map<number, number>();
    const bipartisanMap = new Map<number, number>();

    results.forEach((bill) => {
      if (bill.bill_type) {
        billTypeMap.set(bill.bill_type, (billTypeMap.get(bill.bill_type) || 0) + 1);
      }
      if (bill.sponsor_party) {
        sponsorPartyMap.set(bill.sponsor_party, (sponsorPartyMap.get(bill.sponsor_party) || 0) + 1);
      }
      if (bill.sponsor_state) {
        sponsorStateMap.set(bill.sponsor_state, (sponsorStateMap.get(bill.sponsor_state) || 0) + 1);
      }
      if (bill.policy_area) {
        policyAreaMap.set(bill.policy_area, (policyAreaMap.get(bill.policy_area) || 0) + 1);
      }
      if (bill.congress !== undefined && bill.congress !== null) {
        congressMap.set(bill.congress, (congressMap.get(bill.congress) || 0) + 1);
      }
      if (bill.bipartisan !== undefined && bill.bipartisan !== null) {
        bipartisanMap.set(bill.bipartisan, (bipartisanMap.get(bill.bipartisan) || 0) + 1);
      }
    });

    setAvailableFilters({
      bill_type_filters: Array.from(billTypeMap.entries())
        .map(([billType, count]) => ({ billType, count }))
        .sort((a, b) => b.count - a.count),
      sponsor_party_filters: Array.from(sponsorPartyMap.entries())
        .map(([party, count]) => ({ party, count }))
        .sort((a, b) => b.count - a.count),
      sponsor_state_filters: Array.from(sponsorStateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
      policy_area_filters: Array.from(policyAreaMap.entries())
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count),
      congress_filters: Array.from(congressMap.entries())
        .map(([congress, count]) => ({ congress, count }))
        .sort((a, b) => b.congress - a.congress), // Sort by congress number ascending
      bipartisan_filters: Array.from(bipartisanMap.entries())
        .map(([bipartisan, count]) => ({ bipartisan, count }))
        .sort((a, b) => a.bipartisan - b.bipartisan), // 0 (No) first, then 1 (Yes)
    });
  }, []);

  // Apply client-side filters
  const applyFilters = useCallback(() => {
    let filtered = [...allSearchResults];

    // Apply selected filters
    if (selectedFilters.bill_types.size > 0) {
      filtered = filtered.filter((bill) => 
        bill.bill_type && selectedFilters.bill_types.has(bill.bill_type)
      );
    }

    if (selectedFilters.sponsor_parties.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.sponsor_party && selectedFilters.sponsor_parties.has(bill.sponsor_party)
      );
    }

    if (selectedFilters.sponsor_states.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.sponsor_state && selectedFilters.sponsor_states.has(bill.sponsor_state)
      );
    }

    if (selectedFilters.policy_areas.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.policy_area && selectedFilters.policy_areas.has(bill.policy_area)
      );
    }

    if (selectedFilters.congresses.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.congress !== undefined && bill.congress !== null && selectedFilters.congresses.has(bill.congress)
      );
    }

    if (selectedFilters.bipartisan.size > 0) {
      filtered = filtered.filter((bill) =>
        bill.bipartisan !== undefined && bill.bipartisan !== null && selectedFilters.bipartisan.has(bill.bipartisan)
      );
    }

    // Note: politician_roles filter is handled server-side via politician_role parameter
    // This client-side filter is for display purposes only if needed in the future

    setCurrentResults(filtered);
    setIsFiltered(
      selectedFilters.bill_types.size > 0 ||
      selectedFilters.sponsor_parties.size > 0 ||
      selectedFilters.sponsor_states.size > 0 ||
      selectedFilters.policy_areas.size > 0 ||
      selectedFilters.congresses.size > 0 ||
      selectedFilters.bipartisan.size > 0 ||
      selectedFilters.politician_roles.size > 0
    );
    setCurrentPage(1);
  }, [allSearchResults, selectedFilters]);
  
  // Column visibility state
  // Note: 'details' is always visible and not selectable (like SEC tile actions)
  const AVAILABLE_COLUMNS = [
    'bill_title',
    'bill_type',
    'bill_number',
    'sponsor_name',
    'sponsor_party',
    'introduced_date',
    'latest_action_date',
    'congress',
    'bipartisan',
    'policy_area',
  ] as const;
  
  const DEFAULT_VISIBLE_COLUMNS = ['bill_title', 'bill_type', 'sponsor_name', 'introduced_date', 'congress'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    savedState?.visibleColumns || DEFAULT_VISIBLE_COLUMNS
  );
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const columnMenuOpen = Boolean(columnMenuAnchor);
  
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [pageSize, setPageSize] = useState<number>(savedState?.pageSize || 25);
  const [advancedSearchExpanded, setAdvancedSearchExpanded] = useState<boolean>(savedState?.advancedSearchExpanded !== false);
  const [searchSidebarVisible, setSearchSidebarVisible] = useState<boolean>(savedState?.searchSidebarVisible !== undefined ? savedState.searchSidebarVisible : true);

  // Politician data loading state (for sponsor name autocomplete)
  const [isPoliticianDataLoaded, setIsPoliticianDataLoaded] = useState<boolean>(false);
  
  // Policy area data loading state (for policy area autocomplete)
  const [isPolicyAreaDataLoaded, setIsPolicyAreaDataLoaded] = useState<boolean>(false);

  // Autocomplete state for Sponsor Name and Bill Title
  const [, setSponsorNameSuggestions] = useState<string[]>([]);
  const [billTitleSuggestions, setBillTitleSuggestions] = useState<string[]>([]);
  const [sponsorNameLoading, setSponsorNameLoading] = useState<boolean>(false);
  const [billTitleLoading, setBillTitleLoading] = useState<boolean>(false);

  // Load politician data on component mount (for sponsor name autocomplete)
  useEffect(() => {
    const loadPoliticianData = async () => {
      try {
        console.log('🏛️ Loading politician suggestions data for congress bills...');
        await politicianSuggestionsService.loadPoliticians();
        setIsPoliticianDataLoaded(true);
        console.log('✅ Politician suggestions data loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load politician suggestions:', error);
      }
    };

    loadPoliticianData();
  }, []);

  // Load policy area data on component mount (for policy area autocomplete)
  useEffect(() => {
    const loadPolicyAreaData = async () => {
      try {
        console.log('📋 Loading policy area suggestions data for congress bills...');
        await policyAreaSuggestionsService.loadPolicyAreas();
        setIsPolicyAreaDataLoaded(true);
        console.log('✅ Policy area suggestions data loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load policy area suggestions:', error);
      }
    };
    loadPolicyAreaData();
  }, []);

  // Autocomplete search functions - mirror politician trades approach using CSV
  const sponsorNameSearch = useCallback((query: string): string[] => {
    if (!isPoliticianDataLoaded) {
      return [];
    }

    if (!query || query.length < 2) {
      setSponsorNameSuggestions([]);
      setSponsorNameLoading(false);
      return [];
    }

    setSponsorNameLoading(true);

    // If empty query, return top politicians
    if (!query || query.length === 0) {
      const results = politicianSuggestionsService.getAllPoliticians().slice(0, 20).map(p => p.displayText);
      setSponsorNameSuggestions(results);
      setSponsorNameLoading(false);
      return results;
    }

    if (query.length < 2) {
      setSponsorNameSuggestions([]);
      setSponsorNameLoading(false);
      return [];
    }

    // Get suggestions from CSV-based service
    const suggestions = politicianSuggestionsService.getSuggestions(query, 20);
    const results = suggestions.map(p => p.displayText);
    setSponsorNameSuggestions(results);
    setSponsorNameLoading(false);
    return results;
  }, [isPoliticianDataLoaded]);

  const billTitleSearch = useCallback((query: string): string[] => {
    // Bill title autocomplete not implemented yet - return empty
    if (!query || query.length < 2) {
      setBillTitleSuggestions([]);
      setBillTitleLoading(false);
      return [];
    }

    setBillTitleLoading(false);
    setBillTitleSuggestions([]);
    return [];
  }, []);

  // Policy area search callback - mimic security autocomplete pattern
  const policyAreaSearch = useCallback((query: string): string[] => {
    if (!isPolicyAreaDataLoaded) {
      return [];
    }
    
    // If empty query or short query, return all policy areas (scrollable)
    if (!query || query.length < 1) {
      return policyAreaSuggestionsService.getAllPolicyAreas();
    }
    
    return policyAreaSuggestionsService.getSuggestions(query, 20);
  }, [isPolicyAreaDataLoaded]);

  // Handle search
  const handleSearch = useCallback(async () => {
    setIsSearching(true);
    setSearchError(null);
    setLastEvaluatedKey(null);
    setHasMore(false);
    setAllSearchResults([]);
    setCurrentResults([]);
    setSelectedBills(new Set());

    try {
      const filters: any = {
        ...searchParams,
      };

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
        if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
      });
      
      // Handle politician_role: normalize to array format
      // - undefined or null -> [] (empty array means 'both' - lambda will handle)
      // - string 'both' -> [] (empty array means 'both')
      // - string 'sponsor' -> ['sponsor']
      // - string 'cosponsor' -> ['cosponsor']
      // - array -> keep as-is ([] = both, ['sponsor'] = sponsor only, ['cosponsor'] = cosponsor only, ['sponsor', 'cosponsor'] = both)
      if (filters.politician_role === undefined || filters.politician_role === null) {
        filters.politician_role = [];
      } else if (typeof filters.politician_role === 'string') {
        if (filters.politician_role === 'both') {
          filters.politician_role = [];
        } else if (filters.politician_role === 'sponsor' || filters.politician_role === 'cosponsor') {
          filters.politician_role = [filters.politician_role];
        } else {
          // Unknown string value, default to empty array (both)
          filters.politician_role = [];
        }
      }
      // If it's already an array, keep it as-is - lambda will handle empty array as 'both'
      
      console.log('🟢 [Search] Final politician_role (array format):', filters.politician_role);

      const response = await congressBillsSearchAPI.search({
        filters,
      });

      if (response.success) {
        const results = response.results || [];
        // Deduplicate results by bill_id to prevent duplicate keys in React
        const seenBillIds = new Set<string>();
        const uniqueResults = results.filter(bill => {
          if (!bill.bill_id) return false; // Skip items without bill_id
          if (seenBillIds.has(bill.bill_id)) {
            return false;
          }
          seenBillIds.add(bill.bill_id);
          return true;
        });
        setAllSearchResults(uniqueResults);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        // Compute available filters from results
        computeFiltersFromResults(uniqueResults);
        // Only reset client-side filters when new search is performed (not when restoring from sessionStorage)
        // This allows filters to persist when navigating away and back
        if (!savedState?.selectedFilters) {
          setSelectedFilters({
            bill_types: new Set(),
            sponsor_parties: new Set(),
            sponsor_states: new Set(),
            policy_areas: new Set(),
            congresses: new Set(),
            bipartisan: new Set(),
            politician_roles: new Set(),
          });
          setIsFiltered(false);
        }
      } else {
        setSearchError('Search failed. Please try again.');
      }
    } catch (error: any) {
      console.error('Search error:', error);
      setSearchError(error.message || 'An error occurred while searching.');
    } finally {
      setIsSearching(false);
    }
  }, [searchParams, pageSize, computeFiltersFromResults]);

  // Load more results using cursor-based pagination
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !lastEvaluatedKey || isLoadingMore) return;
    
    setIsLoadingMore(true);
    setSearchError(null);
    
    try {
      const filters: any = {
        ...searchParams,
      };

      // Remove empty arrays
      Object.keys(filters).forEach((key) => {
        const value = filters[key];
        if (Array.isArray(value) && value.length === 0) {
          delete filters[key];
        }
        if (value === '' || value === null || value === undefined) {
          delete filters[key];
        }
      });

      const response = await congressBillsSearchAPI.search({
        filters,
        limit: getSearchPageBatchSize('congress_bills'),
        last_evaluated_key: lastEvaluatedKey,
      });

      if (response.success) {
        const newResults = response.results || [];
        // Deduplicate results by bill_id to prevent duplicate keys in React
        const existingBillIds = new Set(allSearchResults.map(bill => bill.bill_id).filter(Boolean));
        const uniqueNewResults = newResults.filter(bill => {
          if (!bill.bill_id) return false; // Skip items without bill_id
          return !existingBillIds.has(bill.bill_id);
        });
        const updatedResults = [...allSearchResults, ...uniqueNewResults];
        setAllSearchResults(updatedResults);
        setHasMore(response.has_more || false);
        setLastEvaluatedKey(response.last_evaluated_key || null);
        
        // Update filters with new results
        computeFiltersFromResults(updatedResults);
      } else {
        setSearchError('Load more failed. Please try again.');
        setHasMore(false);
      }
    } catch (error: any) {
      console.error('Load more error:', error);
      setSearchError(error.message || 'An error occurred while loading more results.');
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, lastEvaluatedKey, isLoadingMore, searchParams, allSearchResults, computeFiltersFromResults]);

  // Context menu handlers
  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
    setContextMenuPosition(null);
  };

  const handleAddToFiles = () => {
    if (selectedBills.size === 0 || !user) return;
    setFileBrowserFor('bills');
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedBills.size === 0) return;
    
    try {
      const selectedBillObjects = currentResults.filter(bill => 
        selectedBills.has(bill.bill_id)
      );

      // Save all bills to the filesystem with FULL data using bulk operation
      // Note: We use currentResults which contains the full bill objects from the search API
      // The search API already enriches bills with full data (including oversized bills from S3)
      // This ensures we save the complete bill with all fields: actions_json, cosponsors_json, amendments_json, etc.
      const items = selectedBillObjects.map(bill => {
        const title = `${bill.bill_type || 'Bill'} ${bill.bill_number || ''} - ${bill.bill_title || 'Untitled Bill'}`.trim();
        return {
          context_data: bill, // Full bill object: includes actions_json, cosponsors_json, amendments_json, etc.
          title: title,
          item_type: 'congress_bill' as const,
        };
      });
      
      // Use bulk operation for better performance
      const response = await filesystemAPI.addBulkContextItems({
        user_id: user.id,
        folder_path: folderPath,
        items: items,
      });
      
      if (response.success) {
        const result = response.result as any;
        console.log(`✅ Saved ${result?.succeeded || selectedBillObjects.length} of ${selectedBillObjects.length} bill(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} bill(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save bills');
      }
    } catch (error) {
      console.error('Error saving bills to filesystem:', error);
    }
  };

  const handleAddToContext = () => {
    const selectedBillObjects = currentResults.filter(bill => 
      selectedBills.has(bill.bill_id)
    );

    if (selectedBillObjects.length === 0) return;

    // Add bills to context using the context manager functions
    if (selectedBillObjects.length === 1) {
      addBillToContext(selectedBillObjects[0]);
    } else {
      addMultipleBillsToContext(selectedBillObjects);
    }

    setSelectedBills(new Set());
    handleContextMenuClose();
  };

  // Handle bill click (single, Ctrl+click, Shift+click)
  const handleBillClick = (e: React.MouseEvent, billId: string, index: number) => {
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedBills(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const billsToSelect = paginatedResults.slice(start, end + 1);
        billsToSelect.forEach(bill => newSelected.add(bill.bill_id));
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(billId)) {
          newSelected.delete(billId);
        } else {
          newSelected.add(billId);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(billId)) {
          newSelected.delete(billId);
        } else {
          newSelected.clear();
          newSelected.add(billId);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, billId: string) => {
    e.stopPropagation();
    
    // Determine which bills to drag
    const billsToDrag = selectedBills.has(billId) ? selectedBills : new Set([billId]);
    
    // Set drag data
    const selectedBillObjects = currentResults.filter(bill => 
      billsToDrag.has(bill.bill_id)
    );
    
    if (selectedBillObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'congress_bills',
        bills: selectedBillObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedBillObjects.length} bill${selectedBillObjects.length > 1 ? 's' : ''}`;
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.padding = '8px 12px';
      dragImage.style.backgroundColor = '#3b82f6';
      dragImage.style.color = '#ffffff';
      dragImage.style.borderRadius = '4px';
      dragImage.style.fontSize = '14px';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  };

  // Handle context menu for selected items
  const handleRowContextMenu = (e: React.MouseEvent, billId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this bill is not selected, select only it
    if (!selectedBills.has(billId)) {
      setSelectedBills(new Set([billId]));
    }
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  // Compute available filters when results are restored from sessionStorage
  useEffect(() => {
    if (allSearchResults.length > 0 && availableFilters.bill_type_filters.length === 0) {
      // If we have results but no available filters, compute them
      computeFiltersFromResults(allSearchResults);
    }
  }, [allSearchResults, availableFilters, computeFiltersFromResults]);

  // Apply filters when selectedFilters or allSearchResults change
  useEffect(() => {
    if (allSearchResults.length > 0) {
      applyFilters();
    } else {
      setCurrentResults([]);
    }
  }, [allSearchResults, selectedFilters, applyFilters]);

  // Save state to sessionStorage
  useEffect(() => {
    try {
      const stateToSave = {
        activeTab,
        searchParams,
        allSearchResults,
        currentPage,
        pageSize,
        isSearching,
        lastEvaluatedKey,
        hasMore,
        visibleColumns,
        advancedSearchExpanded,
        searchSidebarVisible,
        // Convert Sets to arrays for JSON serialization
        selectedFilters: {
          bill_types: Array.from(selectedFilters.bill_types),
          sponsor_parties: Array.from(selectedFilters.sponsor_parties),
          policy_areas: Array.from(selectedFilters.policy_areas),
          congresses: Array.from(selectedFilters.congresses),
          bipartisan: Array.from(selectedFilters.bipartisan),
        },
        expandedFilters,
        availableFilters,
        isFiltered,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error: any) {
      // Handle quota exceeded errors gracefully
      if (error.name === 'QuotaExceededError') {
        console.warn('⚠️ SessionStorage quota exceeded, saving state without full results...');
        try {
          // Save state without full results if quota is exceeded
          // Only save minimal data needed to restore search state
          const stateWithoutResults = {
            activeTab,
            searchParams,
            // Save only bill IDs and essential fields instead of full objects to reduce size
            allSearchResults: allSearchResults.map(bill => ({
              bill_id: bill.bill_id,
              bill_number: bill.bill_number,
              bill_title: bill.bill_title,
              introduced_date: bill.introduced_date,
            })),
            currentPage,
            pageSize,
            isSearching,
            lastEvaluatedKey,
            hasMore,
            visibleColumns,
            advancedSearchExpanded,
            searchSidebarVisible,
            selectedFilters: {
              bill_types: Array.from(selectedFilters.bill_types),
              sponsor_parties: Array.from(selectedFilters.sponsor_parties),
              sponsor_states: Array.from(selectedFilters.sponsor_states),
              policy_areas: Array.from(selectedFilters.policy_areas),
              congresses: Array.from(selectedFilters.congresses),
              bipartisan: Array.from(selectedFilters.bipartisan),
            },
            expandedFilters,
            // Don't save availableFilters as it can be large
            isFiltered,
          };
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateWithoutResults));
        } catch (retryError) {
          console.error('❌ Failed to save state to sessionStorage even without full results:', retryError);
          // Last resort: save only essential state
          try {
            const minimalState = {
              activeTab,
              searchParams,
              currentPage,
              pageSize,
              lastEvaluatedKey,
              hasMore,
              visibleColumns,
              advancedSearchExpanded,
              searchSidebarVisible,
              selectedFilters: {
                bill_types: Array.from(selectedFilters.bill_types),
                sponsor_parties: Array.from(selectedFilters.sponsor_parties),
                sponsor_states: Array.from(selectedFilters.sponsor_states),
                policy_areas: Array.from(selectedFilters.policy_areas),
                congresses: Array.from(selectedFilters.congresses),
                bipartisan: Array.from(selectedFilters.bipartisan),
              },
              expandedFilters,
              isFiltered,
            };
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(minimalState));
          } catch (finalError) {
            console.error('❌ Failed to save minimal state to sessionStorage:', finalError);
          }
        }
      } else {
      console.error('❌ Error saving congress bills search page state:', error);
      }
    }
  }, [
    searchParams,
    allSearchResults,
    currentPage,
    pageSize,
    isSearching,
    lastEvaluatedKey,
    hasMore,
    visibleColumns,
    advancedSearchExpanded,
    searchSidebarVisible,
    selectedFilters,
    expandedFilters,
    availableFilters,
    isFiltered,
  ]);

  // Pagination - use filtered results if filters are applied, otherwise use all results
  const resultsToDisplay = isFiltered ? currentResults : allSearchResults;
  const totalPages = Math.ceil(resultsToDisplay.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = resultsToDisplay.slice(startIndex, endIndex);

  // Format date helper
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      // Parse date string directly to avoid timezone conversion issues
      // Date strings like "2025-01-03" should be treated as local dates, not UTC
      const [year, month, day] = dateString.split('T')[0].split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateString;
    }
  };

  return (
    <Box sx={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)', minHeight: '100vh', p: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: '95%', px: 3 }}>
        <Typography variant="h4" sx={{ color: '#ffffff', mb: 1, fontWeight: 600 }}>
          Congress Search
        </Typography>
        <Tabs
          value={activeTab}
          onChange={(_, v: 'bills' | 'rollcall') => setActiveTab(v)}
          sx={{
            mb: 3,
            '& .MuiTab-root': { color: '#94a3b8', fontWeight: 500 },
            '& .Mui-selected': { color: '#3b82f6' },
            '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' },
          }}
        >
          <Tab label="Bills Search" value="bills" />
          <Tab label="Roll Call Search" value="rollcall" />
        </Tabs>

        {/* Roll Call Search tab — same collapsible search UI as Bills; API to be wired later */}
        {activeTab === 'rollcall' && (
          <Box sx={{ display: 'flex', gap: 3 }}>
            {/* Left Sidebar - Roll Call Search Filters (Collapsible) */}
            {rollCallSearchSidebarVisible ? (
              <GlassCard sx={{
                minWidth: 320,
                maxWidth: 380,
                width: 320,
                height: 'fit-content',
                position: 'sticky',
                top: 20,
                alignSelf: 'flex-start',
                transition: 'all 0.3s ease-in-out',
              }}>
                <Box sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                      Search Filters
            </Typography>
                    <IconButton
                      onClick={() => setRollCallSearchSidebarVisible(false)}
                      sx={{ color: '#94a3b8' }}
                      size="small"
                      title="Hide search filters"
                    >
                      <KeyboardArrowDownIcon sx={{ transform: 'rotate(-90deg)' }} />
                    </IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Politician Name - same multiselect autocomplete as Bills */}
                    <Box>
                      <MultiSelectField<string>
                        label="Politician Name"
                        selectedItems={(() => {
                          const names = Array.isArray(rollCallPoliticianName) ? rollCallPoliticianName : (rollCallPoliticianName ? [rollCallPoliticianName] : []);
                          if (!isPoliticianDataLoaded) return names;
                          return names.map(name => {
                            const politician = politicianSuggestionsService.getAllPoliticians().find(p => p.fullName === name);
                            return politician ? politician.displayText : name;
                          });
                        })()}
                        onItemsChange={(politicians) => {
                          const actualNames = politicians.map(politicianDisplay => {
                            const nameMatch = politicianDisplay.match(/^([^(]+)/);
                            return nameMatch ? nameMatch[1].trim() : politicianDisplay;
                          });
                          setRollCallPoliticianName(actualNames);
                          setRollCallSearchMessage(null);
                        }}
                        suggestions={isPoliticianDataLoaded ? politicianSuggestionsService.getAllPoliticians().map(p => p.fullName) : []}
                        onSearch={sponsorNameSearch}
                        renderItem={(politicianDisplay) => politicianDisplay}
                        renderOptionCustom={(politicianDisplay) => {
                          const nameMatch = politicianDisplay.match(/^([^(]+)/);
                          const name = nameMatch ? nameMatch[1].trim() : politicianDisplay;
                          const details = politicianDisplay.replace(name, '').trim();
                          return (
                            <Box sx={{ width: '100%' }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, color: '#ffffff', fontSize: '0.9rem' }}>{name}</Typography>
                              {details && <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>{details}</Typography>}
                            </Box>
                          );
                        }}
                        getItemKey={(politician) => politician}
                        placeholder="Search politicians to see how they voted..."
                        allowCustomInput={false}
                        isLoading={!isPoliticianDataLoaded || sponsorNameLoading}
                      />
                    </Box>

                    {/* Congress & Session — collapsible bubbles (like Advanced Search); 119th selects both sessions */}
                    <Box sx={{ borderTop: '1px solid #334155', pt: 1.5, mt: 1.5 }}>
                      <Box
                sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          color: '#9ca3af',
                          '&:hover': { color: '#e2e8f0' },
                        }}
                        onClick={() => setRollCallCongressSectionExpanded((b) => !b)}
                      >
                        <Typography variant="body2" sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                          Congress & Session
                        </Typography>
                        <IconButton size="small" sx={{ color: 'inherit', p: 0.25 }}>
                          {rollCallCongressSectionExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                        </IconButton>
                      </Box>
                      <Collapse in={rollCallCongressSectionExpanded}>
                        <Box sx={{ py: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {/* 119th Congress — selecting auto-selects both sessions */}
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              py: 0.75,
                              px: 1,
                              borderRadius: '4px',
                              backgroundColor: rollCallCongress === '119' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                              border: rollCallCongress === '119' ? '1px solid #3b82f6' : '1px solid #374151',
                              cursor: 'pointer',
                              '&:hover': {
                                backgroundColor: rollCallCongress === '119' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(55, 65, 81, 0.3)',
                              },
                            }}
                            onClick={() => {
                              if (rollCallCongress === '119') {
                                setRollCallCongress('');
                              } else {
                                setRollCallCongress('119');
                              }
                              setRollCallSearchMessage(null);
                            }}
                          >
                            <Checkbox
                              checked={rollCallCongress === '119'}
                              size="small"
                              sx={{ color: '#9ca3af', '&.Mui-checked': { color: '#3b82f6' }, p: 0.5 }}
                            />
                            <Typography sx={{ color: '#e2e8f0', fontSize: '0.8125rem', fontWeight: 500 }}>
                              119th Congress
                            </Typography>
                          </Box>
                        </Box>
                      </Collapse>
                    </Box>
                    {/* Roll number */}
              <TextField
                label="Roll number"
                placeholder="e.g. 17"
                      value={rollCallRoll}
                      onChange={(e) => { setRollCallRoll(e.target.value); setRollCallSearchMessage(null); }}
                      fullWidth
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'rgba(30, 41, 59, 0.5)',
                    color: '#e2e8f0',
                    '& fieldset': { borderColor: '#475569' },
                          '&:hover fieldset': { borderColor: '#64748b' },
                          '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#94a3b8' },
                }}
              />

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
              <Button
                variant="contained"
                        disabled={rollCallLoading}
                        onClick={async () => {
                          setRollCallSearchMessage(null);
                          setRollCallError(null);
                          const politicianNames = Array.isArray(rollCallPoliticianName) ? rollCallPoliticianName : (rollCallPoliticianName ? [rollCallPoliticianName] : []);
                          const hasPoliticians = politicianNames.length > 0;
                          const hasRollNumber = rollCallRoll.trim().length > 0;
                          const congressNum = rollCallCongress === '119' ? 119 : undefined;
                          const rollNum = rollCallRoll.trim() ? parseInt(rollCallRoll.trim(), 10) : undefined;
                          const validRoll = typeof rollNum === 'number' && !isNaN(rollNum);
                          setRollCallLoading(true);
                          try {
                            if (hasPoliticians) {
                              const politicianIds = politicianNames.map((name) => {
                                const p = politicianSuggestionsService.getAllPoliticians().find(x => x.fullName === name);
                                if (p?.bioguide_id) return p.bioguide_id;
                                return 'NAME#' + (name || '').replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unknown';
                              });
                              const res = await congressBillsSearchAPI.rollCallSearch({
                                search_index: 'SEARCH#VOTE',
                                politician_ids: politicianIds,
                                limit: 100,
                              });
                              if (res.success) {
                                setRollCallResults(res.results || []);
                                setRollCallHasMore(res.has_more || false);
                                setRollCallLastKey(res.last_evaluated_key ?? null);
                                setRollCallSearchIndex('SEARCH#VOTE');
                                const details = (res as any).bill_details;
                                if (details && typeof details === 'object') {
                                  setRollCallBillDetails(prev => ({ ...prev, ...details }));
                                }
                                setRollCallRollDates((res as any).roll_dates ?? {});
                              } else {
                                setRollCallError(res.error || 'Vote search failed');
                                setRollCallResults([]);
                              }
                            } else if (hasRollNumber || congressNum !== undefined) {
                              // SEARCH#ROLL: by congress and/or specific roll number (always send congress when we have it or default 119)
                              const res = await congressBillsSearchAPI.rollCallSearch({
                                search_index: 'SEARCH#ROLL',
                                congress: congressNum ?? 119,
                                roll: validRoll ? rollNum : undefined,
                                limit: 100,
                              });
                              if (res.success) {
                                setRollCallResults(res.results || []);
                                setRollCallHasMore(res.has_more || false);
                                setRollCallLastKey(res.last_evaluated_key ?? null);
                                setRollCallSearchIndex('SEARCH#ROLL');
                              } else {
                                setRollCallError(res.error || 'Roll search failed');
                                setRollCallResults([]);
                              }
                            } else {
                              // Empty search: SEARCH#ROLL for most recent Congress (119) only
                              const res = await congressBillsSearchAPI.rollCallSearch({
                                search_index: 'SEARCH#ROLL',
                                congress: 119,
                                limit: 100,
                              });
                              if (res.success) {
                                setRollCallResults(res.results || []);
                                setRollCallHasMore(res.has_more || false);
                                setRollCallLastKey(res.last_evaluated_key ?? null);
                                setRollCallSearchIndex('SEARCH#ROLL');
                              } else {
                                setRollCallError(res.error || 'Roll search failed');
                                setRollCallResults([]);
                              }
                            }
                          } catch (e: any) {
                            setRollCallError(e?.message || 'Search failed');
                            setRollCallResults([]);
                          } finally {
                            setRollCallLoading(false);
                          }
                        }}
                        fullWidth
                        startIcon={<SearchIcon />}
                sx={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                          '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
                        }}
                      >
                        {rollCallLoading ? 'Searching...' : 'Search'}
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setRollCallCongress('');
                          setRollCallRoll('');
                          setRollCallPoliticianName([]);
                          setRollCallSearchMessage(null);
                          setRollCallResults([]);
                          setRollCallError(null);
                          setRollCallLastKey(null);
                          setRollCallHasMore(false);
                          setRollCallSearchIndex(null);
                          setRollCallBillDetails({});
                        }}
                        fullWidth
                        sx={{
                          borderColor: '#475569',
                          color: '#94a3b8',
                          '&:hover': { borderColor: '#64748b', backgroundColor: 'rgba(71, 85, 105, 0.1)' },
                        }}
                      >
                        Clear
              </Button>
                    </Box>
                  </Box>
            </Box>
          </GlassCard>
            ) : (
              <Box sx={{ position: 'sticky', top: 20, alignSelf: 'flex-start', height: 'fit-content' }}>
                <IconButton
                  onClick={() => setRollCallSearchSidebarVisible(true)}
                  sx={{
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    border: '2px solid #374151',
                    borderRadius: '50%',
                    width: 48,
                    height: 48,
                    color: '#3b82f6',
                    '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.98)', borderColor: '#3b82f6', transform: 'scale(1.05)' },
                    transition: 'all 0.3s ease-in-out',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                  }}
                  title="Show search filters"
                >
                  <SearchIcon />
                </IconButton>
              </Box>
            )}

            {/* Main content - roll call search results */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {rollCallSearchMessage && (
                <Alert severity="info" sx={{ mb: 2 }} onClose={() => setRollCallSearchMessage(null)}>
                  {rollCallSearchMessage}
                </Alert>
              )}
              {rollCallError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRollCallError(null)}>
                  {rollCallError}
                </Alert>
              )}
              {rollCallSearchIndex && (
                <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>
                  Index: {rollCallSearchIndex}
                  {rollCallSearchIndex === 'SEARCH#VOTE' && (
                    <> · {rollCallFilteredRows.length} roll call(s){rollCallResultView === 'rollcalls' && rollCallFlattenedRows.length !== rollCallFilteredRows.length ? ` (filtered from ${rollCallFlattenedRows.length})` : ''} · {rollCallResultView === 'bills' ? voteBillFilteredRows.length : voteBillFlattenedRows.length} bill(s){rollCallResultView === 'bills' && voteBillFlattenedRows.length !== voteBillFilteredRows.length ? ` (filtered from ${voteBillFlattenedRows.length})` : ''}</>
                  )}
                  {rollCallSearchIndex === 'SEARCH#ROLL' && (
                    <> · {rollCallFilteredRows.length} roll call(s)</>
                  )}
                  {rollCallHasMore ? ' · Load more below' : ''}
                </Typography>
              )}
              {(rollCallSearchIndex === 'SEARCH#VOTE' && (rollCallFilteredRows.length > 0 || voteBillFlattenedRows.length > 0)) || (rollCallSearchIndex === 'SEARCH#ROLL' && rollCallFilteredRows.length > 0) ? (
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {rollCallSearchIndex === 'SEARCH#VOTE' && (
                    <Tabs
                      value={rollCallResultView}
                      onChange={(_, v: 'rollcalls' | 'bills') => setRollCallResultView(v)}
                      sx={{ mb: 2, '& .MuiTab-root': { color: '#94a3b8' }, '& .Mui-selected': { color: '#3b82f6' }, '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' } }}
                    >
                      <Tab label="Roll calls" value="rollcalls" />
                      <Tab label="Bills" value="bills" />
                    </Tabs>
                  )}
                  {((rollCallSearchIndex === 'SEARCH#VOTE' && rollCallResultView === 'rollcalls') || rollCallSearchIndex === 'SEARCH#ROLL') && rollCallFilteredRows.length > 0 && (
                <Box sx={{ display: 'flex', gap: 3, flex: 1, minWidth: 0 }}>
                  <GlassCard sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Box sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Tooltip title="Select columns to display">
                            <IconButton onClick={(e) => setRollCallColumnMenuAnchor(e.currentTarget)} sx={{ color: '#94a3b8' }} size="small">
                              <ViewColumnIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                          <Tooltip title={selectedRollCalls.size > 0 ? `Add ${selectedRollCalls.size} roll call(s) to context` : 'Select roll calls to add to context'}>
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => { if (selectedRollCalls.size > 0) handleRollCallAddToContext(); else alert('Please select at least one roll call'); }}
                                disabled={selectedRollCalls.size === 0}
                                sx={{ color: selectedRollCalls.size > 0 ? '#10b981' : '#9ca3af', '&:hover': { color: '#10b981' }, '&:disabled': { color: '#4b5563' } }}
                              >
                                <AddToContextIcon sx={{ fontSize: 18 }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Chip
                            label={`${rollCallFilteredRows.length} roll call${rollCallFilteredRows.length !== 1 ? 's' : ''} found`}
                            sx={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#86efac', border: '1px solid #22c55e', fontWeight: 600 }}
                          />
                          <FormControl size="small" sx={{ minWidth: 120, ml: 1 }}>
                            <InputLabel id="roll-call-per-page-label" sx={{ color: '#9ca3af' }}>Per Page</InputLabel>
                            <Select
                              labelId="roll-call-per-page-label"
                              value={rollCallPageSize}
                              label="Per Page"
                              onChange={(e) => { setRollCallPageSize(Number(e.target.value)); setRollCallCurrentPage(1); }}
                              sx={{ color: '#ffffff', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' }, '& .MuiSelect-icon': { color: '#9ca3af' } }}
                              MenuProps={{ PaperProps: { sx: { bgcolor: '#1f2937', border: '1px solid #374151' } } }}
                            >
                              <MenuItem value={10}>10</MenuItem>
                              <MenuItem value={25}>25</MenuItem>
                              <MenuItem value={50}>50</MenuItem>
                              <MenuItem value={100}>100</MenuItem>
                            </Select>
                          </FormControl>
                        </Box>
                      </Box>
                      <Menu
                        anchorEl={rollCallColumnMenuAnchor}
                        open={rollCallColumnMenuOpen}
                        onClose={() => setRollCallColumnMenuAnchor(null)}
                        PaperProps={{ sx: { backgroundColor: 'rgba(15, 23, 42, 0.98)', border: '2px solid #374151', color: '#ffffff' } }}
                      >
                        {getRollCallColumnsForIndex().map((col) => (
                          <MenuItem
                            key={col}
                            onClick={() => setVisibleRollCallColumns((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])}
                            sx={{ color: visibleRollCallColumns.includes(col) ? '#3b82f6' : '#94a3b8' }}
                          >
                            <Checkbox checked={visibleRollCallColumns.includes(col)} sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }} />
                            {col === 'latest_action_date' ? 'Update Date' : col.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                          </MenuItem>
                        ))}
                      </Menu>
                      <TableContainer
                        sx={{
                          '&::-webkit-scrollbar': { width: 6 },
                          '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' },
                          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 },
                          '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' },
                        }}
                      >
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell padding="none" sx={{ width: 40, padding: '8px 4px', color: '#94a3b8', borderColor: '#374151' }}>
                                <Checkbox
                                  size="small"
                                  indeterminate={selectedRollCalls.size > 0 && selectedRollCalls.size < rollCallPaginatedRows.length}
                                  checked={rollCallPaginatedRows.length > 0 && rollCallPaginatedRows.every((r) => selectedRollCalls.has(r.rowKey))}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedRollCalls((prev) => {
                                        const next = new Set(prev);
                                        rollCallPaginatedRows.forEach((r) => next.add(r.rowKey));
                                        return next;
                                      });
                                    } else {
                                      setSelectedRollCalls((prev) => {
                                        const next = new Set(prev);
                                        rollCallPaginatedRows.forEach((r) => next.delete(r.rowKey));
                                        return next;
                                      });
                                    }
                                  }}
                                  sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                                />
                              </TableCell>
                              {rollCallSearchIndex === 'SEARCH#VOTE' && visibleRollCallColumns.includes('politician') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Politician</TableCell>}
                              {visibleRollCallColumns.includes('congress') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Congress</TableCell>}
                              {visibleRollCallColumns.includes('session') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Session</TableCell>}
                              {visibleRollCallColumns.includes('roll') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Roll</TableCell>}
                              {rollCallSearchIndex === 'SEARCH#VOTE' && visibleRollCallColumns.includes('vote') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Vote</TableCell>}
                              {rollCallSearchIndex === 'SEARCH#VOTE' && visibleRollCallColumns.includes('bill') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Bill</TableCell>}
                              {visibleRollCallColumns.includes('latest_action_date') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Update Date</TableCell>}
                              {rollCallSearchIndex === 'SEARCH#ROLL' && visibleRollCallColumns.includes('associated_bill') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Associated Bill</TableCell>}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rollCallPaginatedRows.map((row, idx) => {
                              const globalIndex = rollCallStartIndex + idx;
                              const isSelected = selectedRollCalls.has(row.rowKey);
                              return (
                                <TableRow
                                  key={row.rowKey}
                                  onClick={(e) => handleRollCallClick(e, row.rowKey, globalIndex)}
                                  onContextMenu={(e) => handleRollCallRowContextMenu(e, row.rowKey)}
                                  draggable={isSelected}
                                  onDragStart={(e) => handleRollCallDragStart(e, row.rowKey)}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    if (user?.id) {
                                      openItemDetails('roll_call', { congress: row.congress, session: row.session, roll: row.roll }, row.roll_display ?? `Roll Call ${row.roll}`, { user_id: user.id });
                                    }
                                  }}
                                  sx={{
                                    backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                    '&:hover': { backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)' },
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                  }}
                                >
                                  <TableCell sx={{ width: 40, padding: '8px 4px', borderColor: '#374151' }} />
                                  {rollCallSearchIndex === 'SEARCH#VOTE' && visibleRollCallColumns.includes('politician') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{row.politician ?? '—'}</TableCell>}
                                  {visibleRollCallColumns.includes('congress') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{row.congress}</TableCell>}
                                  {visibleRollCallColumns.includes('session') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{row.session}</TableCell>}
                                  {visibleRollCallColumns.includes('roll') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{row.roll}</TableCell>}
                                  {rollCallSearchIndex === 'SEARCH#VOTE' && visibleRollCallColumns.includes('vote') && (
                                    <TableCell sx={{ borderColor: '#374151' }}>
                                      <Chip
                                        size="small"
                                        label={row.voteType ?? '—'}
                                        sx={{
                                          backgroundColor: row.voteType === 'Yea' ? 'rgba(34, 197, 94, 0.2)' : row.voteType === 'Nay' ? 'rgba(239, 68, 68, 0.2)' : row.voteType === 'Abstained' ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                                          color: row.voteType === 'Yea' ? '#86efac' : row.voteType === 'Nay' ? '#fca5a5' : row.voteType === 'Abstained' ? '#d1d5db' : '#94a3b8',
                                          fontWeight: 600,
                                          fontSize: '0.75rem',
                                        }}
                                      />
                                    </TableCell>
                                  )}
                                  {rollCallSearchIndex === 'SEARCH#VOTE' && visibleRollCallColumns.includes('bill') && (
                                    <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151', maxWidth: 280 }}>
                                      {row.bill_id ? (
                                        <Tooltip title={rollCallBillDetails[row.bill_id]?.bill_title ?? row.bill_id} disableHoverListener={!rollCallBillDetails[row.bill_id]?.bill_title}>
                                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{rollCallBillDetails[row.bill_id]?.bill_title ?? row.bill_id}</span>
                                        </Tooltip>
                                      ) : <span>—</span>}
                                    </TableCell>
                                  )}
                                  {visibleRollCallColumns.includes('latest_action_date') && (
                                    <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{formatDate(row.latest_action_date) || '—'}</TableCell>
                                  )}
                                  {rollCallSearchIndex === 'SEARCH#ROLL' && visibleRollCallColumns.includes('associated_bill') && (
                                    <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{row.bill_title || row.bill_id_associated || '—'}</TableCell>
                                  )}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      {rollCallTotalPages > 1 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                          <Typography sx={{ color: '#94a3b8' }}>
                            Showing {rollCallStartIndex + 1}-{rollCallEndIndex} of {rollCallFilteredRows.length} results
                          </Typography>
                          <Pagination
                            count={rollCallTotalPages}
                            page={rollCallCurrentPage}
                            onChange={(_, p) => setRollCallCurrentPage(p)}
                            sx={{ '& .MuiPaginationItem-root': { color: '#94a3b8' }, '& .MuiPaginationItem-root.Mui-selected': { backgroundColor: '#3b82f6', color: '#fff' } }}
                          />
                        </Box>
                      )}
                    </Box>
                  </GlassCard>
                  {/* Roll call client-side filters */}
                  <GlassCard sx={{ p: 2, minWidth: 260, maxWidth: 300, height: 'fit-content', alignSelf: 'flex-start' }}>
                    <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 1.5, fontWeight: 600 }}>Refine results</Typography>
                    {(rollCallAvailableFilters.congress_filters.length > 0 || rollCallAvailableFilters.session_filters.length > 0 || rollCallAvailableFilters.politician_filters.length > 0 || rollCallAvailableFilters.vote_type_filters.length > 0) && (
                      <>
                        {rollCallSearchIndex === 'SEARCH#VOTE' && rollCallAvailableFilters.vote_type_filters.length > 0 && (
                          <Box sx={{ mb: 1.5 }}>
                            <Box
                              onClick={() => setRollCallExpandedFilters((p) => ({ ...p, voteTypes: !p.voteTypes }))}
                              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', py: 0.5 }}
                            >
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Vote</Typography>
                              {rollCallExpandedFilters.voteTypes ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                            </Box>
                            <Collapse in={rollCallExpandedFilters.voteTypes}>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                {rollCallAvailableFilters.vote_type_filters.map((f) => {
                                  const isSelected = rollCallSelectedFilters.voteTypes.has(f.voteType);
                                  return (
                                    <Chip
                                      key={f.voteType}
                                      size="small"
                                      label={`${f.voteType} (${f.count})`}
                                      onClick={() => setRollCallSelectedFilters((prev) => {
                                        const next = new Set(prev.voteTypes);
                                        if (next.has(f.voteType)) next.delete(f.voteType); else next.add(f.voteType);
                                        return { ...prev, voteTypes: next };
                                      })}
                                      sx={{
                                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.25)' : 'rgba(55, 65, 81, 0.4)',
                                        color: isSelected ? '#93c5fd' : '#9ca3af',
                                        border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                        cursor: 'pointer',
                                        fontSize: '0.7rem',
                                      }}
                                    />
                                  );
                                })}
                              </Box>
                            </Collapse>
                          </Box>
                        )}
                        {rollCallAvailableFilters.congress_filters.length > 0 && (
                          <Box sx={{ mb: 1.5 }}>
                            <Box
                              onClick={() => setRollCallExpandedFilters((p) => ({ ...p, congresses: !p.congresses }))}
                              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', py: 0.5 }}
                            >
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Congress</Typography>
                              {rollCallExpandedFilters.congresses ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                            </Box>
                            <Collapse in={rollCallExpandedFilters.congresses}>
                              <Box sx={{ maxHeight: 180, overflowY: 'auto' }}>
                                {rollCallAvailableFilters.congress_filters.map((f) => {
                                  const isSelected = rollCallSelectedFilters.congresses.has(f.congress);
                                  return (
                                    <Box
                                      key={f.congress}
                                      onClick={() => setRollCallSelectedFilters((prev) => {
                                        const next = new Set(prev.congresses);
                                        if (next.has(f.congress)) next.delete(f.congress); else next.add(f.congress);
                                        return { ...prev, congresses: next };
                                      })}
                                      sx={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, px: 1, cursor: 'pointer',
                                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                        borderRadius: 1,
                                      }}
                                    >
                                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.congress}</Typography>
                                      <Chip size="small" label={f.count} sx={{ height: 20, fontSize: '0.7rem' }} />
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Collapse>
                          </Box>
                        )}
                        {rollCallAvailableFilters.session_filters.length > 0 && (
                          <Box sx={{ mb: 1.5 }}>
                            <Box
                              onClick={() => setRollCallExpandedFilters((p) => ({ ...p, sessions: !p.sessions }))}
                              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', py: 0.5 }}
                            >
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Session</Typography>
                              {rollCallExpandedFilters.sessions ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                            </Box>
                            <Collapse in={rollCallExpandedFilters.sessions}>
                              <Box sx={{ maxHeight: 120, overflowY: 'auto' }}>
                                {rollCallAvailableFilters.session_filters.map((f) => {
                                  const isSelected = rollCallSelectedFilters.sessions.has(f.session);
                                  return (
                                    <Box
                                      key={f.session}
                                      onClick={() => setRollCallSelectedFilters((prev) => {
                                        const next = new Set(prev.sessions);
                                        if (next.has(f.session)) next.delete(f.session); else next.add(f.session);
                                        return { ...prev, sessions: next };
                                      })}
                                      sx={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, px: 1, cursor: 'pointer',
                                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                        borderRadius: 1,
                                      }}
                                    >
                                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{f.session}</Typography>
                                      <Chip size="small" label={f.count} sx={{ height: 20, fontSize: '0.7rem' }} />
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Collapse>
                          </Box>
                        )}
                        {rollCallSearchIndex === 'SEARCH#VOTE' && rollCallAvailableFilters.politician_filters.length > 0 && (
                          <Box sx={{ mb: 1.5 }}>
                            <Box
                              onClick={() => setRollCallExpandedFilters((p) => ({ ...p, politicians: !p.politicians }))}
                              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', py: 0.5 }}
                            >
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Politician</Typography>
                              {rollCallExpandedFilters.politicians ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                            </Box>
                            <Collapse in={rollCallExpandedFilters.politicians}>
                              <Box sx={{ maxHeight: 180, overflowY: 'auto' }}>
                                {rollCallAvailableFilters.politician_filters.slice(0, 30).map((f) => {
                                  const isSelected = rollCallSelectedFilters.politicians.has(f.politician);
                                  return (
                                    <Box
                                      key={f.politician}
                                      onClick={() => setRollCallSelectedFilters((prev) => {
                                        const next = new Set(prev.politicians);
                                        if (next.has(f.politician)) next.delete(f.politician); else next.add(f.politician);
                                        return { ...prev, politicians: next };
                                      })}
                                      sx={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, px: 1, cursor: 'pointer',
                                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                        borderRadius: 1,
                                      }}
                                    >
                                      <Typography variant="body2" sx={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{f.politician}</Typography>
                                      <Chip size="small" label={f.count} sx={{ height: 20, fontSize: '0.7rem' }} />
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Collapse>
                          </Box>
                        )}
                        <Button
                          size="small"
                          onClick={() => setRollCallSelectedFilters({ congresses: new Set(), sessions: new Set(), politicians: new Set(), voteTypes: new Set() })}
                          sx={{ mt: 1, color: '#94a3b8', fontSize: '0.75rem' }}
                        >
                          Clear filters
                        </Button>
                      </>
                    )}
                  </GlassCard>
                </Box>
                  )}
                  {rollCallSearchIndex === 'SEARCH#VOTE' && rollCallResultView === 'bills' && voteBillFlattenedRows.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 3, flex: 1, minWidth: 0 }}>
                    {voteBillFilteredRows.length > 0 ? (
                    <GlassCard sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Box sx={{ p: 3 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Tooltip title="Select columns to display">
                              <IconButton onClick={(e) => setVoteBillColumnMenuAnchor(e.currentTarget)} sx={{ color: '#94a3b8' }} size="small">
                                <ViewColumnIcon />
                              </IconButton>
                            </Tooltip>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <Tooltip title={selectedVoteBills.size > 0 ? `Add ${selectedVoteBills.size} bill(s) to context` : 'Select bills to add to context'}>
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => { if (selectedVoteBills.size > 0) handleVoteBillAddToContext(); else alert('Please select at least one bill'); }}
                                  disabled={selectedVoteBills.size === 0}
                                  sx={{ color: selectedVoteBills.size > 0 ? '#10b981' : '#9ca3af', '&:hover': { color: '#10b981' }, '&:disabled': { color: '#4b5563' } }}
                                >
                                  <AddToContextIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Chip
                              label={`${voteBillFilteredRows.length} bill${voteBillFilteredRows.length !== 1 ? 's' : ''} found`}
                              sx={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#86efac', border: '1px solid #22c55e', fontWeight: 600 }}
                            />
                            <FormControl size="small" sx={{ minWidth: 120, ml: 1 }}>
                              <InputLabel id="vote-bill-per-page-label" sx={{ color: '#9ca3af' }}>Per Page</InputLabel>
                              <Select
                                labelId="vote-bill-per-page-label"
                                value={voteBillPageSize}
                                label="Per Page"
                                onChange={(e) => { setVoteBillPageSize(Number(e.target.value)); setVoteBillCurrentPage(1); }}
                                sx={{ color: '#ffffff', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' }, '& .MuiSelect-icon': { color: '#9ca3af' } }}
                                MenuProps={{ PaperProps: { sx: { bgcolor: '#1f2937', border: '1px solid #374151' } } }}
                              >
                                <MenuItem value={10}>10</MenuItem>
                                <MenuItem value={25}>25</MenuItem>
                                <MenuItem value={50}>50</MenuItem>
                                <MenuItem value={100}>100</MenuItem>
                              </Select>
                            </FormControl>
                          </Box>
                        </Box>
                        <Menu
                          anchorEl={voteBillColumnMenuAnchor}
                          open={voteBillColumnMenuOpen}
                          onClose={() => setVoteBillColumnMenuAnchor(null)}
                          PaperProps={{ sx: { backgroundColor: 'rgba(15, 23, 42, 0.98)', border: '2px solid #374151', color: '#ffffff' } }}
                        >
                          {AVAILABLE_VOTE_BILL_COLUMNS.map((col) => (
                            <MenuItem
                              key={col}
                              onClick={() => setVisibleVoteBillColumns((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])}
                              sx={{ color: visibleVoteBillColumns.includes(col) ? '#3b82f6' : '#94a3b8' }}
                            >
                              <Checkbox checked={visibleVoteBillColumns.includes(col)} sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }} />
                              {col.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                            </MenuItem>
                          ))}
                        </Menu>
                        <TableContainer
                          sx={{
                            '&::-webkit-scrollbar': { width: 6 },
                            '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' },
                            '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 },
                            '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' },
                          }}
                        >
                          <Table size="small" stickyHeader>
                            <TableHead>
                              <TableRow>
                                <TableCell padding="none" sx={{ width: 40, padding: '8px 4px', color: '#94a3b8', borderColor: '#374151' }}>
                                  <Checkbox
                                    size="small"
                                    indeterminate={selectedVoteBills.size > 0 && selectedVoteBills.size < voteBillPaginatedRows.length}
                                    checked={voteBillPaginatedRows.length > 0 && voteBillPaginatedRows.every((r) => selectedVoteBills.has(r.bill_id))}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedVoteBills((prev) => {
                                          const next = new Set(prev);
                                          voteBillPaginatedRows.forEach((r) => next.add(r.bill_id));
                                          return next;
                                        });
                                      } else {
                                        setSelectedVoteBills((prev) => {
                                          const next = new Set(prev);
                                          voteBillPaginatedRows.forEach((r) => next.delete(r.bill_id));
                                          return next;
                                        });
                                      }
                                    }}
                                    sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                                  />
                                </TableCell>
                                {visibleVoteBillColumns.includes('bill_title') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Bill Title</TableCell>}
                                {visibleVoteBillColumns.includes('bill_type') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Bill Type</TableCell>}
                                {visibleVoteBillColumns.includes('bill_number') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Bill Number</TableCell>}
                                {visibleVoteBillColumns.includes('sponsor_name') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Sponsor</TableCell>}
                                {visibleVoteBillColumns.includes('sponsor_party') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Party</TableCell>}
                                {visibleVoteBillColumns.includes('sponsor_state') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>State</TableCell>}
                                {visibleVoteBillColumns.includes('introduced_date') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Introduced Date</TableCell>}
                                {visibleVoteBillColumns.includes('latest_action_date') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Latest Action</TableCell>}
                                {visibleVoteBillColumns.includes('congress') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Congress</TableCell>}
                                {visibleVoteBillColumns.includes('bipartisan') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Bipartisan</TableCell>}
                                {visibleVoteBillColumns.includes('policy_area') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Policy Area</TableCell>}
                                {visibleVoteBillColumns.includes('bill_id') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Bill ID</TableCell>}
                                {visibleVoteBillColumns.includes('vote') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Vote</TableCell>}
                                {visibleVoteBillColumns.includes('latest_action') && <TableCell sx={{ color: '#94a3b8', borderColor: '#374151', fontWeight: 600 }}>Latest Action</TableCell>}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {voteBillPaginatedRows.map((row, idx) => {
                                const details = rollCallBillDetails[row.bill_id];
                                const billForDialog = { bill_id: row.bill_id, bill_title: details?.bill_title, congress: row.congress, latest_action_text: details?.latest_action_text, latest_action_date: details?.latest_action_date };
                                const globalIndex = voteBillStartIndex + idx;
                                const isSelected = selectedVoteBills.has(row.bill_id);
                                return (
                                  <TableRow
                                    key={row.rowKey}
                                    onClick={(e) => handleVoteBillClick(e, row.bill_id, globalIndex)}
                                    onContextMenu={(e) => handleVoteBillRowContextMenu(e, row.bill_id)}
                                    draggable={isSelected}
                                    onDragStart={(e) => handleVoteBillDragStart(e, row.bill_id)}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      if (user?.id) openItemDetails('congress_bill', billForDialog, details?.bill_title || row.bill_id, { user_id: user.id });
                                    }}
                                    sx={{
                                      backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                      '&:hover': { backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)' },
                                      cursor: 'pointer',
                                      userSelect: 'none',
                                    }}
                                  >
                                    <TableCell sx={{ width: 40, padding: '8px 4px', borderColor: '#374151' }} />
                                    {visibleVoteBillColumns.includes('bill_title') && (
                                      <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151', maxWidth: 360 }}>
                                        <Tooltip title={details?.bill_title || row.bill_id} disableHoverListener={!details?.bill_title}>
                                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{details?.bill_title || row.bill_id}</span>
                                        </Tooltip>
                                      </TableCell>
                                    )}
                                    {visibleVoteBillColumns.includes('bill_type') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{details?.bill_type ?? '—'}</TableCell>}
                                    {visibleVoteBillColumns.includes('bill_number') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{details?.bill_number ?? '—'}</TableCell>}
                                    {visibleVoteBillColumns.includes('sponsor_name') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{details?.sponsor_full_name ?? '—'}</TableCell>}
                                    {visibleVoteBillColumns.includes('sponsor_party') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{details?.sponsor_party ?? '—'}</TableCell>}
                                    {visibleVoteBillColumns.includes('sponsor_state') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{details?.sponsor_state ?? '—'}</TableCell>}
                                    {visibleVoteBillColumns.includes('introduced_date') && (
                                      <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{formatDate(details?.introduced_date != null ? String(details.introduced_date) : undefined)}</TableCell>
                                    )}
                                    {visibleVoteBillColumns.includes('latest_action_date') && (
                                      <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{formatDate(details?.latest_action_date != null ? String(details.latest_action_date) : undefined) || (details?.latest_action_text ? details.latest_action_text.slice(0, 50) + (details.latest_action_text.length > 50 ? '…' : '') : '—')}</TableCell>
                                    )}
                                    {visibleVoteBillColumns.includes('congress') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{row.congress}</TableCell>}
                                    {visibleVoteBillColumns.includes('bipartisan') && (
                                      <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{details?.bipartisan === 1 ? 'Yes' : details?.bipartisan === 0 ? 'No' : '—'}</TableCell>
                                    )}
                                    {visibleVoteBillColumns.includes('policy_area') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{details?.policy_area ?? '—'}</TableCell>}
                                    {visibleVoteBillColumns.includes('bill_id') && <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>{row.bill_id}</TableCell>}
                                    {visibleVoteBillColumns.includes('vote') && (
                                      <TableCell sx={{ borderColor: '#374151' }}>
                                        <Chip
                                          size="small"
                                          label={row.voteType}
                                          sx={{
                                            backgroundColor: row.voteType === 'Yea' ? 'rgba(34, 197, 94, 0.2)' : row.voteType === 'Nay' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                                            color: row.voteType === 'Yea' ? '#86efac' : row.voteType === 'Nay' ? '#fca5a5' : '#d1d5db',
                                            fontWeight: 600,
                                            fontSize: '0.75rem',
                                          }}
                                        />
                                      </TableCell>
                                    )}
                                    {visibleVoteBillColumns.includes('latest_action') && (
                                      <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                                        {details?.latest_action_date ? new Date(details.latest_action_date).toLocaleDateString() : (details?.latest_action_text ? details.latest_action_text.slice(0, 50) + (details.latest_action_text.length > 50 ? '…' : '') : '—')}
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                        {voteBillTotalPages > 1 && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                            <Typography sx={{ color: '#94a3b8' }}>
                              Showing {voteBillStartIndex + 1}-{voteBillEndIndex} of {voteBillFilteredRows.length} results
                            </Typography>
                            <Pagination
                              count={voteBillTotalPages}
                              page={voteBillCurrentPage}
                              onChange={(_, p) => setVoteBillCurrentPage(p)}
                              sx={{
                                '& .MuiPaginationItem-root': { color: '#94a3b8' },
                                '& .MuiPaginationItem-root.Mui-selected': { backgroundColor: '#3b82f6', color: '#fff' },
                              }}
                            />
                          </Box>
                        )}
                      </Box>
                    </GlassCard>
                    ) : (
                      <Typography sx={{ color: '#94a3b8', py: 2, flex: 1 }}>No bills match the selected filters.</Typography>
                    )}
                    {/* Vote bills Refine - match main bills Refine styling */}
                    <GlassCard sx={{ p: 2, minWidth: 280, maxWidth: 320, height: 'fit-content', alignSelf: 'flex-start' }}>
                      <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, mb: 2, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Refine search results by:
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#9ca3af', mb: 2, display: 'block', fontSize: '0.75rem' }}>
                        Click headings to show top filters.
                        <br />
                        Bill counts shown in <Chip label="#" size="small" sx={{ height: 18, fontSize: '0.7rem', backgroundColor: 'rgba(107, 114, 128, 0.3)', color: '#9ca3af', border: '1px solid #6b7280' }} />
                      </Typography>
                      {(billSelectedFilters.congresses.size > 0 || billSelectedFilters.voteTypes.size > 0 ||
                        billSelectedFilters.bill_types.size > 0 || billSelectedFilters.sponsor_parties.size > 0 ||
                        billSelectedFilters.sponsor_states.size > 0 || billSelectedFilters.policy_areas.size > 0 ||
                        billSelectedFilters.bipartisan.size > 0) && (
                        <Box sx={{ mb: 2, p: 2, backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid #3b82f6', borderRadius: '4px' }}>
                          <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600 }}>Selected Filters:</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                            {Array.from(billSelectedFilters.voteTypes).map((vt) => (
                              <Chip key={vt} label={vt} onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.voteTypes); n.delete(vt); return { ...prev, voteTypes: n }; })} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#93c5fd' } }} />
                            ))}
                            {Array.from(billSelectedFilters.congresses).map((c) => (
                              <Chip key={c} label={`Congress ${c}`} onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.congresses); n.delete(c); return { ...prev, congresses: n }; })} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#93c5fd' } }} />
                            ))}
                            {Array.from(billSelectedFilters.bill_types).map((bt) => (
                              <Chip key={bt} label={bt} onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.bill_types); n.delete(bt); return { ...prev, bill_types: n }; })} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#93c5fd' } }} />
                            ))}
                            {Array.from(billSelectedFilters.sponsor_parties).map((p) => (
                              <Chip key={p} label={p} onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.sponsor_parties); n.delete(p); return { ...prev, sponsor_parties: n }; })} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#93c5fd' } }} />
                            ))}
                            {Array.from(billSelectedFilters.sponsor_states).map((s) => (
                              <Chip key={s} label={s} onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.sponsor_states); n.delete(s); return { ...prev, sponsor_states: n }; })} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#93c5fd' } }} />
                            ))}
                            {Array.from(billSelectedFilters.policy_areas).map((a) => (
                              <Chip key={a} label={a} onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.policy_areas); n.delete(a); return { ...prev, policy_areas: n }; })} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#93c5fd' } }} />
                            ))}
                            {Array.from(billSelectedFilters.bipartisan).map((b) => (
                              <Chip key={b} label={b === 1 ? 'Bipartisan' : 'Not bipartisan'} onDelete={() => setBillSelectedFilters((prev) => { const n = new Set(prev.bipartisan); n.delete(b); return { ...prev, bipartisan: n }; })} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6', '& .MuiChip-deleteIcon': { color: '#93c5fd' } }} />
                            ))}
                          </Box>
                          <Button size="small" onClick={() => setBillSelectedFilters({ congresses: new Set(), voteTypes: new Set(), bill_types: new Set(), sponsor_parties: new Set(), sponsor_states: new Set(), policy_areas: new Set(), bipartisan: new Set() })} sx={{ color: '#94a3b8', fontSize: '0.75rem' }}>Clear All Filters</Button>
                        </Box>
                      )}
                      {(billAvailableFilters.congress_filters.length > 0 || billAvailableFilters.vote_type_filters.length > 0 ||
                        billAvailableFilters.bill_type_filters.length > 0 || billAvailableFilters.sponsor_party_filters.length > 0 ||
                        billAvailableFilters.sponsor_state_filters.length > 0 || billAvailableFilters.policy_area_filters.length > 0 ||
                        billAvailableFilters.bipartisan_filters.length > 0) && (
                        <>
                          {billAvailableFilters.vote_type_filters.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Box onClick={() => setBillExpandedFilters((p) => ({ ...p, voteTypes: !p.voteTypes }))} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', p: 1.5, backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px', '&:hover': { backgroundColor: 'rgba(55, 65, 81, 0.5)' } }}>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>Vote</Typography>
                                {billExpandedFilters.voteTypes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                              </Box>
                              <Collapse in={billExpandedFilters.voteTypes}>
                                <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 } }}>
                                  {billAvailableFilters.vote_type_filters.map((f) => {
                                    const isSelected = billSelectedFilters.voteTypes.has(f.voteType);
                                    return (
                                      <Box key={f.voteType} onClick={() => setBillSelectedFilters((prev) => { const n = new Set(prev.voteTypes); if (n.has(f.voteType)) n.delete(f.voteType); else n.add(f.voteType); return { ...prev, voteTypes: n }; })} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, cursor: 'pointer', borderRadius: '4px', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: isSelected ? '1px solid #3b82f6' : '1px solid transparent', '&:hover': { backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)' } }}>
                                        <Typography variant="body2" sx={{ color: isSelected ? '#93c5fd' : '#ffffff', flex: 1, fontWeight: isSelected ? 600 : 400 }}>{f.voteType}</Typography>
                                        <Chip label={f.count} size="small" sx={{ height: 20, fontSize: '0.7rem', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)', color: isSelected ? '#93c5fd' : '#9ca3af', border: isSelected ? '1px solid #3b82f6' : '1px solid #6b7280' }} />
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Collapse>
                            </Box>
                          )}
                          {billAvailableFilters.bill_type_filters.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Box onClick={() => setBillExpandedFilters((p) => ({ ...p, billTypes: !p.billTypes }))} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', p: 1.5, backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px', '&:hover': { backgroundColor: 'rgba(55, 65, 81, 0.5)' } }}>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>Bill Types</Typography>
                                {billExpandedFilters.billTypes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                              </Box>
                              <Collapse in={billExpandedFilters.billTypes}>
                                <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 } }}>
                                  {billAvailableFilters.bill_type_filters.map((f) => {
                                    const isSelected = billSelectedFilters.bill_types.has(f.billType);
                                    return (
                                      <Box key={f.billType} onClick={() => setBillSelectedFilters((prev) => { const n = new Set(prev.bill_types); if (n.has(f.billType)) n.delete(f.billType); else n.add(f.billType); return { ...prev, bill_types: n }; })} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, cursor: 'pointer', borderRadius: '4px', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: isSelected ? '1px solid #3b82f6' : '1px solid transparent', '&:hover': { backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)' } }}>
                                        <Typography variant="body2" sx={{ color: isSelected ? '#93c5fd' : '#ffffff', flex: 1, fontWeight: isSelected ? 600 : 400 }}>{f.billType}</Typography>
                                        <Chip label={f.count} size="small" sx={{ height: 20, fontSize: '0.7rem', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)', color: isSelected ? '#93c5fd' : '#9ca3af', border: isSelected ? '1px solid #3b82f6' : '1px solid #6b7280' }} />
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Collapse>
                            </Box>
                          )}
                          {billAvailableFilters.sponsor_party_filters.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Box onClick={() => setBillExpandedFilters((p) => ({ ...p, sponsorParties: !p.sponsorParties }))} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', p: 1.5, backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px', '&:hover': { backgroundColor: 'rgba(55, 65, 81, 0.5)' } }}>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>Sponsor Parties</Typography>
                                {billExpandedFilters.sponsorParties ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                              </Box>
                              <Collapse in={billExpandedFilters.sponsorParties}>
                                <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 } }}>
                                  {billAvailableFilters.sponsor_party_filters.map((f) => {
                                    const isSelected = billSelectedFilters.sponsor_parties.has(f.party);
                                    return (
                                      <Box key={f.party} onClick={() => setBillSelectedFilters((prev) => { const n = new Set(prev.sponsor_parties); if (n.has(f.party)) n.delete(f.party); else n.add(f.party); return { ...prev, sponsor_parties: n }; })} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, cursor: 'pointer', borderRadius: '4px', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: isSelected ? '1px solid #3b82f6' : '1px solid transparent', '&:hover': { backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)' } }}>
                                        <Typography variant="body2" sx={{ color: isSelected ? '#93c5fd' : '#ffffff', flex: 1, fontWeight: isSelected ? 600 : 400 }}>{f.party}</Typography>
                                        <Chip label={f.count} size="small" sx={{ height: 20, fontSize: '0.7rem', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)', color: isSelected ? '#93c5fd' : '#9ca3af', border: isSelected ? '1px solid #3b82f6' : '1px solid #6b7280' }} />
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Collapse>
                            </Box>
                          )}
                          {billAvailableFilters.sponsor_state_filters.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Box onClick={() => setBillExpandedFilters((p) => ({ ...p, sponsorStates: !p.sponsorStates }))} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', p: 1.5, backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px', '&:hover': { backgroundColor: 'rgba(55, 65, 81, 0.5)' } }}>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>Sponsor States</Typography>
                                {billExpandedFilters.sponsorStates ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                              </Box>
                              <Collapse in={billExpandedFilters.sponsorStates}>
                                <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 } }}>
                                  {billAvailableFilters.sponsor_state_filters.map((f) => {
                                    const isSelected = billSelectedFilters.sponsor_states.has(f.state);
                                    return (
                                      <Box key={f.state} onClick={() => setBillSelectedFilters((prev) => { const n = new Set(prev.sponsor_states); if (n.has(f.state)) n.delete(f.state); else n.add(f.state); return { ...prev, sponsor_states: n }; })} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, cursor: 'pointer', borderRadius: '4px', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: isSelected ? '1px solid #3b82f6' : '1px solid transparent', '&:hover': { backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)' } }}>
                                        <Typography variant="body2" sx={{ color: isSelected ? '#93c5fd' : '#ffffff', flex: 1, fontWeight: isSelected ? 600 : 400 }}>{f.state}</Typography>
                                        <Chip label={f.count} size="small" sx={{ height: 20, fontSize: '0.7rem', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)', color: isSelected ? '#93c5fd' : '#9ca3af', border: isSelected ? '1px solid #3b82f6' : '1px solid #6b7280' }} />
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Collapse>
                            </Box>
                          )}
                          {billAvailableFilters.policy_area_filters.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Box onClick={() => setBillExpandedFilters((p) => ({ ...p, policyAreas: !p.policyAreas }))} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', p: 1.5, backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px', '&:hover': { backgroundColor: 'rgba(55, 65, 81, 0.5)' } }}>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>Policy Areas</Typography>
                                {billExpandedFilters.policyAreas ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                              </Box>
                              <Collapse in={billExpandedFilters.policyAreas}>
                                <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 } }}>
                                  {billAvailableFilters.policy_area_filters.map((f) => {
                                    const isSelected = billSelectedFilters.policy_areas.has(f.area);
                                    return (
                                      <Box key={f.area} onClick={() => setBillSelectedFilters((prev) => { const n = new Set(prev.policy_areas); if (n.has(f.area)) n.delete(f.area); else n.add(f.area); return { ...prev, policy_areas: n }; })} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, cursor: 'pointer', borderRadius: '4px', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: isSelected ? '1px solid #3b82f6' : '1px solid transparent', '&:hover': { backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)' } }}>
                                        <Typography variant="body2" sx={{ color: isSelected ? '#93c5fd' : '#ffffff', flex: 1, fontWeight: isSelected ? 600 : 400 }}>{f.area}</Typography>
                                        <Chip label={f.count} size="small" sx={{ height: 20, fontSize: '0.7rem', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)', color: isSelected ? '#93c5fd' : '#9ca3af', border: isSelected ? '1px solid #3b82f6' : '1px solid #6b7280' }} />
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Collapse>
                            </Box>
                          )}
                          {billAvailableFilters.congress_filters.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Box onClick={() => setBillExpandedFilters((p) => ({ ...p, congresses: !p.congresses }))} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', p: 1.5, backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px', '&:hover': { backgroundColor: 'rgba(55, 65, 81, 0.5)' } }}>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>Congress</Typography>
                                {billExpandedFilters.congresses ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                              </Box>
                              <Collapse in={billExpandedFilters.congresses}>
                                <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 } }}>
                                  {billAvailableFilters.congress_filters.map((f) => {
                                    const isSelected = billSelectedFilters.congresses.has(f.congress);
                                    return (
                                      <Box key={f.congress} onClick={() => setBillSelectedFilters((prev) => { const n = new Set(prev.congresses); if (n.has(f.congress)) n.delete(f.congress); else n.add(f.congress); return { ...prev, congresses: n }; })} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, cursor: 'pointer', borderRadius: '4px', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: isSelected ? '1px solid #3b82f6' : '1px solid transparent', '&:hover': { backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)' } }}>
                                        <Typography variant="body2" sx={{ color: isSelected ? '#93c5fd' : '#ffffff', flex: 1, fontWeight: isSelected ? 600 : 400 }}>{f.congress}</Typography>
                                        <Chip label={f.count} size="small" sx={{ height: 20, fontSize: '0.7rem', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)', color: isSelected ? '#93c5fd' : '#9ca3af', border: isSelected ? '1px solid #3b82f6' : '1px solid #6b7280' }} />
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Collapse>
                            </Box>
                          )}
                          {billAvailableFilters.bipartisan_filters.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Box onClick={() => setBillExpandedFilters((p) => ({ ...p, bipartisan: !p.bipartisan }))} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', p: 1.5, backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px', '&:hover': { backgroundColor: 'rgba(55, 65, 81, 0.5)' } }}>
                                <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>Bipartisan</Typography>
                                {billExpandedFilters.bipartisan ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                              </Box>
                              <Collapse in={billExpandedFilters.bipartisan}>
                                <Box sx={{ mt: 1, maxHeight: 300, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' }, '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: 3 } }}>
                                  {billAvailableFilters.bipartisan_filters.map((f) => {
                                    const isSelected = billSelectedFilters.bipartisan.has(f.bipartisan);
                                    return (
                                      <Box key={f.bipartisan} onClick={() => setBillSelectedFilters((prev) => { const n = new Set(prev.bipartisan); if (n.has(f.bipartisan)) n.delete(f.bipartisan); else n.add(f.bipartisan); return { ...prev, bipartisan: n }; })} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, cursor: 'pointer', borderRadius: '4px', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: isSelected ? '1px solid #3b82f6' : '1px solid transparent', '&:hover': { backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.1)' } }}>
                                        <Typography variant="body2" sx={{ color: isSelected ? '#93c5fd' : '#ffffff', flex: 1, fontWeight: isSelected ? 600 : 400 }}>{f.bipartisan === 1 ? 'Yes' : 'No'}</Typography>
                                        <Chip label={f.count} size="small" sx={{ height: 20, fontSize: '0.7rem', backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)', color: isSelected ? '#93c5fd' : '#9ca3af', border: isSelected ? '1px solid #3b82f6' : '1px solid #6b7280' }} />
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Collapse>
                            </Box>
                          )}
                        </>
                      )}
                    </GlassCard>
                    </Box>
                  )}
                </Box>
              ) : null}
              {rollCallFlattenedRows.length > 0 && rollCallFilteredRows.length === 0 && (
                <Typography sx={{ color: '#94a3b8', py: 2 }}>No roll calls match the selected filters.</Typography>
              )}
              {rollCallResults.length > 0 && rollCallFilteredRows.length > 0 && rollCallHasMore && (
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={rollCallLoading}
                      onClick={async () => {
                        if (!rollCallLastKey) return;
                        setRollCallLoading(true);
                        setRollCallError(null);
                        try {
                          const politicianNames = Array.isArray(rollCallPoliticianName) ? rollCallPoliticianName : [];
                          if (rollCallSearchIndex === 'SEARCH#VOTE' && politicianNames.length > 0) {
                            const politicianIds = politicianNames.map((name) => {
                              const p = politicianSuggestionsService.getAllPoliticians().find(x => x.fullName === name);
                              if (p?.bioguide_id) return p.bioguide_id;
                              return 'NAME#' + (name || '').replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unknown';
                            });
                            const res = await congressBillsSearchAPI.rollCallSearch({
                              search_index: 'SEARCH#VOTE',
                              politician_ids: politicianIds,
                              limit: 100,
                              last_evaluated_key: rollCallLastKey,
                            });
                            if (res.success && (res.results?.length ?? 0) > 0) {
                              setRollCallResults(prev => [...prev, ...(res.results || [])]);
                              setRollCallHasMore(res.has_more || false);
                              setRollCallLastKey(res.last_evaluated_key ?? null);
                              const details = (res as any).bill_details;
                              if (details && typeof details === 'object') {
                                setRollCallBillDetails(prev => ({ ...prev, ...details }));
                              }
                              const rollDates = (res as any).roll_dates;
                              if (rollDates && typeof rollDates === 'object') {
                                setRollCallRollDates(prev => ({ ...prev, ...rollDates }));
                              }
                            } else {
                              setRollCallHasMore(false);
                            }
                          } else if (rollCallSearchIndex === 'SEARCH#ROLL') {
                            const congressNum = rollCallCongress === '119' ? 119 : 119;
                            const rollNum = rollCallRoll.trim() ? parseInt(rollCallRoll.trim(), 10) : undefined;
                            const validRoll = typeof rollNum === 'number' && !isNaN(rollNum);
                            const res = await congressBillsSearchAPI.rollCallSearch({
                              search_index: 'SEARCH#ROLL',
                              congress: congressNum,
                              roll: validRoll ? rollNum : undefined,
                              limit: 100,
                              last_evaluated_key: rollCallLastKey,
                            });
                            if (res.success && (res.results?.length ?? 0) > 0) {
                              setRollCallResults(prev => [...prev, ...(res.results || [])]);
                              setRollCallHasMore(res.has_more || false);
                              setRollCallLastKey(res.last_evaluated_key ?? null);
                            } else {
                              setRollCallHasMore(false);
                            }
                          }
                        } catch (e: any) {
                          setRollCallError(e?.message || 'Load more failed');
                        } finally {
                          setRollCallLoading(false);
                        }
                      }}
                      sx={{ mt: 2 }}
                    >
                      Load more
                    </Button>
                  )}
              {!rollCallSearchIndex && !rollCallSearchMessage && !rollCallError && (
                <GlassCard sx={{ p: 4 }}>
                  <Typography sx={{ color: '#94a3b8' }}>
                    Search roll calls by Congress, session, and roll number, or by politician to see how they voted. Use the filters and click Search.
                  </Typography>
                </GlassCard>
              )}
            </Box>
          </Box>
        )}

        {/* Bills Search tab */}
        {activeTab === 'bills' && (
        <>
        {/* Main Layout: Search Filters (Left) | Results (Middle) | Client-side Filter Box (Right) */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Left Sidebar - Search Filters (Collapsible) */}
          {searchSidebarVisible ? (
            <GlassCard sx={{ 
              minWidth: 320, 
              maxWidth: 380,
              width: 320,
              height: 'fit-content',
              position: 'sticky',
              top: 20,
              alignSelf: 'flex-start',
              transition: 'all 0.3s ease-in-out',
            }}>
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    Search Filters
                  </Typography>
                  <IconButton
                    onClick={() => setSearchSidebarVisible(false)}
                    sx={{ color: '#94a3b8' }}
                    size="small"
                    title="Hide search filters"
                  >
                    <KeyboardArrowDownIcon sx={{ transform: 'rotate(-90deg)' }} />
                  </IconButton>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Politician Name - Free text multi-select with autocomplete */}
                  <Box data-tutorial="politician-search">
                  <MultiSelectField<string>
                    label="Politician Name"
                    selectedItems={(() => {
                      const names = Array.isArray(searchParams.politician_name) ? searchParams.politician_name : (searchParams.politician_name ? [searchParams.politician_name] : []);
                      if (!isPoliticianDataLoaded) return names;
                      
                      // Convert actual names to display format
                      return names.map(name => {
                        const politician = politicianSuggestionsService.getAllPoliticians().find(p => p.fullName === name);
                        return politician ? politician.displayText : name;
                      });
                    })()}
                    onItemsChange={(politicians) => {
                      // Extract actual names from display text
                      const actualNames = politicians.map(politicianDisplay => {
                        const nameMatch = politicianDisplay.match(/^([^(]+)/);
                        return nameMatch ? nameMatch[1].trim() : politicianDisplay;
                      });
                      setSearchParams((prev) => ({ ...prev, politician_name: actualNames }));
                    }}
                    suggestions={isPoliticianDataLoaded ? 
                      politicianSuggestionsService.getAllPoliticians().map(p => p.fullName) : 
                      []
                    }
                    onSearch={sponsorNameSearch}
                    renderItem={(politicianDisplay) => politicianDisplay}
                    renderOptionCustom={(politicianDisplay) => {
                      // Extract the name part for display while keeping full display text
                      const nameMatch = politicianDisplay.match(/^([^(]+)/);
                      const name = nameMatch ? nameMatch[1].trim() : politicianDisplay;
                      const details = politicianDisplay.replace(name, '').trim();
                      return (
                        <Box sx={{ width: '100%' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#ffffff', fontSize: '0.9rem' }}>
                            {name}
                          </Typography>
                          {details && (
                            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                              {details}
                            </Typography>
                          )}
                        </Box>
                      );
                    }}
                    getItemKey={(politician) => politician}
                    placeholder="Search politician names (sponsor or cosponsor)..."
                    allowCustomInput={false}
                    isLoading={!isPoliticianDataLoaded || sponsorNameLoading}
                  />
                  </Box>

                  {/* Bill Type - Dropdown multi-select - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box data-tutorial="bill-type">
                  <MultiSelectField<string>
                    label="Bill Type"
                    selectedItems={searchParams.bill_type || []}
                    onItemsChange={(types) => {
                      setSearchParams((prev) => ({ ...prev, bill_type: types }));
                    }}
                    suggestions={BILL_TYPES}
                    renderItem={(type) => type}
                    placeholder="Select bill types..."
                  />
                  </Box>
                  )}

                  {/* Introduced Date From */}
                  <Box data-tutorial="introduced-date" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label="Introduced Date From"
                    type="date"
                    value={searchParams.introduced_date_from || ''}
                    onChange={(e) => {
                      let dateValue = e.target.value || undefined;
                      // Validate: if date is before minimum, default to minimum
                      if (dateValue && dateValue < MIN_INTRODUCED_DATE) {
                        dateValue = MIN_INTRODUCED_DATE;
                      }
                      setSearchParams((prev) => ({
                        ...prev,
                        introduced_date_from: dateValue,
                      }));
                    }}
                    InputLabelProps={{
                      shrink: true,
                    }}
                    inputProps={{
                      min: MIN_INTRODUCED_DATE,
                    }}
                    fullWidth
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        '& fieldset': { borderColor: '#475569' },
                        '&:hover fieldset': { borderColor: '#64748b' },
                        '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                      },
                      '& .MuiInputLabel-root': { color: '#94a3b8' },
                    }}
                  />

                  {/* Introduced Date To */}
                  <TextField
                    label="Introduced Date To"
                    type="date"
                    value={searchParams.introduced_date_to || ''}
                    onChange={(e) => {
                      setSearchParams((prev) => ({
                        ...prev,
                        introduced_date_to: e.target.value || undefined,
                      }));
                    }}
                    InputLabelProps={{
                      shrink: true,
                    }}
                    fullWidth
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(30, 41, 59, 0.5)',
                        color: '#e2e8f0',
                        '& fieldset': { borderColor: '#475569' },
                        '&:hover fieldset': { borderColor: '#64748b' },
                        '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                      },
                      '& .MuiInputLabel-root': { color: '#94a3b8' },
                    }}
                  />
                  </Box>

                  {/* Policy Area - Dropdown multi-select with autocomplete - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box data-tutorial="policy-area">
                  <MultiSelectField<string>
                    label="Policy Area"
                    selectedItems={searchParams.policy_area || []}
                    onItemsChange={(areas) => {
                      setSearchParams((prev) => ({ ...prev, policy_area: areas }));
                    }}
                    suggestions={isPolicyAreaDataLoaded ? 
                      policyAreaSuggestionsService.getAllPolicyAreas().slice(0, 50) : 
                      []
                    }
                    onSearch={policyAreaSearch}
                    renderItem={(area) => area}
                    placeholder="Select policy areas..."
                    allowCustomInput={false}
                    isLoading={!isPolicyAreaDataLoaded}
                  />
                  </Box>
                  )}

                  {/* Only bills with roll call votes - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Checkbox
                      checked={searchParams.has_roll_call === 1}
                      onChange={(e) => {
                        setSearchParams((prev) => ({
                          ...prev,
                          has_roll_call: e.target.checked ? 1 : undefined,
                        }));
                      }}
                      sx={{
                        color: '#9ca3af',
                        '&.Mui-checked': { color: '#3b82f6' },
                        p: 0.5,
                      }}
                    />
                    <Typography sx={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                      Only bills with roll call votes
                    </Typography>
                  </Box>
                  )}

                  {/* Advanced Search Section - Hidden in easy mode */}
                  {!isEasyMode && (
                  <Box data-tutorial="advanced-search" sx={{ mt: 2, pt: 2, borderTop: '1px solid #374151' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="h6" sx={{ color: '#e2e8f0', fontSize: '1rem' }}>
                        Advanced Search
                      </Typography>
                      <IconButton
                        onClick={() => setAdvancedSearchExpanded(!advancedSearchExpanded)}
                        sx={{ color: '#94a3b8' }}
                        size="small"
                      >
                        {advancedSearchExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                      </IconButton>
                    </Box>
                    <Collapse in={advancedSearchExpanded}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {/* Politician Role - Checkbox Multiselect */}
                        <Box>
                          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1, fontSize: '0.875rem' }}>
                            Politician Role
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {['Sponsor', 'Cosponsor'].map((role) => {
                              const roleKey = role.toLowerCase() as 'sponsor' | 'cosponsor';
                              const currentRoles = Array.isArray(searchParams.politician_role) 
                                ? searchParams.politician_role.filter(r => r === 'sponsor' || r === 'cosponsor')
                                : [];
                              const isSelected = currentRoles.includes(roleKey);
                              return (
                                <Box
                                  key={role}
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    p: 1,
                                    borderRadius: '4px',
                                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                    border: isSelected ? '1px solid #3b82f6' : '1px solid #374151',
                                    cursor: 'pointer',
                                    '&:hover': {
                                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(55, 65, 81, 0.3)',
                                    },
                                  }}
                                  onClick={() => {
                                    console.log('🔵 Politician Role Checkbox Clicked:', {
                                      role: roleKey,
                                      isSelected,
                                      currentPoliticianRole: searchParams.politician_role,
                                      currentPoliticianRoleType: typeof searchParams.politician_role,
                                      currentPoliticianRoleIsArray: Array.isArray(searchParams.politician_role)
                                    });
                                    setSearchParams(prev => {
                                      const currentRoles = Array.isArray(prev.politician_role) 
                                        ? prev.politician_role.filter(r => r === 'sponsor' || r === 'cosponsor')
                                        : [];
                                      console.log('🔵 Before update - currentRoles:', currentRoles);
                                      if (isSelected) {
                                        const newRoles = currentRoles.filter(r => r !== roleKey);
                                        console.log('🔵 Unselecting - newRoles:', newRoles);
                                        const result = { ...prev, politician_role: newRoles };
                                        console.log('🔵 After unselect - result.politician_role:', result.politician_role);
                                        return result;
                                      } else {
                                        const newRoles = [...currentRoles, roleKey];
                                        console.log('🔵 Selecting - newRoles:', newRoles);
                                        const result = { ...prev, politician_role: newRoles };
                                        console.log('🔵 After select - result.politician_role:', result.politician_role);
                                        return result;
                                      }
                                    });
                                  }}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    sx={{
                                      color: '#9ca3af',
                                      '&.Mui-checked': { color: '#3b82f6' },
                                      p: 0.5,
                                    }}
                                  />
                                  <Typography sx={{ color: '#ffffff', fontSize: '0.875rem', flex: 1 }}>
                                    {role}
                                  </Typography>
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>

                        {/* Exact Bill Title - Free text multi-select with autocomplete */}
                        <MultiSelectField<string>
                          label="Exact Bill Title"
                          selectedItems={searchParams.bill_title || []}
                          onItemsChange={(titles) => {
                            setSearchParams((prev) => ({ ...prev, bill_title: titles }));
                          }}
                          suggestions={billTitleSuggestions}
                          onSearch={billTitleSearch}
                          renderItem={(title) => title}
                          placeholder="Search bill titles..."
                          allowCustomInput={true}
                          isLoading={billTitleLoading}
                        />

                        {/* Sponsor Party - Dropdown multi-select */}
                        <MultiSelectField<string>
                          label="Sponsor Party"
                          selectedItems={searchParams.sponsor_party || []}
                          onItemsChange={(parties) => {
                            setSearchParams((prev) => ({ ...prev, sponsor_party: parties }));
                          }}
                          suggestions={PARTIES}
                          renderItem={(party) => party}
                          placeholder="Select parties..."
                        />

                        {/* Sponsor State - Dropdown multi-select */}

                        {/* Bipartisan - Dropdown single-select */}
                        <FormControl fullWidth>
                          <InputLabel sx={{ color: '#94a3b8' }}>Bipartisan</InputLabel>
                          <Select
                            value={searchParams.bipartisan !== undefined ? searchParams.bipartisan : ''}
                            onChange={(e) => {
                              setSearchParams((prev) => ({
                                ...prev,
                                bipartisan: e.target.value === '' ? undefined : Number(e.target.value),
                              }));
                            }}
                            label="Bipartisan"
                            sx={{
                              backgroundColor: 'rgba(30, 41, 59, 0.5)',
                              color: '#e2e8f0',
                              '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#64748b' },
                              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                            }}
                          >
                            <MenuItem value="">All</MenuItem>
                            {BIPARTISAN_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>
                                {option.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        {/* Bill Number - Number input */}
                        <TextField
                          label="Bill Number"
                          type="number"
                          value={searchParams.bill_number || ''}
                          onChange={(e) => {
                            setSearchParams((prev) => ({
                              ...prev,
                              bill_number: e.target.value ? Number(e.target.value) : undefined,
                            }));
                          }}
                          fullWidth
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              backgroundColor: 'rgba(30, 41, 59, 0.5)',
                              color: '#e2e8f0',
                              '& fieldset': { borderColor: '#475569' },
                              '&:hover fieldset': { borderColor: '#64748b' },
                              '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                            },
                            '& .MuiInputLabel-root': { color: '#94a3b8' },
                          }}
                        />

                        {/* Latest Action Date From */}
                        <TextField
                          label="Latest Action Date From"
                          type="date"
                          value={searchParams.latest_action_date_from || ''}
                          onChange={(e) => {
                            setSearchParams((prev) => ({
                              ...prev,
                              latest_action_date_from: e.target.value || undefined,
                            }));
                          }}
                          InputLabelProps={{
                            shrink: true,
                          }}
                          fullWidth
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              backgroundColor: 'rgba(30, 41, 59, 0.5)',
                              color: '#e2e8f0',
                              '& fieldset': { borderColor: '#475569' },
                              '&:hover fieldset': { borderColor: '#64748b' },
                              '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                            },
                            '& .MuiInputLabel-root': { color: '#94a3b8' },
                          }}
                        />

                        {/* Latest Action Date To */}
                        <TextField
                          label="Latest Action Date To"
                          type="date"
                          value={searchParams.latest_action_date_to || ''}
                          onChange={(e) => {
                            setSearchParams((prev) => ({
                              ...prev,
                              latest_action_date_to: e.target.value || undefined,
                            }));
                          }}
                          InputLabelProps={{
                            shrink: true,
                          }}
                          fullWidth
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              backgroundColor: 'rgba(30, 41, 59, 0.5)',
                              color: '#e2e8f0',
                              '& fieldset': { borderColor: '#475569' },
                              '&:hover fieldset': { borderColor: '#64748b' },
                              '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                            },
                            '& .MuiInputLabel-root': { color: '#94a3b8' },
                          }}
                        />
                      </Box>
                    </Collapse>
                  </Box>
                  )}

                  {/* Search and Clear Buttons */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
                    <Button
                      data-tutorial="search-button"
                      variant="contained"
                      onClick={handleSearch}
                      disabled={isSearching}
                      startIcon={isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
                      fullWidth
                      sx={{
                        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                        color: '#ffffff',
                        '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
                        '&:disabled': { backgroundColor: '#374151', color: '#6b7280' },
                      }}
                    >
                      {isSearching ? 'Searching...' : 'Search'}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setSearchParams({
                          bill_title: [] as string[],
                          bill_type: [] as string[],
                          politician_name: [] as string[],
                          politician_role: [] as ('sponsor' | 'cosponsor')[],
                          introduced_date_from: '',
                          introduced_date_to: '',
                          policy_area: [] as string[],
                          sponsor_party: [] as string[],
                          sponsor_state: [] as string[],
                          congress: [] as number[],
                          latest_action_date_from: '',
                          latest_action_date_to: '',
                          bipartisan: undefined,
                          bill_number: undefined,
                          has_roll_call: undefined,
                        });
                      }}
                      fullWidth
                      sx={{
                        borderColor: '#475569',
                        color: '#94a3b8',
                        '&:hover': { borderColor: '#64748b', backgroundColor: 'rgba(71, 85, 105, 0.1)' },
                      }}
                    >
                      Clear
                    </Button>
                  </Box>
                </Box>
            </Box>
          </GlassCard>
          ) : (
            <Box sx={{ 
              position: 'sticky',
              top: 20,
              alignSelf: 'flex-start',
              height: 'fit-content',
            }}>
              <IconButton
                onClick={() => setSearchSidebarVisible(true)}
                sx={{
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  border: '2px solid #374151',
                  borderRadius: '50%',
                  width: 48,
                  height: 48,
                  color: '#3b82f6',
                  '&:hover': {
                    backgroundColor: 'rgba(15, 23, 42, 0.98)',
                    borderColor: '#3b82f6',
                    transform: 'scale(1.05)',
                  },
                  transition: 'all 0.3s ease-in-out',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                }}
                title="Show search filters"
              >
                <SearchIcon />
              </IconButton>
            </Box>
          )}

          {/* Middle - Results Table */}
          <Box sx={{ flex: 1, minWidth: 0, transition: 'flex 0.3s ease-in-out' }}>
            {/* Error Alert */}
            {searchError && (
              <Alert severity="error" sx={{ mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                {searchError}
              </Alert>
            )}

            {/* Results */}
            {allSearchResults.length > 0 ? (
              <GlassCard>
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Select columns to display">
                      <IconButton
                        onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
                        sx={{ color: '#94a3b8' }}
                        size="small"
                      >
                        <ViewColumnIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    {/* Add to Context Button */}
                    {currentResults.length > 0 && (
                      <Tooltip title={`Add ${selectedBills.size > 0 ? `${selectedBills.size} bill(s)` : 'selected bills'} to context`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              if (selectedBills.size === 0) {
                                alert('Please select at least one bill to add to context');
                                return;
                              }
                              setContextMenuAnchor(e.currentTarget);
                            }}
                            disabled={selectedBills.size === 0}
                            sx={{ 
                              color: selectedBills.size > 0 ? '#10b981' : '#9ca3af', 
                              '&:hover': { color: '#10b981' },
                              '&:disabled': { color: '#4b5563' }
                            }}
                          >
                            <AddToContextIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {currentResults.length > 0 ? (
                      <Chip
                        label={`${currentResults.length} bill${currentResults.length !== 1 ? 's' : ''} found`}
                        sx={{
                          backgroundColor: 'rgba(34, 197, 94, 0.2)',
                          color: '#86efac',
                          border: '1px solid #22c55e',
                          fontWeight: 600,
                        }}
                      />
                    ) : isFiltered && allSearchResults.length > 0 ? (
                      <Chip
                        label={`0 of ${allSearchResults.length} bills match filters`}
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : allSearchResults.length === 0 && !isSearching ? (
                      <Chip
                        label="No bills found"
                        sx={{
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#fca5a5',
                          border: '1px solid #ef4444',
                          fontWeight: 600,
                        }}
                      />
                    ) : null}
                    {currentResults.length > 0 && (
                      <>
                        <FormControl size="small" sx={{ minWidth: 120, ml: 1 }}>
                          <InputLabel id="results-per-page-label" sx={{ color: '#9ca3af' }}>Per Page</InputLabel>
                          <Select
                            labelId="results-per-page-label"
                            value={pageSize}
                            label="Per Page"
                            onChange={(e) => {
                              const newPageSize = Number(e.target.value);
                              setPageSize(newPageSize);
                              setCurrentPage(1);
                            }}
                            sx={{
                              color: '#ffffff',
                              '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' },
                              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                              '& .MuiSelect-icon': { color: '#9ca3af' },
                            }}
                            MenuProps={{
                              PaperProps: {
                                sx: {
                                  bgcolor: '#1f2937',
                                  border: '1px solid #374151',
                                  '& .MuiMenuItem-root': {
                                    color: '#ffffff',
                                    '&:hover': {
                                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                    },
                                    '&.Mui-selected': {
                                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                      '&:hover': {
                                        backgroundColor: 'rgba(59, 130, 246, 0.3)',
                                      },
                                    },
                                  },
                                  '&::-webkit-scrollbar': {
                                    width: '8px',
                                  },
                                  '&::-webkit-scrollbar-track': {
                                    backgroundColor: 'rgba(55, 65, 81, 0.3)',
                                    borderRadius: '4px',
                                  },
                                  '&::-webkit-scrollbar-thumb': {
                                    backgroundColor: '#3b82f6',
                                    borderRadius: '4px',
                                  },
                                  '&::-webkit-scrollbar-thumb:hover': {
                                    backgroundColor: '#2563eb',
                                  },
                                },
                              },
                            }}
                          >
                            <MenuItem value={10}>10</MenuItem>
                            <MenuItem value={25}>25</MenuItem>
                            <MenuItem value={50}>50</MenuItem>
                            <MenuItem value={100}>100</MenuItem>
                          </Select>
                        </FormControl>
                      </>
                    )}
                  </Box>
                </Box>

                  {/* Column Menu */}
                  <Menu
                    anchorEl={columnMenuAnchor}
                    open={columnMenuOpen}
                    onClose={() => setColumnMenuAnchor(null)}
                    PaperProps={{
                      sx: {
                        backgroundColor: 'rgba(15, 23, 42, 0.98)',
                        border: '2px solid #374151',
                        color: '#ffffff',
                      },
                    }}
                  >
                    {AVAILABLE_COLUMNS.map((column) => (
                      <MenuItem
                        key={column}
                        onClick={() => {
                          setVisibleColumns((prev) =>
                            prev.includes(column)
                              ? prev.filter((c) => c !== column)
                              : [...prev, column]
                          );
                        }}
                        sx={{
                          color: visibleColumns.includes(column) ? '#3b82f6' : '#94a3b8',
                        }}
                      >
                        <Checkbox
                          checked={visibleColumns.includes(column)}
                          sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                        />
                        {column.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </MenuItem>
                    ))}
                  </Menu>

                  <TableContainer data-tutorial="results-table"
              sx={{
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
                    <TableCell padding="none" sx={{ width: 40, padding: '8px 4px', color: '#94a3b8', borderColor: '#374151' }}>
                      <Checkbox
                        size="small"
                        indeterminate={selectedBills.size > 0 && selectedBills.size < paginatedResults.length}
                        checked={paginatedResults.length > 0 && selectedBills.size === paginatedResults.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBills(new Set(paginatedResults.map((b) => b.bill_id)));
                          } else {
                            setSelectedBills(new Set());
                          }
                        }}
                        sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
                      />
                    </TableCell>
                    {visibleColumns.includes('bill_title') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bill Title</TableCell>
                    )}
                    {visibleColumns.includes('bill_type') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bill Type</TableCell>
                    )}
                    {visibleColumns.includes('bill_number') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bill Number</TableCell>
                    )}
                    {visibleColumns.includes('sponsor_name') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Sponsor</TableCell>
                    )}
                    {visibleColumns.includes('sponsor_party') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Party</TableCell>
                    )}
                    {visibleColumns.includes('introduced_date') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Introduced Date</TableCell>
                    )}
                    {visibleColumns.includes('latest_action_date') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Latest Action</TableCell>
                    )}
                    {visibleColumns.includes('congress') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Congress</TableCell>
                    )}
                    {visibleColumns.includes('bipartisan') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Bipartisan</TableCell>
                    )}
                    {visibleColumns.includes('policy_area') && (
                      <TableCell sx={{ color: '#94a3b8', borderColor: '#374151' }}>Policy Area</TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                   {paginatedResults.map((bill, index) => {
                     // Use bill_id as key, but add index as fallback for uniqueness
                     const uniqueKey = bill.bill_id ? `${bill.bill_id}-${index}` : `bill-${index}`;
                     return (
                     <TableRow 
                       key={uniqueKey}
                       onClick={(e) => handleBillClick(e, bill.bill_id, index)}
                       onContextMenu={(e) => handleRowContextMenu(e, bill.bill_id)}
                       draggable={selectedBills.has(bill.bill_id)}
                       onDragStart={(e) => handleDragStart(e, bill.bill_id)}
                       onDoubleClick={(e) => {
                         e.stopPropagation();
                         if (user?.id) {
                           openItemDetails(
                             'congress_bill',
                             bill,
                             bill.bill_title,
                             { user_id: user.id }
                           );
                         }
                       }}
                       sx={{
                         backgroundColor: selectedBills.has(bill.bill_id) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                         '&:hover': {
                           backgroundColor: selectedBills.has(bill.bill_id) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                         },
                         cursor: 'pointer',
                         userSelect: 'none',
                       }}
                     >
                      {/* Empty cell to maintain alignment */}
                      <TableCell sx={{ width: 40, padding: '8px 4px', borderColor: '#374151' }} />
                      {visibleColumns.includes('bill_title') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bill_title || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('bill_type') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bill_type || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('bill_number') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bill_number || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('sponsor_name') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.sponsor_full_name || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('sponsor_party') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.sponsor_party || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('introduced_date') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {formatDate(bill.introduced_date)}
                        </TableCell>
                      )}
                      {visibleColumns.includes('latest_action_date') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {formatDate(bill.latest_action_date)}
                        </TableCell>
                      )}
                      {visibleColumns.includes('congress') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.congress || 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('bipartisan') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.bipartisan === 1 ? 'Yes' : bill.bipartisan === 0 ? 'No' : 'N/A'}
                        </TableCell>
                      )}
                      {visibleColumns.includes('policy_area') && (
                        <TableCell sx={{ color: '#e2e8f0', borderColor: '#374151' }}>
                          {bill.policy_area || 'N/A'}
                        </TableCell>
                      )}
                      {/* Details column removed - use double-click to open details */}
                    </TableRow>
                    );
                  })}
                </TableBody>
                  </Table>
                </TableContainer>

                {/* Load More Button */}
                {!isFiltered && hasMore && lastEvaluatedKey && allSearchResults.length > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                    <Button
                      variant="outlined"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      sx={{
                        color: '#3b82f6',
                        borderColor: '#3b82f6',
                        '&:hover': {
                          borderColor: '#60a5fa',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                        '&:disabled': {
                          borderColor: '#4b5563',
                          color: '#6b7280',
                        },
                      }}
                    >
                      {isLoadingMore ? (
                        <>
                          <CircularProgress size={20} sx={{ mr: 1 }} />
                          Loading...
                        </>
                      ) : (
                        `Load More (${allSearchResults.length} loaded)`
                      )}
                    </Button>
                  </Box>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
                    <Typography sx={{ color: '#94a3b8' }}>
                      Showing {startIndex + 1}-{Math.min(endIndex, resultsToDisplay.length)} of {resultsToDisplay.length} results
                    </Typography>
                    <Pagination
                      count={totalPages}
                      page={currentPage}
                      onChange={(_, page) => setCurrentPage(page)}
                      sx={{
                        '& .MuiPaginationItem-root': {
                          color: '#94a3b8',
                          '&.Mui-selected': {
                            backgroundColor: '#3b82f6',
                            color: '#fff',
                          },
                        },
                      }}
                    />
                  </Box>
                )}
              </Box>
            </GlassCard>
            ) : (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Typography variant="h6" sx={{ color: '#9ca3af', mb: 2 }}>
                  No results found
                </Typography>
                <Typography variant="body2" sx={{ color: '#6b7280' }}>
                  Try adjusting your search filters
                </Typography>
              </Box>
            )}
          </Box>

          {/* Right Sidebar - Client-side Filter Box (Only when results exist) */}
          {allSearchResults.length > 0 && (
            <GlassCard sx={{ 
              p: 2, 
              minWidth: 280, 
              maxWidth: 320,
              height: 'fit-content',
              position: 'sticky',
              top: 20,
              alignSelf: 'flex-start',
            }}>
              <Typography
                variant="h6"
                sx={{
                  color: '#ffffff',
                  fontWeight: 600,
                  mb: 2,
                  fontSize: '1rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Refine search results by:
              </Typography>
              
              <Typography
                variant="caption"
                sx={{
                  color: '#9ca3af',
                  mb: 2,
                  display: 'block',
                  fontSize: '0.75rem',
                }}
              >
                Click headings to show top filters.
                <br />
                Bill counts shown in <Chip label="#" size="small" sx={{ 
                  height: 18, 
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(107, 114, 128, 0.3)',
                  color: '#9ca3af',
                  border: '1px solid #6b7280',
                }} />
              </Typography>

              {/* Selected Filters Box */}
              {(selectedFilters.bill_types.size > 0 ||
                selectedFilters.sponsor_parties.size > 0 ||
                selectedFilters.policy_areas.size > 0 ||
                selectedFilters.congresses.size > 0 ||
                selectedFilters.bipartisan.size > 0) && (
                <Box sx={{ 
                  mb: 2, 
                  p: 2, 
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                }}>
                  <Typography variant="subtitle2" sx={{ color: '#93c5fd', mb: 1.5, fontWeight: 600 }}>
                    Selected Filters:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                    {Array.from(selectedFilters.bill_types).map((type, idx) => (
                      <Chip
                        key={`bill-type-${idx}`}
                        label={type}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.bill_types);
                            newSet.delete(type);
                            const hasAnyFilters = 
                              newSet.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, bill_types: newSet };
                          });
                        }}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.sponsor_parties).map((party, idx) => (
                      <Chip
                        key={`sponsor-party-${idx}`}
                        label={party}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.sponsor_parties);
                            newSet.delete(party);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              newSet.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, sponsor_parties: newSet };
                          });
                        }}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.sponsor_states).map((state, idx) => (
                      <Chip
                        key={`sponsor-state-${idx}`}
                        label={state}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.sponsor_states);
                            newSet.delete(state);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              newSet.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, sponsor_states: newSet };
                          });
                        }}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.policy_areas).map((area, idx) => (
                      <Chip
                        key={`policy-area-${idx}`}
                        label={area}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.policy_areas);
                            newSet.delete(area);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              newSet.size > 0 ||
                              prev.congresses.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, policy_areas: newSet };
                          });
                        }}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.congresses).map((congress, idx) => (
                      <Chip
                        key={`congress-${idx}`}
                        label={`Congress ${congress}`}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.congresses);
                            newSet.delete(congress);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              newSet.size > 0 ||
                              prev.bipartisan.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, congresses: newSet };
                          });
                        }}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                    {Array.from(selectedFilters.bipartisan).map((bipartisan, idx) => (
                      <Chip
                        key={`bipartisan-${idx}`}
                        label={bipartisan === 1 ? 'Bipartisan' : 'Not Bipartisan'}
                        onDelete={() => {
                          setSelectedFilters(prev => {
                            const newSet = new Set(prev.bipartisan);
                            newSet.delete(bipartisan);
                            const hasAnyFilters = 
                              prev.bill_types.size > 0 ||
                              prev.sponsor_parties.size > 0 ||
                              prev.sponsor_states.size > 0 ||
                              prev.policy_areas.size > 0 ||
                              prev.congresses.size > 0 ||
                              newSet.size > 0;
                            setIsFiltered(hasAnyFilters);
                            return { ...prev, bipartisan: newSet };
                          });
                        }}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': {
                            color: '#93c5fd',
                            '&:hover': { color: '#ffffff' },
                          },
                        }}
                      />
                    ))}
                  </Box>
                  <Button
                    size="small"
                    onClick={() => {
                      setSelectedFilters({
                        bill_types: new Set(),
                        sponsor_parties: new Set(),
                        sponsor_states: new Set(),
                        policy_areas: new Set(),
                        congresses: new Set(),
                        bipartisan: new Set(),
                        politician_roles: new Set(),
                      });
                      setIsFiltered(false);
                    }}
                    sx={{
                      color: '#93c5fd',
                      fontSize: '0.75rem',
                      textTransform: 'none',
                      mt: 1,
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      },
                    }}
                  >
                    Clear All Filters
                  </Button>
                </Box>
              )}

              {/* Bill Types Filter */}
              {availableFilters.bill_type_filters && availableFilters.bill_type_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, billTypes: !prev.billTypes }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Bill Types
                    </Typography>
                    {expandedFilters.billTypes ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.billTypes}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                    }}>
                      {availableFilters.bill_type_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.bill_types.has(filter.billType);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.bill_types.has(filter.billType);
                                if (exists) {
                                  const newSet = new Set(prev.bill_types);
                                  newSet.delete(filter.billType);
                                  return { ...prev, bill_types: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    bill_types: new Set([...prev.bill_types, filter.billType]),
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {filter.billType}
                            </Typography>
                            <Chip
                              label={filter.count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Sponsor Parties Filter */}
              {availableFilters.sponsor_party_filters && availableFilters.sponsor_party_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, sponsorParties: !prev.sponsorParties }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Sponsor Parties
                    </Typography>
                    {expandedFilters.sponsorParties ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.sponsorParties}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                    }}>
                      {availableFilters.sponsor_party_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.sponsor_parties.has(filter.party);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.sponsor_parties.has(filter.party);
                                if (exists) {
                                  const newSet = new Set(prev.sponsor_parties);
                                  newSet.delete(filter.party);
                                  return { ...prev, sponsor_parties: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    sponsor_parties: new Set([...prev.sponsor_parties, filter.party]),
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {filter.party}
                            </Typography>
                            <Chip
                              label={filter.count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Sponsor States Filter */}
              {availableFilters.sponsor_state_filters && availableFilters.sponsor_state_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, sponsorStates: !prev.sponsorStates }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Sponsor States
                    </Typography>
                    {expandedFilters.sponsorStates ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.sponsorStates}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                    }}>
                      {availableFilters.sponsor_state_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.sponsor_states.has(filter.state);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.sponsor_states.has(filter.state);
                                if (exists) {
                                  const newSet = new Set(prev.sponsor_states);
                                  newSet.delete(filter.state);
                                  return { ...prev, sponsor_states: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    sponsor_states: new Set([...prev.sponsor_states, filter.state]),
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {filter.state}
                            </Typography>
                            <Chip
                              label={filter.count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Policy Areas Filter */}
              {availableFilters.policy_area_filters && availableFilters.policy_area_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, policyAreas: !prev.policyAreas }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Policy Areas
                    </Typography>
                    {expandedFilters.policyAreas ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.policyAreas}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                    }}>
                      {availableFilters.policy_area_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.policy_areas.has(filter.area);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.policy_areas.has(filter.area);
                                if (exists) {
                                  const newSet = new Set(prev.policy_areas);
                                  newSet.delete(filter.area);
                                  return { ...prev, policy_areas: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    policy_areas: new Set([...prev.policy_areas, filter.area]),
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {filter.area}
                            </Typography>
                            <Chip
                              label={filter.count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Congress Filter */}
              {availableFilters.congress_filters && availableFilters.congress_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, congresses: !prev.congresses }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Congress
                    </Typography>
                    {expandedFilters.congresses ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.congresses}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                    }}>
                      {availableFilters.congress_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.congresses.has(filter.congress);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.congresses.has(filter.congress);
                                if (exists) {
                                  const newSet = new Set(prev.congresses);
                                  newSet.delete(filter.congress);
                                  return { ...prev, congresses: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    congresses: new Set([...prev.congresses, filter.congress]),
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              Congress {filter.congress}
                            </Typography>
                            <Chip
                              label={filter.count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Bipartisan Filter */}
              {availableFilters.bipartisan_filters && availableFilters.bipartisan_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, bipartisan: !prev.bipartisan }))}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1.5,
                      backgroundColor: 'rgba(55, 65, 81, 0.3)',
                      borderRadius: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(55, 65, 81, 0.5)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 600 }}>
                      Bipartisan
                    </Typography>
                    {expandedFilters.bipartisan ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.bipartisan}>
                    <Box sx={{ 
                      mt: 1, 
                      maxHeight: 300, 
                      overflowY: 'auto',
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
                    }}>
                      {availableFilters.bipartisan_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.bipartisan.has(filter.bipartisan);
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters(prev => {
                                const exists = prev.bipartisan.has(filter.bipartisan);
                                if (exists) {
                                  const newSet = new Set(prev.bipartisan);
                                  newSet.delete(filter.bipartisan);
                                  return { ...prev, bipartisan: newSet };
                                } else {
                                  return {
                                    ...prev,
                                    bipartisan: new Set([...prev.bipartisan, filter.bipartisan]),
                                  };
                                }
                              });
                              setIsFiltered(true);
                            }}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                              border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                              '&:hover': {
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            <Typography variant="body2" sx={{ 
                              color: isSelected ? '#93c5fd' : '#ffffff', 
                              fontSize: '0.875rem', 
                              flex: 1,
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {filter.bipartisan === 1 ? 'Bipartisan' : 'Not Bipartisan'}
                            </Typography>
                            <Chip
                              label={filter.count}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: isSelected 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(107, 114, 128, 0.3)',
                                color: isSelected ? '#93c5fd' : '#9ca3af',
                                border: isSelected 
                                  ? '1px solid #3b82f6' 
                                  : '1px solid #6b7280',
                              }}
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}
            </GlassCard>
          )}
        </Box>
        </>
        )}
      </Container>


      {/* Context Menu (main bills) */}
      <Menu
        anchorEl={contextMenuAnchor}
        anchorPosition={contextMenuPosition ? { top: contextMenuPosition.y, left: contextMenuPosition.x } : undefined}
        anchorReference={contextMenuPosition ? 'anchorPosition' : 'anchorEl'}
        open={Boolean(contextMenuAnchor || contextMenuPosition)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          }
        }}
      >
        <MenuItem
          onClick={handleAddToContext}
          disabled={selectedBills.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context {selectedBills.size > 0 ? `(${selectedBills.size} item${selectedBills.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
        <MenuItem
          onClick={handleAddToFiles}
          disabled={selectedBills.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files {selectedBills.size > 0 ? `(${selectedBills.size} item${selectedBills.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
      </Menu>

      {/* Context Menu (vote bills sub-tab) */}
      <Menu
        anchorPosition={voteBillContextMenuPosition ? { top: voteBillContextMenuPosition.y, left: voteBillContextMenuPosition.x } : undefined}
        anchorReference="anchorPosition"
        open={Boolean(voteBillContextMenuPosition)}
        onClose={handleVoteBillContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          }
        }}
      >
        <MenuItem
          onClick={handleVoteBillAddToContext}
          disabled={selectedVoteBills.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context {selectedVoteBills.size > 0 ? `(${selectedVoteBills.size} item${selectedVoteBills.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
        <MenuItem
          onClick={handleVoteBillAddToFiles}
          disabled={selectedVoteBills.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files {selectedVoteBills.size > 0 ? `(${selectedVoteBills.size} item${selectedVoteBills.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
      </Menu>

      {/* Context Menu (roll calls table) */}
      <Menu
        anchorPosition={rollCallContextMenuPosition ? { top: rollCallContextMenuPosition.y, left: rollCallContextMenuPosition.x } : undefined}
        anchorReference="anchorPosition"
        open={Boolean(rollCallContextMenuPosition)}
        onClose={handleRollCallContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #374151',
          }
        }}
      >
        <MenuItem
          onClick={handleRollCallAddToContext}
          disabled={selectedRollCalls.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <SidebarChatIcon sx={{ mr: 1, fontSize: 18, color: '#3b82f6' }} />
          Add to Context {selectedRollCalls.size > 0 ? `(${selectedRollCalls.size} item${selectedRollCalls.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
        <MenuItem
          onClick={handleRollCallAddToFiles}
          disabled={selectedRollCalls.size === 0}
          sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.2)' } }}
        >
          <FolderIcon sx={{ mr: 1, fontSize: 18, color: '#fbbf24' }} />
          Add to Files {selectedRollCalls.size > 0 ? `(${selectedRollCalls.size} item${selectedRollCalls.size > 1 ? 's' : ''})` : ''}
        </MenuItem>
      </Menu>
      
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => { setFileBrowserOpen(false); setFileBrowserFor(null); }}
        onSelect={(folderPath) => {
          if (fileBrowserFor === 'vote_bills') handleVoteBillFileBrowserSelect(folderPath);
          else if (fileBrowserFor === 'roll_calls') handleRollCallFileBrowserSelect(folderPath);
          else handleFileBrowserSelect(folderPath);
        }}
        allowCreateFolder={true}
        title="Save to Files"
      />
    </Box>
  );
};

export default CongressBillsSearchPage;
