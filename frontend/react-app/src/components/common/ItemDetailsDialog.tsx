import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  IconButton,
  Chip,
  Grid,
  Link,
  Tooltip,
  Paper,
  Portal,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Select,
  FormControl,
  InputLabel,
  MenuItem,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  OpenInNew as OpenInNewIcon,
  Launch as LaunchIcon,
  Description as DocumentIcon,
  Warning as WarningIcon,
  InfoOutlined as InfoIcon,
  Refresh as RefreshIcon,
  ArrowBack as ArrowBackIcon,
  Dashboard as AddToContextIcon,
  Folder as FolderIcon,
  Minimize as MinimizeIcon,
} from '@mui/icons-material';
import TutorialHelpIcon from './TutorialHelpIcon';
import { govtContractsEnrichmentAPI, govtContractsSearchAPI, filesystemAPI, fileReturnAPI, congressBillsSearchAPI, ldaSearchAPI } from '@/services/api';
import type { RollCallDetailsResult, RollCallMemberVote } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeDialogManager } from '../../hooks/useSafeDialogManager';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';
import FileBrowserDialog from './FileBrowserDialog';
import TilePreview from './TilePreview';
import { UnifiedTile } from '../../types/dashboardTypes';
import {
  addAwardToContext,
  addFilingToContext,
  addArticleToContext,
  addTradeToContext,
  addBillToContext,
  addLDAFilingToContext,
  addStockToContext,
} from '../tiles/common/contextManager';

/** Legislative stages for Status of Legislation tracker (per BILLSTATUS XML User Guide). */
const LEGISLATIVE_STAGES = [
  { label: 'Introduced', key: 'introduced' },
  { label: 'Passed Senate', key: 'passed_senate' },
  { label: 'Passed House', key: 'passed_house' },
  { label: 'To President', key: 'to_president' },
  { label: 'Became Law', key: 'became_law' },
] as const;

/** Action codes that indicate each stage (from govinfo BILLSTATUS User Guide Table 3). E30000 omitted: it can mean Signed OR Vetoed. */
const STAGE_ACTION_CODES: Record<string, number> = {
  '1000': 0,   // Introduced in House
  '10000': 0,  // Introduced in Senate
  '17000': 1,  // Passed/agreed to in Senate
  '8000': 2,   // Passed/agreed to in House
  '28000': 3,  // Presented to President
  'E20000': 3, // Presented to President
  '36000': 4,  // Became Public Law
  'E40000': 4, // Became Public Law No: 114-47
};
/** LOC code 31000 = Vetoed by President (do not treat as Became Law). */
const VETO_ACTION_CODES: Set<string> = new Set(['31000', '33000']); // 33000 = Failed of passage in House over veto
const STAGE_TYPE_PATTERNS: { pattern: RegExp | string; stage: number }[] = [
  { pattern: /introduced in (house|senate)/i, stage: 0 },
  { pattern: /passed\/agreed to in senate|passed senate/i, stage: 1 },
  { pattern: /passed\/agreed to in house|passed house/i, stage: 2 },
  { pattern: /presented to president|actions by the president/i, stage: 3 },
  { pattern: /became law|became public law|signed by president/i, stage: 4 },
];

function getBillLegislativeStage(itemData: Record<string, unknown> | null | undefined): { stageIndex: number; stageLabel: string; vetoed: boolean } {
  const introducedLabel = 'Introduced';
  if (!itemData) return { stageIndex: 0, stageLabel: introducedLabel, vetoed: false };

  let maxStage = 0;
  let vetoed = false;
  const typeStr = (itemData.latest_action_type as string) || '';
  const textStr = (itemData.latest_action_text as string) || '';

  const checkType = (t: string) => {
    const s = (t || '').toLowerCase();
    for (const { pattern, stage } of STAGE_TYPE_PATTERNS) {
      if (typeof pattern === 'string' ? s.includes(pattern.toLowerCase()) : pattern.test(s)) {
        if (stage === 4 && /veto/i.test(s)) return;
        maxStage = Math.max(maxStage, stage);
        break;
      }
    }
  };
  checkType(typeStr);
  checkType(textStr);

  let actions: { actionCode?: string; type?: string; text?: string }[] = [];
  try {
    const raw = itemData.actions_json;
    if (typeof raw === 'string' && raw) actions = JSON.parse(raw);
    else if (Array.isArray(raw)) actions = raw;
  } catch {
    // ignore
  }
  for (const a of actions) {
    const code = a.actionCode ? String(a.actionCode).trim() : '';
    const text = (a.text || '').toLowerCase();
    const type = (a.type || '').toLowerCase();
    const isVeto = /veto/i.test(text) || /veto/i.test(type) || VETO_ACTION_CODES.has(code);
    if (isVeto) vetoed = true;

    if (code && !isVeto && STAGE_ACTION_CODES[code] !== undefined) {
      maxStage = Math.max(maxStage, STAGE_ACTION_CODES[code]);
    }
    if (code === 'E30000' && !isVeto) {
      maxStage = Math.max(maxStage, 4);
    }
    if (a.type) checkType(a.type);
    if (a.text) checkType(a.text);
  }

  const stageIndex = Math.min(maxStage, LEGISLATIVE_STAGES.length - 1);
  const stageLabel = LEGISLATIVE_STAGES[stageIndex].label;
  return { stageIndex, stageLabel, vetoed: vetoed && maxStage < 4 };
}

export type ItemType = 
  | 'govt_contract' 
  | 'sec_filing' 
  | 'news_article' 
  | 'politician_trade' 
  | 'congress_bill' 
  | 'roll_call'
  | 'lda_disclosure' 
  | 'stock_result' 
  | 'tile';

interface ItemDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  itemType: ItemType;
  data: any; // The full data object for the item
  title?: string; // Optional custom title
  // For tiles
  folder_path?: string; // For tile updates in filesystem
  user_id?: string; // For enrichment operations and downloads
  // For enrichment (Government Contracts)
  onEnrich?: (enrichedData: any) => void; // Callback when enrichment completes
  // For child awards navigation (Government Contracts)
  onNavigateToChild?: (childAward: any) => void; // Callback to navigate to child award
  onNavigateToParent?: (parentAward: any) => void; // Callback to navigate to parent award
  parentAward?: any; // Parent award data (for child awards)
  // For files page context
  item_id?: string; // Item ID for tile updates
  // For rendering content only (without Dialog wrapper)
  contentOnly?: boolean; // If true, renders just the content without Dialog
  // Dialog manager props (optional for backward compatibility)
  onMinimize?: () => void;
  dialogId?: string;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
  onSizeChange?: (size: { width: number; height: number }) => void;
  onCacheContent?: (content: any) => void;
  cachedContent?: any;
  zIndex?: number;
  onBringToFront?: () => void;
  /** When true, hide the minimize button (e.g. demo section) */
  disableMinimize?: boolean;
  /** When set, render inside this container with position absolute so dialog stays within (e.g. demo area) */
  containerElement?: HTMLElement | null;
  /** When true, use only passed-in/mock data and do not make any API calls (for demo section) */
  useDemoData?: boolean;
}

/** Merge passed-in data with type-specific mock defaults so demo detail view looks complete without API calls */
function getDemoMockItemData(itemType: ItemType, data: any): any {
  const raw = data?.data && typeof data.data === 'object' ? data.data : data;
  if (!raw) return raw;
  const base = { ...raw };
  switch (itemType) {
    case 'govt_contract':
      return {
        award_id: base.award_id || 'demo-award-1',
        award_id_piid: base.award_id_piid || base.award_id?.replace('demo-award-', 'PIID-') || 'PIID-1',
        recipient_name: base.recipient_name ?? 'Demo Recipient',
        awarding_agency_name: base.awarding_agency_name ?? 'Demo Agency',
        total_obligated_amount: base.total_obligated_amount ?? 0,
        action_date: base.action_date ?? new Date().toISOString().slice(0, 10),
        period_of_performance_start_date: base.period_of_performance_start_date ?? '2024-01-01',
        period_of_performance_current_end_date: base.period_of_performance_current_end_date ?? '2025-12-31',
        description: base.description ?? 'Demo contract for preview. No API calls in demo.',
        transaction_count: base.transaction_count ?? 0,
        subaward_count: base.subaward_count ?? 0,
        transactions: base.transactions ?? [],
        subawards: base.subawards ?? [],
        child_awards: base.child_awards ?? [],
        child_awards_details: base.child_awards_details ?? [],
        award_type: base.award_type ?? 'contract',
        award_type_description: base.award_type_description ?? 'Contract',
        ...base,
      };
    case 'sec_filing': {
      const mockDocumentUrls = [
        'https://www.sec.gov/Archives/edgar/data/0000000/0000000-24-000000/10k-2024.htm',
        'https://www.sec.gov/Archives/edgar/data/0000000/0000000-24-000000/10k-2024.pdf',
        'https://www.sec.gov/Archives/edgar/data/0000000/0000000-24-000000/exhibit-21.htm',
      ];
      const mockDataFileUrls = [
        'https://www.sec.gov/Archives/edgar/data/0000000/0000000-24-000000/financials.json',
        'https://www.sec.gov/Archives/edgar/data/0000000/0000000-24-000000/notes-to-statements.json',
      ];
      return {
        ...base,
        form: base.form ?? '10-K',
        filingEntity: base.filingEntity ?? base.reportingFor ?? 'Demo Entity',
        reportingFor: base.reportingFor ?? base.filingEntity ?? 'FY 2024',
        filingDate: base.filingDate ?? '2024-02-15',
        accession: base.accession ?? '0000000-24-000000',
        cik: base.cik ?? '0000000',
        fileNumber: base.fileNumber ?? '001-00000',
        filingPageUrl: base.filingPageUrl ?? 'https://www.sec.gov/cgi-bin/browse-edgar',
        documentUrls: (base.documentUrls && base.documentUrls.length > 0) ? base.documentUrls : mockDocumentUrls,
        dataFileUrls: (base.dataFileUrls && base.dataFileUrls.length > 0) ? base.dataFileUrls : mockDataFileUrls,
      };
    }
    case 'congress_bill':
      return {
        bill_id: base.bill_id ?? 'hr-demo-1',
        bill_title: base.bill_title ?? 'Demo Bill',
        bill_type: base.bill_type ?? 'hr',
        sponsor_full_name: base.sponsor_full_name ?? base.sponsor_name ?? 'Demo Sponsor',
        introduced_date: base.introduced_date ?? '2024-01-10',
        congress: base.congress ?? 118,
        policy_area: base.policy_area ?? 'Demo area',
        summary_text: base.summary_text ?? 'This is demo bill text for preview. No API calls in demo.',
        ...base,
      };
    case 'roll_call':
      return {
        congress: base.congress ?? 119,
        session: base.session ?? 2,
        roll: base.roll ?? 70,
        roll_display: base.roll_display ?? 'Roll no. 70',
        ...base,
      };
    case 'politician_trade':
      return {
        tradeId: base.tradeId ?? base.award_id ?? 'demo-trade-1',
        politician_name: base.politician_name ?? base.politicianName ?? 'Demo Official',
        politicianName: base.politicianName ?? base.politician_name,
        party: base.party ?? 'D',
        position: base.position ?? 'Representative',
        asset_name: base.asset_name ?? base.securitySymbol ?? 'AAPL',
        securitySymbol: base.securitySymbol ?? base.asset_name,
        securityName: base.securityName ?? base.asset_name,
        transaction_type: base.transaction_type ?? base.transactionType ?? 'Purchase',
        transactionType: base.transactionType ?? base.transaction_type,
        transaction_date: base.transaction_date ?? base.transactionDate ?? '2024-09-01',
        transactionDate: base.transactionDate ?? base.transaction_date,
        amount: base.amount ?? '$1,001 - $15,000',
        ...base,
      };
    case 'news_article':
      return {
        id: base.id ?? 'demo-news-1',
        title: base.title ?? 'Demo Article',
        source_name: base.source_name ?? base.source ?? 'Demo Source',
        source_url: base.source_url ?? base.url ?? '#',
        published_date: base.published_date ?? base.publishedDate ?? new Date().toISOString(),
        summary: base.summary ?? 'Demo article summary for preview. No API calls in demo.',
        url: base.url ?? base.source_url ?? '#',
        ...base,
      };
    case 'lda_disclosure':
    case 'stock_result':
    case 'tile':
    default:
      return base;
  }
}

const ItemDetailsDialog: React.FC<ItemDetailsDialogProps> = ({
  open,
  onClose,
  itemType,
  data,
  title,
  folder_path,
  user_id,
  onEnrich,
  onNavigateToChild,
  onNavigateToParent,
  parentAward,
  item_id,
  contentOnly = false,
  onMinimize,
  dialogId,
  initialPosition,
  initialSize,
  onPositionChange,
  onSizeChange,
  onCacheContent,
  zIndex = 1000,
  onBringToFront,
  disableMinimize = false,
  containerElement = null,
  useDemoData = false,
}) => {
  const [enrichmentLoading, setEnrichmentLoading] = useState<boolean>(false);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const [enrichmentSuccess, setEnrichmentSuccess] = useState<string | null>(null);
  const [downloadLoading, setDownloadLoading] = useState<boolean>(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState<boolean>(false);
  const [loadingChildAwards, setLoadingChildAwards] = useState<boolean>(false);
  const [childAwardsDetails, setChildAwardsDetails] = useState<any[]>([]);
  const childAwardsFetchedRef = useRef<Set<string>>(new Set()); // Track which award IDs we've already fetched child awards for
  const fullAwardFetchedRef = useRef<Set<string>>(new Set()); // Track which award IDs we've already fetched full award data for
  const fullFilingFetchedRef = useRef<Set<string>>(new Set()); // Track which filing IDs/PKs we've already fetched full filing data for
  const fullBillFetchedRef = useRef<Set<string>>(new Set()); // Track which bill IDs we've already fetched full bill data for
  const [refreshBillLoading, setRefreshBillLoading] = useState<boolean>(false);
  const [rollCallDetails, setRollCallDetails] = useState<RollCallDetailsResult | null>(null);
  const [rollCallDetailsLoading, setRollCallDetailsLoading] = useState<boolean>(false);
  const [rollCallDetailsError, setRollCallDetailsError] = useState<string | null>(null);
  const [rollCallVoteFilterParty, setRollCallVoteFilterParty] = useState<string>('');
  const [rollCallVoteFilterState, setRollCallVoteFilterState] = useState<string>('');
  const [rollCallVoteFilterVote, setRollCallVoteFilterVote] = useState<string>('');
  /** Vote summary by roll key (congress#session#roll) for bill Votes tab when we fetch roll call details */
  const [billVoteResultsByKey, setBillVoteResultsByKey] = useState<Record<string, { total?: { yea?: number; nay?: number; present?: number; not_voting?: number }; by_party?: Record<string, { yea?: number; nay?: number; present?: number; not_voting?: number }> }>>({});
  
  // State to track item data - updated when enrichment completes
  const [itemData, setItemData] = useState<any>(() => {
    const raw = data?.data && typeof data.data === 'object' ? data.data : data;
    return useDemoData ? getDemoMockItemData(itemType, data) : raw;
  });
  
  const { user } = useAuth();
  
  // Dialog manager helpers for opening new dialogs (e.g., parent contract)
  const { openItemDetails } = useDialogManagerHelpers();
  
  // State for loading full award data
  const [loadingFullAward, setLoadingFullAward] = useState<boolean>(false);
  
  // Fetch child award details if we have child_awards but not child_awards_details
  useEffect(() => {
    if (useDemoData) {
      if (itemData?.child_awards_details && Array.isArray(itemData.child_awards_details)) {
        setChildAwardsDetails(itemData.child_awards_details);
      } else {
        setChildAwardsDetails([]);
      }
      return;
    }
    const fetchChildAwards = async () => {
      const awardId = itemData?.award_id;
      
      // Skip if we've already fetched child awards for this award ID
      if (awardId && childAwardsFetchedRef.current.has(awardId)) {
        return;
      }
      
      if (itemType === 'govt_contract' && itemData?.is_idv_parent && itemData?.child_awards && 
          Array.isArray(itemData.child_awards) && itemData.child_awards.length > 0 &&
          (!itemData.child_awards_details || itemData.child_awards_details.length === 0)) {
        // Mark as fetched to prevent duplicate calls
        if (awardId) {
          childAwardsFetchedRef.current.add(awardId);
        }
        
        setLoadingChildAwards(true);
        try {
          const childAwardPromises = itemData.child_awards.map(async (childAwardId: string) => {
            try {
              const response = await govtContractsSearchAPI.getAward({ award_id: childAwardId });
              if (response.success && response.result) {
                return {
                  award_id: response.result.award_id,
                  award_id_piid: response.result.award_id_piid,
                  description: response.result.transaction_description || response.result.description,
                  total_obligated_amount: response.result.total_obligated_amount || response.result.total_obligation,
                  period_of_performance_start_date: response.result.period_of_performance_start_date,
                  period_of_performance_current_end_date: response.result.period_of_performance_current_end_date,
                  transaction_count: response.result.transaction_count,
                  subaward_count: response.result.subaward_count,
                  award_type: response.result.award_type,
                  award_type_description: response.result.award_type_description,
                  recipient_name: response.result.recipient_name,
                  awarding_agency_name: response.result.awarding_agency_name,
                };
              }
            } catch (error) {
              console.error(`Error fetching child award ${childAwardId}:`, error);
              // Return minimal info if fetch fails
              return {
                award_id: childAwardId,
                award_id_piid: childAwardId.split('_').pop() || childAwardId,
              };
            }
            return null;
          });
          
          const fetchedAwards = await Promise.all(childAwardPromises);
          const validAwards = fetchedAwards.filter(award => award !== null);
          setChildAwardsDetails(validAwards);
        } catch (error) {
          console.error('Error fetching child awards:', error);
        } finally {
          setLoadingChildAwards(false);
        }
      } else if (itemData?.child_awards_details && Array.isArray(itemData.child_awards_details)) {
        // If child_awards_details already exists, use it
        setChildAwardsDetails(itemData.child_awards_details);
        if (awardId) {
          childAwardsFetchedRef.current.add(awardId);
        }
      } else {
        setChildAwardsDetails([]);
      }
    };
    
    if (open && itemData) {
      fetchChildAwards();
    }
  }, [itemData, itemType, open, useDemoData]);

  // Update itemData when data prop changes (e.g., when dialog is opened with new data)
  useEffect(() => {
    const newItemData = useDemoData ? getDemoMockItemData(itemType, data) : (data?.data && typeof data.data === 'object' ? data.data : data);
    const awardId = newItemData?.award_id;
    
    setItemData(newItemData);
    
    if (useDemoData) {
      setLoadingFullAward(false);
      if (!open) {
        fullAwardFetchedRef.current.clear();
        childAwardsFetchedRef.current.clear();
        fullFilingFetchedRef.current.clear();
      }
      return;
    }
    
    // For government contracts, always fetch full award data when dialog opens
    // This ensures we have complete data including transactions and subawards
    // Only fetch if we haven't already fetched for this award ID
    if (itemType === 'govt_contract' && awardId && open && !fullAwardFetchedRef.current.has(awardId)) {
      fullAwardFetchedRef.current.add(awardId);
      setLoadingFullAward(true);
      govtContractsSearchAPI.getAward({ award_id: awardId })
        .then((response) => {
          if (response.success && response.result) {
            setItemData(response.result);
          }
        })
        .catch((error) => {
          console.error('Error fetching full award data:', error);
          // Remove from set on error so we can retry
          fullAwardFetchedRef.current.delete(awardId);
        })
        .finally(() => {
          setLoadingFullAward(false);
        });
    }
    
    // For congress bills, fetch full bill data when dialog opens (bill text URLs, voter links, etc.)
    // Search results only include projected attributes for filtering/table; full details loaded on view
    const billId = newItemData?.bill_id;
    if (itemType === 'congress_bill' && billId && open && !fullBillFetchedRef.current.has(billId)) {
      fullBillFetchedRef.current.add(billId);
      setRefreshBillLoading(true);
      congressBillsSearchAPI.getBill({ bill_id: billId })
        .then((response) => {
          if (response.success && response.result) {
            setItemData(response.result);
          }
        })
        .catch((error) => {
          console.error('Error fetching full bill data:', error);
          fullBillFetchedRef.current.delete(billId);
        })
        .finally(() => {
          setRefreshBillLoading(false);
        });
    }
    
    // For LDA disclosures, always fetch full filing data when dialog opens
    // This ensures we have complete data structure
    // Only fetch if we haven't already fetched for this filing ID/PK
    if (itemType === 'lda_disclosure' && open) {
      // Extract filing ID or PK from various possible fields
      let filingIdOrPk: string | undefined;
      
      if (newItemData?.PK) {
        // Use PK directly (format: FILING#uuid or CONTRIBUTION#uuid)
        filingIdOrPk = typeof newItemData.PK === 'string' ? newItemData.PK : String(newItemData.PK);
      } else if (newItemData?.id || newItemData?.filing_uuid) {
        // Fallback to ID if PK not available
        filingIdOrPk = newItemData.id || newItemData.filing_uuid;
      }
      
      if (filingIdOrPk && !fullFilingFetchedRef.current.has(filingIdOrPk)) {
        fullFilingFetchedRef.current.add(filingIdOrPk);
        setLoadingFullAward(true);
        ldaSearchAPI.getFiling({ filing_id: filingIdOrPk })
          .then((response) => {
            if (response.success && response.result) {
              setItemData(response.result);
            } else {
              console.warn('Failed to fetch full filing details:', response.error);
              // Keep the original data if fetch fails
              fullFilingFetchedRef.current.delete(filingIdOrPk);
            }
          })
          .catch((error) => {
            console.error('Error fetching full filing data:', error);
            // Keep the original data if fetch fails
            fullFilingFetchedRef.current.delete(filingIdOrPk);
          })
          .finally(() => {
            setLoadingFullAward(false);
          });
      } else if (!filingIdOrPk) {
        setLoadingFullAward(false);
      }
    } else if (itemType !== 'lda_disclosure') {
      setLoadingFullAward(false);
    }
    
    // Clear the refs when dialog closes to allow fresh fetch on next open
    if (!open) {
      fullAwardFetchedRef.current.clear();
      childAwardsFetchedRef.current.clear();
      fullFilingFetchedRef.current.clear();
      fullBillFetchedRef.current.clear();
      setRollCallDetails(null);
      setRollCallDetailsError(null);
    }
  }, [data, itemType, open, useDemoData]);

  // Fetch roll call details when dialog opens with roll_call item type
  useEffect(() => {
    if (!open || itemType !== 'roll_call' || useDemoData) return;
    const congress = itemData?.congress != null ? Number(itemData.congress) : NaN;
    const session = itemData?.session != null ? Number(itemData.session) : NaN;
    const roll = itemData?.roll != null ? Number(itemData.roll) : NaN;
    if (isNaN(congress) || isNaN(session) || isNaN(roll)) {
      setRollCallDetailsError('Invalid congress, session, or roll.');
      setRollCallDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setRollCallDetailsLoading(true);
    setRollCallDetailsError(null);
    setRollCallDetails(null);
    congressBillsSearchAPI
      .getRollCallDetails({ congress, session, roll })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.result) {
          const raw = res.result as any;
          // API may return nested shape: { roll_item, bill_associated, vote_summary, members }
          const normalized: RollCallDetailsResult = raw.roll_item
            ? {
                ...raw.roll_item,
                bill_id_associated: raw.roll_item.bill_id_associated ?? raw.bill_id_associated,
                roll_display: raw.roll_item.roll_display ?? raw.roll_display,
                bill_associated: raw.bill_associated ?? raw.roll_item.bill_associated,
                vote_summary: raw.vote_summary ?? raw.roll_item.vote_summary,
                members: raw.members ?? raw.roll_item.members,
              }
            : raw;
          setRollCallDetails(normalized);
          setRollCallDetailsError(null);
          setRollCallVoteFilterParty('');
          setRollCallVoteFilterState('');
          setRollCallVoteFilterVote('');
        } else {
          setRollCallDetailsError(res.error || 'Roll call not found.');
          setRollCallDetails(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setRollCallDetailsError(e instanceof Error ? e.message : 'Failed to load roll call.');
          setRollCallDetails(null);
        }
      })
      .finally(() => {
        if (!cancelled) setRollCallDetailsLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, itemType, useDemoData, itemData?.congress, itemData?.session, itemData?.roll]);

  // Dialog manager for minimize functionality (only use if not already managed)
  const safeDialogManager = useSafeDialogManager();
  const dialogManager = (!dialogId && safeDialogManager) ? safeDialogManager : undefined;
  
  // Resizable and movable state
  const [position, setPosition] = useState(initialPosition || { x: 100, y: 100 });
  const [size, setSize] = useState(initialSize || { width: 900, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [billDetailsTab, setBillDetailsTab] = useState(0);
  const paperRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  // Preview values stored in refs to avoid re-renders during drag/resize
  const previewPositionRef = useRef({ x: 100, y: 100 });
  const previewSizeRef = useRef({ width: 900, height: 600 });
  const cachedDataRef = useRef<any>(null); // Track what we've cached to prevent infinite loops

  // Reset bill details tab when opening a different bill
  useEffect(() => {
    if (itemType === 'congress_bill') setBillDetailsTab(0);
  }, [itemType, itemData?.bill_id, data?.bill_id]);

  const billVoteFetchRequestedRef = useRef<{ billId: string; keys: Set<string> } | null>(null);
  // Fetch roll call vote summaries for bill Votes tab so we can show result (Passed/Failed, counts) per vote
  useEffect(() => {
    if (!open || itemType !== 'congress_bill' || useDemoData || !itemData?.recorded_votes_json) return;
    const billId = String(itemData?.bill_id ?? '');
    if (!billId) return;
    let recordedVotes: any[] = [];
    try {
      const v = typeof itemData.recorded_votes_json === 'string' ? JSON.parse(itemData.recorded_votes_json) : itemData.recorded_votes_json;
      recordedVotes = Array.isArray(v) ? v : [];
    } catch { return; }
    const congress = itemData?.congress ?? (itemData?.bill_id ? parseInt(String(itemData.bill_id).split('-')[0], 10) : undefined);
    if (typeof congress !== 'number') return;
    if (!billVoteFetchRequestedRef.current || billVoteFetchRequestedRef.current.billId !== billId) {
      billVoteFetchRequestedRef.current = { billId, keys: new Set() };
      setBillVoteResultsByKey({}); // clear so we don't show previous bill's results
    }
    const requested = billVoteFetchRequestedRef.current;
    const toFetch: { key: string; session: number; roll: number }[] = [];
    for (const rv of recordedVotes) {
      const session = rv.sessionNumber ?? rv.session;
      const roll = rv.rollNumber ?? rv.roll;
      if (session == null || roll == null) continue;
      const key = `${congress}#${session}#${roll}`;
      if (!requested.keys.has(key)) {
        requested.keys.add(key);
        toFetch.push({ key, session: Number(session), roll: Number(roll) });
      }
    }
    if (toFetch.length === 0) return;
    let cancelled = false;
    const run = async () => {
      for (const { key, session, roll } of toFetch) {
        if (cancelled) break;
        try {
          const res = await congressBillsSearchAPI.getRollCallDetails({ congress, session, roll });
          if (cancelled || !res?.result?.vote_summary) continue;
          setBillVoteResultsByKey((prev) => ({ ...prev, [key]: res.result!.vote_summary! }));
        } catch { /* ignore */ }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [open, itemType, itemData?.bill_id, itemData?.congress, itemData?.recorded_votes_json, useDemoData]);

  // Utility functions
  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      // Parse date string directly to avoid timezone conversion issues
      // Date strings like "2025-01-03" should be treated as local dates, not UTC
      const [year, month, day] = dateString.split('T')[0].split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const formatLastUpdated = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const formatCurrency = (amount?: number | string): string => {
    if (amount === undefined || amount === null) return 'N/A';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
  };

  const formatLDACurrency = (amount?: number | string): string => {
    if (amount === undefined || amount === null) return 'N/A';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
  };

  const formatTransactionDate = (dateValue: number | string): string => {
    if (!dateValue) return 'N/A';
    try {
      // Handle YYYYMMDD format (number)
      if (typeof dateValue === 'number') {
        const dateStr = dateValue.toString();
        if (dateStr.length === 8) {
          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(4, 6);
          const day = dateStr.substring(6, 8);
          return formatDate(`${year}-${month}-${day}`);
        }
      }
      return formatDate(dateValue.toString());
    } catch {
      return dateValue.toString();
    }
  };

  const formatAmountRange = (trade: any): string => {
    if (!trade) return 'N/A';
    if (trade.exactAmount) {
      return formatCurrency(trade.exactAmount);
    }
    if (trade.amountMin && trade.amountMax) {
      if (trade.amountMin === trade.amountMax) {
        return formatCurrency(trade.amountMin);
      }
      return `${formatCurrency(trade.amountMin)} - ${formatCurrency(trade.amountMax)}`;
    }
    return 'N/A';
  };


  const scrollbarStyles = {
    '&::-webkit-scrollbar': {
      width: '8px',
    },
    '&::-webkit-scrollbar-track': {
      backgroundColor: 'rgba(55, 65, 81, 0.3)',
    },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: 'rgba(59, 130, 246, 0.5)',
      borderRadius: '4px',
    },
    '&::-webkit-scrollbar-thumb:hover': {
      backgroundColor: 'rgba(59, 130, 246, 0.7)',
    },
  };

  // Handle refresh for Congress Bills
  const handleRefreshBill = useCallback(async () => {
    if (useDemoData) return;
    const billId = itemData?.bill_id;
    
    if (!billId || refreshBillLoading) return;

    setRefreshBillLoading(true);
    setEnrichmentError(null);
    setEnrichmentSuccess(null);

    try {
      console.log('🔄 Refreshing bill data from DynamoDB...', billId);
      const response = await congressBillsSearchAPI.getBill({
        bill_id: billId,
      });

      if (response.success && response.result) {
        const updatedBill = response.result;
        console.log('✅ Fetched updated bill', {
          bill_id: updatedBill.bill_id,
          title: updatedBill.title,
        });
        
        // Update local state with refreshed bill data
        console.log('🔄 Updating ItemDetailsDialog state with refreshed bill');
        setItemData(updatedBill);
        
        // Call onEnrich callback with updated data (to update tile)
        if (onEnrich) {
          console.log('📤 Calling onEnrich callback with updated bill data');
          onEnrich(updatedBill);
        }
        
        setEnrichmentSuccess('Bill data refreshed successfully!');
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          setEnrichmentSuccess(null);
        }, 5000);
      } else {
        console.warn('⚠️ Bill fetch returned unsuccessful response', response);
        setEnrichmentError(response.error || 'Failed to refresh bill data');
      }
    } catch (error) {
      console.error('❌ Error refreshing bill:', error);
      setEnrichmentError('Failed to refresh bill data');
    } finally {
      setRefreshBillLoading(false);
    }
  }, [itemData?.bill_id, refreshBillLoading, onEnrich, useDemoData]);

  // Handle enrichment for Government Contracts
  const handleEnrichAward = useCallback(async () => {
    if (useDemoData) return;
    // Get award_id from itemData state
    const awardId = itemData?.award_id;
    
    if (!awardId || enrichmentLoading || !user_id) return;

    setEnrichmentLoading(true);
    setEnrichmentError(null);
    setEnrichmentSuccess(null);

    try {
      const response = await govtContractsEnrichmentAPI.enrich({
        award_id: awardId,
      });

      if (response.success) {
        if (response.updated) {
          setEnrichmentSuccess(
            `Refreshing award data... Updated ${response.transactions_count || 0} transactions, ${response.subawards_count || 0} subawards${response.child_awards_count ? `, ${response.child_awards_count} child awards` : ''}.`
          );
          
          // Wait a moment for DynamoDB to be consistent, then fetch the updated award
          // Use a longer delay for large updates (more transactions/subawards)
          const delay = (response.transactions_count || 0) > 1000 || (response.subawards_count || 0) > 1000 ? 5000 : 2000;
          console.log(`⏳ Waiting ${delay}ms for DynamoDB consistency before fetching updated award...`);
          
          setTimeout(async () => {
            try {
              console.log('📥 Fetching updated award after enrichment...', awardId);
              const awardResponse = await govtContractsSearchAPI.getAward({
                award_id: awardId,
              });
              
              if (awardResponse.success && awardResponse.result) {
                const updatedAward = awardResponse.result;
                console.log('✅ Fetched updated award', {
                  award_id: updatedAward.award_id,
                  transactions_count: updatedAward.transactions?.length || 0,
                  subawards_count: updatedAward.subawards?.length || 0,
                  transaction_count_field: updatedAward.transaction_count,
                  subaward_count_field: updatedAward.subaward_count,
                  has_oversize_s3_key: !!updatedAward.oversize_s3_key,
                });
                
                // Update local state with enriched award data
                console.log('🔄 Updating ItemDetailsDialog state with enriched award');
                setItemData(updatedAward);
                
                // Call onEnrich callback with updated data (to update tile)
                if (onEnrich) {
                  console.log('📤 Calling onEnrich callback with updated award data');
                  onEnrich(updatedAward);
                }
                
                setEnrichmentSuccess(
                  `Award data refreshed successfully! Updated ${response.transactions_count || 0} transactions, ${response.subawards_count || 0} subawards${response.child_awards_count ? `, ${response.child_awards_count} child awards` : ''}.`
                );
                
                // Clear success message after 5 seconds
                setTimeout(() => {
                  setEnrichmentSuccess(null);
                }, 5000);
              } else {
                console.warn('⚠️ Award fetch returned unsuccessful response', awardResponse);
              }
            } catch (error) {
              console.error('❌ Error fetching updated award:', error);
              setEnrichmentError('Failed to fetch updated award data');
            } finally {
              setEnrichmentLoading(false);
            }
          }, delay);
        } else {
          setEnrichmentSuccess('Award data is already up to date.');
          setTimeout(() => {
            setEnrichmentSuccess(null);
          }, 3000);
          setEnrichmentLoading(false);
        }
      } else {
        setEnrichmentError(response.error || 'Failed to enrich award data');
        setEnrichmentLoading(false);
      }
    } catch (error: any) {
      console.error('Enrichment error:', error);
      setEnrichmentError(error.message || 'An error occurred while enriching award data');
      setEnrichmentLoading(false);
    }
  }, [data, enrichmentLoading, user_id, onEnrich, useDemoData]);

  // Handle adding item to context (sidebar)
  const handleAddToContext = useCallback(() => {
    if (!itemData) return;
    
    try {
      switch (itemType) {
        case 'govt_contract':
          addAwardToContext(itemData);
          break;
        case 'sec_filing':
          addFilingToContext(itemData);
          break;
        case 'news_article':
          addArticleToContext(itemData.id, itemData.title, itemData.source_name || itemData.source_url || 'Unknown', itemData);
          break;
        case 'politician_trade':
          addTradeToContext(itemData);
          break;
        case 'congress_bill':
          addBillToContext(itemData);
          break;
        case 'roll_call':
          // Roll call can be added as context with minimal payload (e.g. for chat)
          if (rollCallDetails?.bill_id_associated) {
            addBillToContext({ bill_id: rollCallDetails.bill_id_associated, ...rollCallDetails.bill_associated });
          }
          break;
        case 'lda_disclosure':
          addLDAFilingToContext(itemData);
          break;
        case 'stock_result':
          addStockToContext(
            itemData.symbol || 'Unknown',
            itemData.name || itemData.companyName || 'Unknown',
            itemData.timeframe || '1D',
            itemData
          );
          break;
        default:
          console.warn(`Unknown item type: ${itemType}`);
      }
    } catch (error) {
      console.error('Error adding item to context:', error);
    }
  }, [data, itemType, rollCallDetails]);

  // Handle adding item to files
  const handleAddToFiles = useCallback(() => {
    if (!user) {
      alert('Please log in to save items to files');
      return;
    }
    setFileBrowserOpen(true);
  }, [user]);

  // Handle file browser selection
  const handleFileBrowserSelect = useCallback(async (folderPath: string) => {
    if (!user) return;
    
    if (!itemData) return;
    
    try {
      let title = '';
      let itemTypeForFiles: string = itemType;
      
      switch (itemType) {
        case 'govt_contract':
          title = `${itemData.awarding_agency_name || 'Unknown Agency'} - ${itemData.recipient_name || 'Unknown Recipient'}`;
          itemTypeForFiles = 'govt_contract';
          break;
        case 'sec_filing':
          title = `${itemData.form || 'SEC Filing'} - ${itemData.filingEntity || itemData.reportingFor || 'Unknown Entity'}`;
          itemTypeForFiles = 'sec_filing';
          break;
        case 'news_article':
          title = itemData.title || 'News Article';
          itemTypeForFiles = 'news_article';
          break;
        case 'politician_trade':
          title = `${itemData.politicianName || 'Unknown'} - ${itemData.securitySymbol || itemData.securityName || 'Trade'}`;
          itemTypeForFiles = 'politician_trade';
          break;
        case 'congress_bill':
          title = itemData.title || itemData.billNumber || 'Congress Bill';
          itemTypeForFiles = 'congress_bill';
          break;
        case 'roll_call':
          title = itemData.roll_display || `Roll Call ${itemData.roll ?? ''}`;
          itemTypeForFiles = 'roll_call';
          break;
        case 'lda_disclosure':
          title = itemData.registrant_name 
            ? `LDA Filing - ${itemData.registrant_name}${itemData.client_name ? ` / ${itemData.client_name}` : ''}`
            : 'LDA Filing';
          itemTypeForFiles = 'lda_disclosure';
          break;
        case 'stock_result':
          title = `${itemData.symbol || 'Stock'} - ${itemData.name || 'Stock Data'}`;
          itemTypeForFiles = 'stock_result';
          break;
        default:
          title = title || 'Item';
      }
      
      await filesystemAPI.addContextItem({
        user_id: user.id,
        folder_path: folderPath,
        context_data: itemData, // Full item data
        title: title,
        item_type: itemTypeForFiles as any,
      });
      
      console.log(`✅ Saved item to filesystem: ${title}`);
      setFileBrowserOpen(false);
    } catch (error) {
      console.error('Error saving item to filesystem:', error);
      alert('Failed to save item to files. Please try again.');
    }
  }, [user, data, itemType]);

  // Handle download for SEC filings and politician trades
  const handleDownloadFile = useCallback(async (s3Key: string, filename: string, bucket: string = 'SEC_FILINGS') => {
    if (!user_id) {
      alert('Please log in to download files');
      return;
    }

    if (!s3Key) {
      console.error('❌ Download failed: Missing s3_key');
      alert('Failed to download file: Missing file path.');
      return;
    }

    try {
      console.log('📥 Downloading file:', filename, 'from s3_key:', s3Key, 'bucket:', bucket);
      
      // Use the API service wrapper for better error handling
      const response = await fileReturnAPI.downloadFile({
          user_id: user_id,
        session_id: '', // Optional for politician trades, SEC filings, etc.
          bucket: bucket,
          s3_key: s3Key,
          filename: filename
      });
      
      if (!response.success || !response.data?.download_url) {
        throw new Error(response.error || 'Download request failed');
      }
      
      const { download_url } = response.data;
      
      // Create download link and trigger download
      const link = document.createElement('a');
      link.href = download_url;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log('✅ File download started');
    } catch (error: any) {
      console.error('❌ Download failed:', error);
      const errorMessage = error?.message || 'Failed to download file. Please try again.';
      alert(`Failed to download file: ${errorMessage}`);
    }
  }, [user_id]);

  // Check if this is a tile
  const contentToTile = (content: any): UnifiedTile | null => {
    if (!content || typeof content !== 'object') return null;
    
    // Check if it has tile-like properties
    if (content.tileType || content.type === 'tile' || (content.type && ['stock', 'news', 'sec', 'lda', 'congress_bills', 'govt_contracts', 'politician_trades'].includes(content.type))) {
      return content as UnifiedTile;
    }
    
    return null;
  };

  // Render content based on item type
  const renderContent = () => {
    // Handle tiles
    if (itemType === 'tile') {
      const tile = contentToTile(data);
      if (tile && folder_path !== undefined && item_id) {
        return (
          <TilePreview
            tile={tile}
            user_id={user_id || ''}
            folder_path={folder_path || ''}
            item_id={item_id}
            onUpdate={(updatedTile) => {
              if (onEnrich) {
                onEnrich(updatedTile);
              }
            }}
          />
        );
      }
    }

    // Use itemData state (already handles nested/flat structure)
    
    // Show loading state for government contracts while fetching full award data
    if (itemType === 'govt_contract' && loadingFullAward) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <CircularProgress sx={{ color: '#3b82f6', mb: 2 }} />
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            Loading award details...
          </Typography>
        </Box>
      );
    }

    // Politician Trade
    if (itemType === 'politician_trade' || itemData?.tradeId || itemData?.politicianName || itemData?.transactionType) {
      // Early return if itemData is null
      if (!itemData) {
        return (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: '#9ca3af' }}>
              No trade data available
            </Typography>
          </Box>
        );
      }
      
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
            {title || itemData?.politicianName || 'Politician Trade'}
          </Typography>
          
          {/* Trade Information Section */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Trade Information
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {itemData?.politicianName && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Politician
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.politicianName}
                  </Typography>
                </Box>
              )}
              {itemData?.position && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Position
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.position}
                  </Typography>
                </Box>
              )}
              {itemData?.party && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Party
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.party}
                  </Typography>
                </Box>
              )}
              {itemData?.stateDistrict && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    State/District
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.stateDistrict}
                  </Typography>
                </Box>
              )}
              {itemData?.securitySymbol && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Security Symbol
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {itemData.securitySymbol}
                  </Typography>
                </Box>
              )}
              {itemData?.securityName && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Security Name
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.securityName}
                  </Typography>
                </Box>
              )}
              {itemData?.assetType && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Asset Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.assetType}
                  </Typography>
                </Box>
              )}
              {itemData?.transactionType && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Transaction Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.transactionType}
                  </Typography>
                </Box>
              )}
              {itemData?.transactionDate && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Transaction Date
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatTransactionDate(itemData.transactionDate)}
                  </Typography>
                </Box>
              )}
              {itemData?.filingDate && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Filing Date
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatDate(itemData.filingDate)}
                  </Typography>
                </Box>
              )}
              {formatAmountRange(itemData) !== 'N/A' && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Amount Range
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {formatAmountRange(itemData)}
                  </Typography>
                </Box>
              )}
              {itemData?.owner && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Owner
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.owner}
                  </Typography>
                </Box>
              )}
              {itemData?.formType && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Form Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.formType}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* Filing Document Section */}
          {itemData?.formS3Key && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Filing Document
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1 }}>
                  {itemData.formS3Key.split('/').pop() || itemData.formS3Key}
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon />}
                  onClick={() => handleDownloadFile(itemData.formS3Key, itemData.formS3Key.split('/').pop() || 'filing.pdf', 'POLITICIAN_TRADES')}
                  sx={{
                    color: '#3b82f6',
                    borderColor: '#3b82f6',
                    '&:hover': {
                      borderColor: '#60a5fa',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  Download
                </Button>
              </Box>
            </Box>
          )}

          {/* Politician Website */}
          {itemData?.websiteUrl && (
            <Box sx={{ mb: 3 }}>
              <Button
                variant="outlined"
                component="a"
                href={itemData.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LaunchIcon />}
                sx={{
                  color: '#3b82f6',
                  borderColor: '#3b82f6',
                  '&:hover': {
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                View Politician Website
              </Button>
            </Box>
          )}
        </Box>
      );
    }

    // Roll call (House vote) — no inner scroll; content scrolls with main dialog area. Only votes table has its own scroll.
    if (itemType === 'roll_call') {
      const rollCallTableScrollbarSx = {
        scrollbarColor: '#3b82f6 rgba(55, 65, 81, 0.3)',
        '&::-webkit-scrollbar': { width: '8px' },
        '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)', borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb': { backgroundColor: '#3b82f6', borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb:hover': { backgroundColor: '#2563eb' },
      };
      if (rollCallDetailsLoading) {
        return (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 280, p: 3 }}>
            <CircularProgress sx={{ color: '#3b82f6' }} />
          </Box>
        );
      }
      if (rollCallDetailsError || !rollCallDetails) {
        return (
          <Box sx={{ p: 3 }}>
            <Alert severity="error" sx={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              {rollCallDetailsError ?? 'Roll call not found.'}
            </Alert>
          </Box>
        );
      }
      const data = rollCallDetails;
      const bill = data.bill_associated;
      const voteSummary = data.vote_summary;
      const total = voteSummary?.total ?? {};
      const byParty = voteSummary?.by_party ?? {};
      const members = (data.members ?? []).filter((m): m is RollCallMemberVote => m != null && typeof m === 'object');
      const partyOrder = ['D', 'R', 'I'];
      const memberDisplayName = (m: RollCallMemberVote | null | undefined) => {
        if (m == null) return '—';
        if (m.name) return m.name;
        const first = (m.firstName ?? '').trim();
        const last = (m.lastName ?? '').trim();
        return [first, last].filter(Boolean).join(' ') || '—';
      };
      const memberPartyLabel = (m: RollCallMemberVote | null | undefined) => {
        if (m == null) return '—';
        const p = (m.voteParty ?? m.party ?? '').trim().toUpperCase();
        if (p.startsWith('R')) return 'Republican';
        if (p.startsWith('D')) return 'Democratic';
        return p || '—';
      };
      const memberStateLabel = (m: RollCallMemberVote | null | undefined) => (m != null ? (m.state ?? m.stateCode ?? m.voteState ?? '').trim() || '—' : '—');
      const memberVoteLabel = (m: RollCallMemberVote | null | undefined) => (m != null ? (m.voteCast ?? '').trim() || '—' : '—');

      // Unique values for filter dropdowns
      const partyOptions = Array.from(new Set(members.map((m) => memberPartyLabel(m)))).filter(Boolean).sort();
      const stateOptions = Array.from(new Set(members.map((m) => memberStateLabel(m)))).filter((s) => s && s !== '—').sort();
      const voteOptions = Array.from(new Set(members.map((m) => memberVoteLabel(m)))).filter((v) => v && v !== '—').sort();
      const filteredMembers = members.filter((m) => {
        if (rollCallVoteFilterParty && memberPartyLabel(m) !== rollCallVoteFilterParty) return false;
        if (rollCallVoteFilterState && memberStateLabel(m) !== rollCallVoteFilterState) return false;
        if (rollCallVoteFilterVote && memberVoteLabel(m) !== rollCallVoteFilterVote) return false;
        return true;
      });

      const rollCallCongressGovUrl = `https://www.congress.gov/votes/${((data as any).chamber ?? 'house').toLowerCase()}/${data.congress}-${data.session}/${data.roll}`;
      return (
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ color: '#e2e8f0' }}>
              {data.roll_display ?? `Roll Call ${data.roll}`} — Congress {data.congress}, Session {data.session}
            </Typography>
            <Tooltip title="View voter data on Congress.gov">
              <IconButton
                size="small"
                component="a"
                href={rollCallCongressGovUrl}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  color: '#9ca3af',
                  '&:hover': {
                    color: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <Paper variant="outlined" sx={{ p: 2, mb: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderColor: '#374151' }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5, fontWeight: 600 }}>
              Associated bill
            </Typography>
            {data.bill_id_associated ? (
              <Box>
                <Typography component="span" variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  {data.bill_id_associated}
                </Typography>
                {' · '}
                <Link
                  component="button"
                  variant="body2"
                  sx={{ color: '#60a5fa', cursor: 'pointer', textTransform: 'none', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => {
                    openItemDetails('congress_bill', { bill_id: data.bill_id_associated }, data.bill_id_associated, { user_id: user_id || user?.id });
                  }}
                >
                  View
                </Link>
                {bill?.bill_title && (
                  <Typography variant="body2" sx={{ color: '#cbd5e1', mt: 0.5 }}>{bill.bill_title}</Typography>
                )}
                {bill?.latest_action_text && (
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mt: 0.5 }}>{bill.latest_action_text}</Typography>
                )}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ color: '#94a3b8' }}>No associated bill</Typography>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, mb: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderColor: '#374151' }}>
            <Typography variant="subtitle1" sx={{ color: '#e2e8f0', mb: 1.5 }}>Vote summary</Typography>
            <TableContainer>
              <Table size="small" sx={{ '& th, & td': { color: '#cbd5e1', borderColor: '#374151' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ borderColor: '#374151' }}>Party</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>Yea</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>Nay</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>Present</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>Not Voting</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {partyOrder.map((p) => {
                    const counts = byParty[p] ?? {};
                    const label = p === 'D' ? 'Democratic' : p === 'R' ? 'Republican' : 'Independent';
                    return (
                      <TableRow key={p}>
                        <TableCell sx={{ borderColor: '#374151' }}>{label}</TableCell>
                        <TableCell align="right" sx={{ borderColor: '#374151' }}>{counts.yea ?? 0}</TableCell>
                        <TableCell align="right" sx={{ borderColor: '#374151' }}>{counts.nay ?? 0}</TableCell>
                        <TableCell align="right" sx={{ borderColor: '#374151' }}>{counts.present ?? 0}</TableCell>
                        <TableCell align="right" sx={{ borderColor: '#374151' }}>{counts.not_voting ?? 0}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow sx={{ fontWeight: 600 }}>
                    <TableCell sx={{ borderColor: '#374151' }}>Total</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>{total.yea ?? 0}</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>{total.nay ?? 0}</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>{total.present ?? 0}</TableCell>
                    <TableCell align="right" sx={{ borderColor: '#374151' }}>{total.not_voting ?? 0}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderColor: '#374151' }}>
            <Typography variant="subtitle1" sx={{ color: '#e2e8f0', mb: 1.5 }}>
              All votes ({filteredMembers.length}{filteredMembers.length !== members.length ? ` of ${members.length}` : ''} members)
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel id="roll-call-filter-party" sx={{ color: '#94a3b8' }}>Party</InputLabel>
                <Select
                  labelId="roll-call-filter-party"
                  value={rollCallVoteFilterParty}
                  label="Party"
                  onChange={(e) => setRollCallVoteFilterParty(e.target.value)}
                  sx={{ color: '#e2e8f0', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' } }}
                >
                  <MenuItem value="">All</MenuItem>
                  {partyOptions.map((p) => (
                    <MenuItem key={p} value={p}>{p}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <InputLabel id="roll-call-filter-state" sx={{ color: '#94a3b8' }}>State</InputLabel>
                <Select
                  labelId="roll-call-filter-state"
                  value={rollCallVoteFilterState}
                  label="State"
                  onChange={(e) => setRollCallVoteFilterState(e.target.value)}
                  sx={{ color: '#e2e8f0', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' } }}
                >
                  <MenuItem value="">All</MenuItem>
                  {stateOptions.map((s) => (
                    <MenuItem key={s} value={s}>{s}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel id="roll-call-filter-vote" sx={{ color: '#94a3b8' }}>Vote</InputLabel>
                <Select
                  labelId="roll-call-filter-vote"
                  value={rollCallVoteFilterVote}
                  label="Vote"
                  onChange={(e) => setRollCallVoteFilterVote(e.target.value)}
                  sx={{ color: '#e2e8f0', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#374151' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' } }}
                >
                  <MenuItem value="">All</MenuItem>
                  {voteOptions.map((v) => (
                    <MenuItem key={v} value={v}>{v}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <TableContainer sx={{ maxHeight: 400, overflow: 'auto', ...rollCallTableScrollbarSx }}>
              <Table size="small" stickyHeader sx={{ '& th, & td': { color: '#cbd5e1', borderColor: '#374151' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ borderColor: '#374151' }}>Representative</TableCell>
                    <TableCell sx={{ borderColor: '#374151' }}>Party</TableCell>
                    <TableCell sx={{ borderColor: '#374151' }}>State</TableCell>
                    <TableCell sx={{ borderColor: '#374151' }}>Vote</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredMembers.map((m, idx) => (
                    <TableRow key={(m as any).bioguideID ?? idx}>
                      <TableCell sx={{ borderColor: '#374151' }}>{memberDisplayName(m)}</TableCell>
                      <TableCell sx={{ borderColor: '#374151' }}>{memberPartyLabel(m)}</TableCell>
                      <TableCell sx={{ borderColor: '#374151' }}>{memberStateLabel(m)}</TableCell>
                      <TableCell sx={{ borderColor: '#374151' }}>{memberVoteLabel(m)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Box>
      );
    }

    // Congress Bill
    if (itemType === 'congress_bill' || itemData?.bill_id || itemData?.bill_type || itemData?.bill_number) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          {itemData?.bill_title && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                Bill Title
              </Typography>
              <Typography variant="body1" sx={{ color: '#e5e7eb', fontStyle: 'italic' }}>
                {itemData.bill_title}
              </Typography>
            </Box>
          )}

          {/* Status of Legislation — horizontal tracker (congress.gov style) */}
          {(() => {
            const { stageIndex, stageLabel, vetoed } = getBillLegislativeStage(itemData ?? undefined);
            const statusForSr = vetoed ? 'To President — Vetoed by President' : stageLabel;
            return (
              <Box
                sx={{
                  mb: 4,
                  backgroundColor: 'rgba(30, 41, 59, 0.5)',
                  borderRadius: '8px',
                  border: '1px solid #374151',
                  overflow: 'hidden',
                }}
              >
                <Box
                  component="table"
                  sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { verticalAlign: 'top', py: 1.5, px: 2, borderBottom: '1px solid #374151' }, '& tr:last-child th, & tr:last-child td': { borderBottom: 0 }, '& th': { color: '#94a3b8', fontWeight: 600, fontSize: '0.875rem', whiteSpace: 'nowrap', width: 120, pr: 2 } }}
                >
                  <Box component="tbody">
                    <Box component="tr">
                      <Box component="th" scope="row" sx={{ pt: 2 }}>
                        <Box component="span" sx={{ color: '#94a3b8' }}>
                          Tracker:
                        </Box>
                        <Tooltip
                          title={
                            <span>
                              The tracker indicates the progress of this legislation as it moves through the legislative process.{' '}
                              <a href="https://www.congress.gov/legislative-process" target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd', textDecoration: 'underline' }}>
                                The Legislative Process
                              </a>
                            </span>
                          }
                        >
                          <Box component="span" sx={{ ml: 0.5, color: '#10b981', cursor: 'help', display: 'inline-flex', alignItems: 'center' }} aria-label="Tip">
                            <InfoIcon sx={{ fontSize: 18 }} />
                          </Box>
                        </Tooltip>
                      </Box>
                      <Box component="td" sx={{ pt: 2, pb: 2 }}>
                        <Box component="p" sx={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }} aria-live="polite">
                          This bill has the status {statusForSr}
                        </Box>
                        <Box component="p" sx={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
                          Here are the steps for Status of Legislation:
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                          <Box
                            component="ol"
                            className="bill_progress"
                            sx={{
                              display: 'flex',
                              flexDirection: 'row',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              margin: 0,
                              padding: 0,
                              listStyle: 'none',
                              gap: 0,
                              '& > li': {
                                display: 'inline-flex',
                                alignItems: 'center',
                                color: '#9ca3af',
                                fontSize: '0.8125rem',
                                padding: '6px 8px',
                                borderRadius: '4px',
                              },
                              '& > li.selected': {
                                color: '#e2e8f0',
                                fontWeight: 600,
                                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                              },
                              '& > li.last': {
                                paddingRight: 0,
                              },
                            }}
                          >
                            {LEGISLATIVE_STAGES.map((step, idx) => (
                              <React.Fragment key={step.key}>
                                <Box
                                  component="li"
                                  className={[idx === stageIndex ? 'selected' : '', idx === LEGISLATIVE_STAGES.length - 1 ? 'last' : ''].filter(Boolean).join(' ') || undefined}
                                >
                                  {step.label}
                                </Box>
                                {idx < LEGISLATIVE_STAGES.length - 1 && (
                                  <Box component="span" sx={{ color: '#4b5563', fontSize: '0.75rem', px: 0.5 }} aria-hidden="true">
                                    ›
                                  </Box>
                                )}
                              </React.Fragment>
                            ))}
                          </Box>
                          {vetoed && (
                            <Chip
                              size="small"
                              label="Vetoed"
                              sx={{
                                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                color: '#fca5a5',
                                border: '1px solid rgba(239, 68, 68, 0.5)',
                                fontWeight: 600,
                              }}
                              aria-label="Vetoed by President"
                            />
                          )}
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </Box>
            );
          })()}

          {/* Bill Overview Section */}
          <Box sx={{ mb: 4, borderBottom: '1px solid #374151', pb: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {/* Left Column: Sponsor & Bill Info */}
              <Box>
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Sponsor
                  </Typography>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {itemData?.sponsor_full_name || itemData?.sponsor_name || 'N/A'}
                  </Typography>
                  {itemData?.sponsor_party && itemData?.sponsor_state && (
                    <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>
                      {itemData.sponsor_party} - {itemData.sponsor_state}
                    </Typography>
                  )}
                </Box>
                
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Bill Information
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {itemData?.bill_type && itemData?.bill_number && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Type:</strong> {itemData.bill_type}.{itemData.bill_number}
                      </Typography>
                    )}
                    {itemData?.congress && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Congress:</strong> {itemData.congress}
                      </Typography>
                    )}
                    {itemData?.policy_area && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Policy Area:</strong> {itemData.policy_area}
                      </Typography>
                    )}
                    {itemData?.bipartisan !== undefined && itemData?.bipartisan !== null && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Bipartisan:</strong> {itemData.bipartisan === 1 ? 'Yes' : 'No'}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Box>
              
              {/* Right Column: Dates & Actions */}
              <Box>
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Dates
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {itemData?.introduced_date && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Introduced:</strong> {formatDate(itemData.introduced_date)}
                      </Typography>
                    )}
                    {itemData?.latest_action_date && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Latest Action:</strong> {formatDate(itemData.latest_action_date)}
                      </Typography>
                    )}
                    {itemData?.update_date && (
                      <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                        <strong>Last Updated:</strong> {formatDate(itemData.update_date)}
                      </Typography>
                    )}
                  </Box>
                </Box>
                
                {itemData?.action_count !== undefined && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                      Actions
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                      {itemData.action_count || 0} action(s)
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>

          {/* Bill Details: tabbed section (congress.gov style) */}
          {(() => {
            const summaryCount = itemData?.summary_count ?? (itemData?.summary_text ? 1 : 0);
            let textVersions: any[] = [];
            try {
              if (itemData?.text_versions_json) {
                const tv = typeof itemData.text_versions_json === 'string' ? JSON.parse(itemData.text_versions_json) : itemData.text_versions_json;
                textVersions = Array.isArray(tv) ? tv : [];
              }
            } catch { /* ignore */ }
            const actionsCount = Number(itemData?.action_count) || 0;
            let titles: any[] = [];
            try {
              if (itemData?.titles_json) {
                const t = typeof itemData.titles_json === 'string' ? JSON.parse(itemData.titles_json) : itemData.titles_json;
                titles = Array.isArray(t) ? t : [];
              }
            } catch { /* ignore */ }
            const amendmentsCount = Number(itemData?.amendment_count) || 0;
            const cosponsorsCount = Number(itemData?.cosponsor_count) || 0;
            let committees: any[] = [];
            try {
              if (itemData?.committees_json) {
                const c = typeof itemData.committees_json === 'string' ? JSON.parse(itemData.committees_json) : itemData.committees_json;
                committees = Array.isArray(c) ? c : [];
              }
            } catch { /* ignore */ }
            let relatedBills: any[] = [];
            try {
              if (itemData?.related_bills_json) {
                const r = typeof itemData.related_bills_json === 'string' ? JSON.parse(itemData.related_bills_json) : itemData.related_bills_json;
                relatedBills = Array.isArray(r) ? r : [];
              }
            } catch { /* ignore */ }
            let recordedVotes: any[] = [];
            try {
              if (itemData?.recorded_votes_json) {
                const v = typeof itemData.recorded_votes_json === 'string' ? JSON.parse(itemData.recorded_votes_json) : itemData.recorded_votes_json;
                recordedVotes = Array.isArray(v) ? v : [];
              }
            } catch { /* ignore */ }
            const hasRollCall = Number(itemData?.has_roll_call) === 1;
            const votesCount = recordedVotes.length;

            const formatVoteResult = (v: any): string | null => {
              if (v?.result && typeof v.result === 'string') return v.result;
              const yea = Number(v?.yea) || 0;
              const nay = Number(v?.nay) || 0;
              const present = Number(v?.present) || 0;
              const notVoting = Number(v?.not_voting) ?? Number(v?.notVoting) ?? 0;
              if (yea === 0 && nay === 0 && present === 0 && notVoting === 0) return null;
              const outcome = yea > nay ? 'Passed' : nay > yea ? 'Failed' : 'Tied';
              let s = `${outcome} - Yea: ${yea} | Nay: ${nay}`;
              const byParty = v?.by_party ?? v?.byParty;
              if (byParty && typeof byParty === 'object') {
                const parts: string[] = [];
                for (const [party, counts] of Object.entries(byParty as Record<string, { yea?: number; nay?: number; present?: number; not_voting?: number }>)) {
                  const y = counts?.yea ?? 0;
                  const n = counts?.nay ?? 0;
                  const p = counts?.present ?? 0;
                  const nv = counts?.not_voting ?? 0;
                  parts.push(`${party} ${y}-${n} Pres=${p} NV=${nv}`);
                }
                if (parts.length) s += ` (${parts.join(', ')})`;
              }
              return s;
            };

            const tabLabels: { id: string; label: string; count: number; show: boolean }[] = [
              { id: 'summary', label: 'Summary', count: summaryCount, show: true },
              { id: 'text', label: 'Text', count: textVersions.length, show: true },
              { id: 'actions', label: 'Actions', count: actionsCount, show: true },
              { id: 'titles', label: 'Titles', count: titles.length, show: true },
              { id: 'amendments', label: 'Amendments', count: amendmentsCount, show: true },
              { id: 'cosponsors', label: 'Cosponsors', count: cosponsorsCount, show: true },
              { id: 'committees', label: 'Committees', count: committees.length, show: true },
              { id: 'related_bills', label: 'Related Bills', count: relatedBills.length, show: true },
              { id: 'votes', label: 'Votes', count: votesCount, show: hasRollCall },
            ];
            const visibleTabs = tabLabels.filter((t) => t.show);
            const tabIndexToId = visibleTabs.map((t) => t.id);
            const safeTabIndex = visibleTabs.length > 0 ? Math.max(0, Math.min(billDetailsTab, visibleTabs.length - 1)) : 0;
            const currentTabId = tabIndexToId[safeTabIndex] ?? 'summary';

            if (visibleTabs.length === 0) return null;

            return (
              <Box sx={{ mb: 4 }}>
                <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                  Bill Details:
                </Typography>
                <Tabs
                  value={safeTabIndex}
                  onChange={(_, v) => setBillDetailsTab(v)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{
                    borderBottom: '1px solid #374151',
                    minHeight: 40,
                    '& .MuiTab-root': { minHeight: 40, py: 1, textTransform: 'none', fontWeight: 600 },
                    '& .Mui-selected': { color: '#3b82f6' },
                    '& .MuiTabs-indicator': { backgroundColor: '#3b82f6' },
                  }}
                >
                  {visibleTabs.map((tab, idx) => (
                    <Tab
                      key={tab.id}
                      label={
                        <span>
                          {tab.label} <span style={{ fontWeight: 400, opacity: 0.8 }}>({tab.count})</span>
                        </span>
                      }
                      id={`bill-tab-${idx}`}
                      aria-controls={`bill-tabpanel-${idx}`}
                    />
                  ))}
                </Tabs>
                <Box role="tabpanel" id={`bill-tabpanel-${safeTabIndex}`} aria-labelledby={`bill-tab-${safeTabIndex}`} sx={{ pt: 2 }}>
                  {currentTabId === 'summary' && (
                    <Box sx={{ p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                      {itemData?.summary_text ? (
                        <Typography
                          variant="body1"
                          sx={{ color: '#e2e8f0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
                          dangerouslySetInnerHTML={{ __html: itemData.summary_text.replace(/\n/g, '<br />') || '' }}
                        />
                      ) : (
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>No summary available.</Typography>
                      )}
                    </Box>
                  )}
                  {currentTabId === 'text' && (() => {
                    // Prefer bill_texts array [{ name, s3_key, type }]; fallback to legacy bill_text_versions_s3_json
                    type BillTextEntry = { name?: string; s3_key: string; type?: string };
                    let storedVersions: BillTextEntry[] = [];
                    try {
                      if (Array.isArray(itemData?.bill_texts) && itemData.bill_texts.length > 0) {
                        storedVersions = itemData.bill_texts as BillTextEntry[];
                      } else if (itemData?.bill_text_versions_s3_json) {
                        const v = typeof itemData.bill_text_versions_s3_json === 'string' ? JSON.parse(itemData.bill_text_versions_s3_json) : itemData.bill_text_versions_s3_json;
                        storedVersions = Array.isArray(v) ? v.map((x: { type?: string; s3_key: string }) => ({ name: (x as any).name ?? undefined, s3_key: x.s3_key, type: (x as any).type ?? undefined })) : [];
                      }
                    } catch { /* ignore */ }
                    // Public URL for View: from text_versions_json (Congress.gov/govinfo), match by type or index. Derive HTML from govinfo XML for display.
                    const deriveGovinfoHtmlUrl = (url: string) => {
                      if (!url || !url.includes('govinfo.gov') || !url.includes('/xml/') || !url.endsWith('.xml')) return url;
                      return url.replace('/xml/', '/html/').replace(/\.xml$/i, '.htm');
                    };
                    const getPublicViewUrl = (ver: BillTextEntry, idx: number): string | null => {
                      if (!textVersions.length) return itemData?.bill_url || null;
                      const byType = textVersions.find((t: any) => (t.type || '').trim() === (ver.type || '').trim());
                      const entry = byType ?? textVersions[idx];
                      if (!entry) return itemData?.bill_url || null;
                      const raw = entry.url || entry.formats?.[0]?.url;
                      if (!raw) return itemData?.bill_url || null;
                      return deriveGovinfoHtmlUrl(raw);
                    };
                    if (storedVersions.length > 0) {
                      return (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: '400px', overflowY: 'auto', ...scrollbarStyles }}>
                          {storedVersions.map((ver: BillTextEntry, idx: number) => {
                            const label = ver.type || ver.name || ver.s3_key.split('/').pop() || `File ${idx + 1}`;
                            const filename = ver.name || ver.s3_key.split('/').pop() || `bill-${idx + 1}.html`;
                            const publicViewUrl = getPublicViewUrl(ver, idx);
                            return (
                              <Box
                                key={idx}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1.5,
                                  p: 1.5,
                                  backgroundColor: 'rgba(31, 41, 55, 0.5)',
                                  border: '1px solid #374151',
                                  borderRadius: '4px',
                                }}
                              >
                                <DocumentIcon sx={{ fontSize: 18, color: '#3b82f6', flexShrink: 0 }} />
                                <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, minWidth: 0 }}>{label}</Typography>
                                {publicViewUrl ? (
                                  <Link
                                    href={publicViewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    sx={{
                                      color: '#3b82f6',
                                      textDecoration: 'none',
                                      fontSize: '0.875rem',
                                      flexShrink: 0,
                                      '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                                    }}
                                  >
                                    View
                                  </Link>
                                ) : (
                                  <Typography component="span" variant="body2" sx={{ color: '#6b7280', fontSize: '0.875rem', flexShrink: 0 }}>View</Typography>
                                )}
                                <IconButton
                                  size="small"
                                  onClick={() => handleDownloadFile(ver.s3_key, filename, 'CONGRESS_BILLS')}
                                  disabled={downloadLoading}
                                  sx={{
                                    color: '#3b82f6',
                                    flexShrink: 0,
                                    '&:hover': { color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                                  }}
                                >
                                  {downloadLoading ? <CircularProgress size={20} /> : <DownloadIcon fontSize="small" />}
                                </IconButton>
                              </Box>
                            );
                          })}
                        </Box>
                      );
                    }
                    if (textVersions.length === 0) return <Typography variant="body2" sx={{ color: '#9ca3af' }}>No text versions.</Typography>;
                    return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {textVersions.map((ver: any, idx: number) => (
                          <Box key={idx} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                            <Typography variant="body2" sx={{ color: '#e2e8f0' }}>{ver.type || `Version ${idx + 1}`}</Typography>
                            {ver.url && (
                              <Link href={ver.url} target="_blank" rel="noopener noreferrer" sx={{ color: '#3b82f6', fontSize: '0.875rem' }}>
                                View
                              </Link>
                            )}
                          </Box>
                        ))}
                      </Box>
                    );
                  })()}
                  {currentTabId === 'actions' && (() => {
                    try {
                      const actions = itemData?.actions_json ? (typeof itemData.actions_json === 'string' ? JSON.parse(itemData.actions_json) : itemData.actions_json) : [];
                      if (!Array.isArray(actions) || actions.length === 0) {
                        return itemData?.actions_summary ? (
                          <Typography variant="body1" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{itemData.actions_summary}</Typography>
                        ) : (
                          <Typography variant="body2" sx={{ color: '#9ca3af' }}>No actions.</Typography>
                        );
                      }
                      return (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {actions.map((action: any, idx: number) => (
                            <Box key={idx} sx={{ p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                <Typography variant="body2" sx={{ color: '#94a3b8', fontWeight: 600 }}>{action.actionDate && formatDate(action.actionDate)}</Typography>
                                {action.type && <Chip label={action.type} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6' }} />}
                              </Box>
                              {action.text && <Typography variant="body1" sx={{ color: '#e2e8f0', mt: 1 }}>{action.text}</Typography>}
                              {action.committees && Array.isArray(action.committees) && action.committees.length > 0 && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>Committees: </Typography>
                                  {action.committees.map((c: any, cIdx: number) => (
                                    <Typography key={cIdx} variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>• {c.name || c.systemCode}</Typography>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          ))}
                        </Box>
                      );
                    } catch {
                      return <Typography variant="body1" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{itemData?.actions_summary || 'No actions.'}</Typography>;
                    }
                  })()}
                  {currentTabId === 'titles' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {titles.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>No titles.</Typography>
                      ) : (
                        titles.map((t: any, idx: number) => (
                          <Box key={idx} sx={{ p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                            {t.titleType && <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>{t.titleType}</Typography>}
                            <Typography variant="body1" sx={{ color: '#e2e8f0' }}>{t.title || t.name || '—'}</Typography>
                          </Box>
                        ))
                      )}
                    </Box>
                  )}
                  {currentTabId === 'amendments' && (
                    <Box>
                      {amendmentsCount === 0 ? (
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>No amendments.</Typography>
                      ) : (
                        <Typography variant="body1" sx={{ color: '#e2e8f0' }}>Amendments count: {amendmentsCount}. (Full amendments data can be added here if stored.)</Typography>
                      )}
                    </Box>
                  )}
                  {currentTabId === 'cosponsors' && (() => {
                    try {
                      const cosponsors = itemData?.cosponsors_json ? (typeof itemData.cosponsors_json === 'string' ? JSON.parse(itemData.cosponsors_json) : itemData.cosponsors_json) : [];
                      const arr = Array.isArray(cosponsors) ? cosponsors : [];
                      if (arr.length === 0) return <Typography variant="body2" sx={{ color: '#9ca3af' }}>No cosponsors.</Typography>;
                      return (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {arr.map((c: any, idx: number) => (
                            <Chip
                              key={idx}
                              label={`${c.fullName || c.name || 'Unknown'} (${c.party || ''}-${c.state || ''})`}
                              sx={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid #3b82f6' }}
                            />
                          ))}
                        </Box>
                      );
                    } catch {
                      return <Typography variant="body2" sx={{ color: '#9ca3af' }}>No cosponsors.</Typography>;
                    }
                  })()}
                  {currentTabId === 'committees' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {committees.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>No committees.</Typography>
                      ) : (
                        committees.map((c: any, idx: number) => (
                          <Box key={idx} sx={{ p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                            <Typography variant="subtitle2" sx={{ color: '#3b82f6' }}>{c.chamber} - {c.name || c.systemCode}</Typography>
                            {c.type && <Typography variant="caption" sx={{ color: '#94a3b8' }}>{c.type}</Typography>}
                            {c.activities && Array.isArray(c.activities) && c.activities.length > 0 && (
                              <Box sx={{ mt: 1 }}>
                                {c.activities.map((a: any, aIdx: number) => (
                                  <Typography key={aIdx} variant="body2" sx={{ color: '#e2e8f0' }}>
                                    {a.name}{a.date ? ` (${formatDate(a.date)})` : ''}
                                  </Typography>
                                ))}
                              </Box>
                            )}
                          </Box>
                        ))
                      )}
                    </Box>
                  )}
                  {currentTabId === 'related_bills' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {relatedBills.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>No related bills.</Typography>
                      ) : (
                        relatedBills.map((r: any, idx: number) => (
                          <Box key={idx} sx={{ p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                            <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                              {r.type} {r.number} - {r.latestTitle || r.title || '—'}
                            </Typography>
                            {r.latestAction?.text && (
                              <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>{r.latestAction.text}</Typography>
                            )}
                            {r.relationshipDetails && Array.isArray(r.relationshipDetails) && (
                              <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {r.relationshipDetails.map((rd: any, rdIdx: number) => (
                                  <Chip key={rdIdx} label={rd.type} size="small" sx={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd' }} />
                                ))}
                              </Box>
                            )}
                          </Box>
                        ))
                      )}
                    </Box>
                  )}
                  {currentTabId === 'votes' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {recordedVotes.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#9ca3af' }}>No roll call votes.</Typography>
                      ) : (
                        recordedVotes.map((v: any, idx: number) => {
                          const congress = itemData?.congress ?? (itemData?.bill_id ? parseInt(String(itemData.bill_id).split('-')[0], 10) : undefined);
                          const session = v.sessionNumber ?? v.session;
                          const roll = v.rollNumber ?? v.roll;
                          const rollDisplay = v.roll_display ?? `Roll no. ${roll}`;
                          const chamber = (v.chamber ?? 'House').toLowerCase();
                          const congressGovVoteUrl = typeof congress === 'number' && session != null && roll != null
                            ? `https://www.congress.gov/votes/${chamber}/${congress}-${session}/${roll}`
                            : v.url || null;
                          const rollKey = typeof congress === 'number' && session != null && roll != null ? `${congress}#${session}#${roll}` : '';
                          const voteSummary = rollKey ? billVoteResultsByKey[rollKey] : null;
                          const resultText = voteSummary
                            ? formatVoteResult({
                                yea: voteSummary.total?.yea,
                                nay: voteSummary.total?.nay,
                                present: voteSummary.total?.present,
                                not_voting: voteSummary.total?.not_voting,
                                by_party: voteSummary.by_party,
                              })
                            : formatVoteResult(v);
                          return (
                            <Box key={idx} sx={{ p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: resultText ? 1 : 0 }}>
                                <Box>
                                  <Typography variant="subtitle2" sx={{ color: '#e2e8f0' }}>{v.chamber ?? 'House'} — {rollDisplay}</Typography>
                                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block' }}>
                                    Congress {congress ?? '—'} · Session {session ?? '—'} · Roll #{roll ?? '—'}
                                    {v.date ? ` · ${formatDate(v.date)}` : ''}
                                  </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  {typeof congress === 'number' && session != null && roll != null && (
                                    <Link
                                      component="button"
                                      variant="body2"
                                      sx={{ color: '#3b82f6', cursor: 'pointer', textTransform: 'none', '&:hover': { textDecoration: 'underline' } }}
                                      onClick={() => openItemDetails('roll_call', { congress, session: Number(session), roll: Number(roll) }, rollDisplay, { user_id: user_id || user?.id })}
                                    >
                                      View
                                    </Link>
                                  )}
                                  {(congressGovVoteUrl || v.url) && (
                                    <Tooltip title="View voter data on Congress.gov">
                                      <IconButton
                                        size="small"
                                        component="a"
                                        href={congressGovVoteUrl || v.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={{
                                          color: '#9ca3af',
                                          '&:hover': { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                                        }}
                                      >
                                        <OpenInNewIcon sx={{ fontSize: 18 }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Box>
                              </Box>
                              {resultText && (
                                <Typography variant="body2" sx={{ color: '#cbd5e1', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                                  {resultText}
                                </Typography>
                              )}
                            </Box>
                          );
                        })
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })()}

          {/* Bill URL */}
          {itemData?.bill_url && (
            <Box sx={{ mt: 3 }}>
              <Button
                variant="outlined"
                component="a"
                href={itemData.bill_url}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LaunchIcon />}
                sx={{
                  color: '#3b82f6',
                  borderColor: '#3b82f6',
                  '&:hover': {
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  },
                }}
              >
                View on Congress.gov
              </Button>
            </Box>
          )}
        </Box>
      );
    }

    // LDA Disclosure
    if (itemType === 'lda_disclosure' || itemData?.filing_uuid || itemData?.registrant_name || itemData?.client_name) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600, mb: 2 }}>
            {title || 'LDA Disclosure'}
          </Typography>

          {/* Filing Information */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Filing Information
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {itemData?.filing_uuid && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing UUID:</strong> <span style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{itemData.filing_uuid}</span>
                </Typography>
              )}
              {(itemData?.report_type || itemData?.filing_type) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing Type:</strong> {itemData.report_type || itemData.filing_type || 'N/A'}
                  {(itemData?.report_type_display || itemData?.filing_type_display) && ` (${itemData.report_type_display || itemData.filing_type_display})`}
                </Typography>
              )}
              {(itemData?.filing_period_display || itemData?.filing_period) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing Period:</strong> {itemData.filing_period_display || itemData.filing_period || 'N/A'}
                </Typography>
              )}
              {itemData?.filing_year && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Filing Year:</strong> {itemData.filing_year}
                </Typography>
              )}
              {(itemData?.dt_posted || itemData?.date_posted) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Date Posted:</strong> {formatDate(itemData.dt_posted || itemData.date_posted)}
                </Typography>
              )}
              {(itemData?.amount_reported || itemData?.amount) && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>Amount:</strong> {formatLDACurrency(itemData.amount_reported || itemData.amount)}
                </Typography>
              )}
              {itemData?.general_issue_code && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>General Issue Code:</strong> {itemData.general_issue_code}
                  {itemData?.general_issue_code_display && ` (${itemData.general_issue_code_display})`}
                </Typography>
              )}
              {itemData?.state && (
                <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                  <strong>State:</strong> {itemData.state}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Registrant Information */}
          {(itemData?.registrant || itemData?.registrant_name) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Registrant
              </Typography>
              <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.95rem' }}>
                {itemData.registrant?.name || itemData.registrant_name || 'N/A'}
              </Typography>
              {itemData?.registrant?.description && (
                <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1, fontStyle: 'italic' }}>
                  {itemData.registrant.description}
                </Typography>
              )}
            </Box>
          )}

          {/* Client Information */}
          {(itemData?.client || itemData?.client_name) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Client
              </Typography>
              <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '0.95rem' }}>
                {itemData.client?.name || itemData.client_name || 'N/A'}
              </Typography>
              {itemData?.client?.general_description && (
                <Typography variant="body2" sx={{ color: '#e2e8f0', mt: 1, fontStyle: 'italic' }}>
                  {itemData.client.general_description}
                </Typography>
              )}
            </Box>
          )}

          {/* All Lobbyist Names - Handle both FILING (all_lobbyist_names) and CONTRIBUTION (lobbyist_name/lobbyist) types */}
          {(() => {
            // For FILING type: use all_lobbyist_names array
            // For CONTRIBUTION type: use lobbyist_name or construct from lobbyist object
            let lobbyistNames: string[] = [];
            
            if (itemData?.all_lobbyist_names && Array.isArray(itemData.all_lobbyist_names) && itemData.all_lobbyist_names.length > 0) {
              lobbyistNames = itemData.all_lobbyist_names;
            } else if (itemData?.lobbyist_name) {
              // CONTRIBUTION type with top-level lobbyist_name
              lobbyistNames = [itemData.lobbyist_name];
            } else if (itemData?.lobbyist) {
              // CONTRIBUTION type with nested lobbyist object
              const lobbyist = itemData.lobbyist;
              const name = lobbyist.nickname || 
                `${lobbyist.prefix_display || ''} ${lobbyist.first_name || ''} ${lobbyist.middle_name || ''} ${lobbyist.last_name || ''} ${lobbyist.suffix_display || ''}`.trim() ||
                `${lobbyist.first_name || ''} ${lobbyist.last_name || ''}`.trim() ||
                'Unknown Lobbyist';
              if (name && name !== 'Unknown Lobbyist') {
                lobbyistNames = [name];
              }
            }
            
            return lobbyistNames.length > 0 ? (
              <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
                <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                  Lobbyists
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {lobbyistNames.map((name: string, index: number) => (
                    <Chip
                      key={index}
                      label={name}
                      size="small"
                      sx={{
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        color: '#93c5fd',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        '&:hover': {
                          backgroundColor: 'rgba(59, 130, 246, 0.25)',
                        },
                      }}
                    />
                  ))}
                </Box>
              </Box>
            ) : null;
          })()}

          {/* Lobbying Activities */}
          {itemData?.lobbying_activities && Array.isArray(itemData.lobbying_activities) && itemData.lobbying_activities.length > 0 && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Lobbying Activities
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {itemData.lobbying_activities.map((activity: any, index: number) => (
                  <Box
                    key={index}
                    sx={{
                      p: 2,
                      backgroundColor: 'rgba(15, 23, 42, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #1e293b',
                    }}
                  >
                    {/* Description */}
                    {activity.description && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 2 }}>
                        {activity.description}
                      </Typography>
                    )}

                    {/* General Issue Code */}
                    {(activity.general_issue_code || activity.general_issue_code_display) && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 0.5 }}>
                          General Issue Code
                        </Typography>
                        <Chip
                          label={activity.general_issue_code_display || activity.general_issue_code}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(139, 92, 246, 0.15)',
                            color: '#c4b5fd',
                            border: '1px solid rgba(139, 92, 246, 0.3)',
                          }}
                        />
                        {activity.general_issue_code && activity.general_issue_code_display && activity.general_issue_code !== activity.general_issue_code_display && (
                          <Typography variant="caption" sx={{ color: '#6b7280', ml: 1 }}>
                            ({activity.general_issue_code})
                          </Typography>
                        )}
                      </Box>
                    )}

                    {/* Government Entities */}
                    {activity.government_entities && Array.isArray(activity.government_entities) && activity.government_entities.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 1 }}>
                          Government Entities
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {activity.government_entities.map((entity: any, entityIndex: number) => (
                            <Chip
                              key={entityIndex}
                              label={entity.name || entity}
                              size="small"
                              sx={{
                                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                color: '#6ee7b7',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}

                    {/* Lobbyists for this activity */}
                    {activity.lobbyists && Array.isArray(activity.lobbyists) && activity.lobbyists.length > 0 && (
                      <Box>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 1 }}>
                          Lobbyists ({activity.lobbyists.length})
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {activity.lobbyists.map((lobbyist: any, lobbyistIndex: number) => {
                            const lobbyistName = lobbyist.lobbyist
                              ? `${lobbyist.lobbyist.first_name || ''} ${lobbyist.lobbyist.middle_name || ''} ${lobbyist.lobbyist.last_name || ''} ${lobbyist.lobbyist.suffix_display || ''}`.trim() || lobbyist.lobbyist.nickname || 'Unknown'
                              : lobbyist.name || 'Unknown';
                            return (
                              <Chip
                                key={lobbyistIndex}
                                label={lobbyistName}
                                size="small"
                                sx={{
                                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                  color: '#93c5fd',
                                  border: '1px solid rgba(59, 130, 246, 0.3)',
                                }}
                              />
                            );
                          })}
                        </Box>
                      </Box>
                    )}

                    {/* Foreign Entity Issues */}
                    {activity.foreign_entity_issues && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 0.5 }}>
                          Foreign Entity Issues
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#e2e8f0', fontStyle: 'italic' }}>
                          {activity.foreign_entity_issues}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Filing Document */}
          {(itemData?.filing_document_url || itemData?.s3_key) && (
            <Box sx={{ mt: 4, mb: 2, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                Filing Document
              </Typography>
              <Typography variant="body2" sx={{ color: '#94a3b8', mb: 2 }}>
                The filing document cannot be displayed inline due to security restrictions. You can view or download it using the buttons below.
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                {itemData?.filing_document_url && (
                  <Button
                    component="a"
                    href={itemData.filing_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outlined"
                    startIcon={<OpenInNewIcon />}
                    sx={{
                      color: '#3b82f6',
                      borderColor: '#3b82f6',
                      '&:hover': {
                        borderColor: '#60a5fa',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      },
                    }}
                  >
                    View Document
                  </Button>
                )}
                {itemData?.s3_key && (
                  <Button
                    variant="outlined"
                    startIcon={downloadLoading ? <CircularProgress size={16} /> : <DownloadIcon />}
                    onClick={async () => {
                      if (!itemData?.s3_key) return;
                      
                      setDownloadLoading(true);
                      try {
                        await handleDownloadFile(
                          itemData.s3_key,
                          itemData.s3_key.split('/').pop() || 'filing',
                          'LDA_DISCLOSURES'
                        );
                      } catch (error) {
                        console.error('❌ Download failed:', error);
                        alert('Failed to download file. Please try again.');
                      } finally {
                        setDownloadLoading(false);
                      }
                    }}
                    disabled={downloadLoading}
                    sx={{
                      color: '#3b82f6',
                      borderColor: '#3b82f6',
                      '&:hover': {
                        borderColor: '#60a5fa',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      },
                      '&:disabled': {
                        color: '#6b7280',
                        borderColor: '#6b7280',
                      },
                    }}
                  >
                    Download
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </Box>
      );
    }

    // SEC Filing
    if (itemType === 'sec_filing' || itemData?.form || itemData?.filingEntity || itemData?.accession) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                Filing Information
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {itemData?.form && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Form</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff' }}>{itemData.form}</Typography>
                  </Box>
                )}
                {itemData?.filingDate && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Filing Date</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff' }}>{itemData.filingDate}</Typography>
                  </Box>
                )}
                {(itemData?.reportingFor || itemData?.filingEntity) && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Reporting For</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff' }}>{itemData.reportingFor || itemData.filingEntity}</Typography>
                  </Box>
                )}
                {itemData?.cik && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>CIK</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff', fontFamily: 'monospace' }}>{itemData.cik}</Typography>
                  </Box>
                )}
                {itemData?.accession && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280' }}>Accession Number</Typography>
                    <Typography variant="body2" sx={{ color: '#ffffff', fontFamily: 'monospace' }}>{itemData.accession}</Typography>
                  </Box>
                )}
              </Box>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                Filing Page
              </Typography>
              {itemData?.filingPageUrl ? (
                useDemoData ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#6b7280', cursor: 'not-allowed' }}>
                    <OpenInNewIcon sx={{ fontSize: 16, color: '#6b7280' }} />
                    <Typography variant="body2" sx={{ color: '#6b7280' }}>View on SEC.gov (demo)</Typography>
                  </Box>
                ) : (
                  <Link
                    href={itemData.filingPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: '#3b82f6',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                    }}
                  >
                    <OpenInNewIcon sx={{ fontSize: 16 }} />
                    View on SEC.gov
                  </Link>
                )
              ) : (
                <Typography variant="body2" sx={{ color: '#9ca3af' }}>Not available</Typography>
              )}
            </Grid>

            {/* Document URLs */}
            {itemData?.documentUrls && itemData.documentUrls.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                  Document Format Files ({itemData.documentUrls.length})
                </Typography>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 1, 
                  maxHeight: '400px', 
                  overflowY: 'auto',
                  ...scrollbarStyles,
                }}>
                  {itemData.documentUrls.map((url: string, index: number) => {
                    const filename = url.split('/').pop() || `Document ${index + 1}`;
                    const s3Key = itemData.documentS3Keys?.[url];
                    const grayed = useDemoData;
                    return (
                      <Box
                        key={index}
                        sx={{
                          p: 1.5,
                          border: '1px solid #374151',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(31, 41, 55, 0.5)',
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <DocumentIcon sx={{ fontSize: 18, color: grayed ? '#6b7280' : '#3b82f6' }} />
                          {grayed ? (
                            <Typography
                              component="span"
                              sx={{
                                color: '#6b7280',
                                fontSize: '0.875rem',
                                flex: 1,
                                cursor: 'not-allowed',
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              {filename}
                              <OpenInNewIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle', color: '#6b7280' }} />
                            </Typography>
                          ) : (
                            <Link
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{
                                color: '#3b82f6',
                                textDecoration: 'none',
                                fontSize: '0.875rem',
                                flex: 1,
                                '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                              }}
                            >
                              {filename}
                              <OpenInNewIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle' }} />
                            </Link>
                          )}
                          {s3Key && !grayed && (
                            <IconButton
                              size="small"
                              onClick={() => handleDownloadFile(s3Key, filename, 'SEC_FILINGS')}
                              sx={{
                                color: '#3b82f6',
                                ml: 'auto',
                                '&:hover': { color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.1)' }
                              }}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          )}
                          {grayed && (
                            <DownloadIcon sx={{ fontSize: 18, color: '#6b7280', ml: 'auto' }} />
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Grid>
            )}

            {/* Data Files */}
            {itemData?.dataFileUrls && itemData.dataFileUrls.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                  Data Files ({itemData.dataFileUrls.length})
                </Typography>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 1, 
                  maxHeight: '400px', 
                  overflowY: 'auto',
                  ...scrollbarStyles,
                }}>
                  {itemData.dataFileUrls.map((url: string, index: number) => {
                    const filename = url.split('/').pop() || `Data File ${index + 1}`;
                    const s3Key = itemData.dataFileS3Keys?.[url];
                    const grayed = useDemoData;
                    return (
                      <Box
                        key={index}
                        sx={{
                          p: 1.5,
                          border: '1px solid #374151',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(31, 41, 55, 0.5)',
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <DocumentIcon sx={{ fontSize: 18, color: grayed ? '#6b7280' : '#3b82f6' }} />
                          {grayed ? (
                            <Typography
                              component="span"
                              sx={{
                                color: '#6b7280',
                                fontSize: '0.875rem',
                                flex: 1,
                                cursor: 'not-allowed',
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              {filename}
                              <OpenInNewIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle', color: '#6b7280' }} />
                            </Typography>
                          ) : (
                            <Link
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{
                                color: '#3b82f6',
                                textDecoration: 'none',
                                fontSize: '0.875rem',
                                flex: 1,
                                '&:hover': { color: '#60a5fa', textDecoration: 'underline' },
                              }}
                            >
                              {filename}
                              <OpenInNewIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle' }} />
                            </Link>
                          )}
                          {s3Key && !grayed && (
                            <IconButton
                              size="small"
                              onClick={() => handleDownloadFile(s3Key, filename, 'SEC_FILINGS')}
                              sx={{
                                color: '#3b82f6',
                                ml: 'auto',
                                '&:hover': { color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.1)' }
                              }}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          )}
                          {grayed && (
                            <DownloadIcon sx={{ fontSize: 18, color: '#6b7280', ml: 'auto' }} />
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      );
    }

    // Government Contract - Full details page format with all sections
    if (itemType === 'govt_contract' || itemData?.award_id || itemData?.recipient_name) {
      // Calculate amounts for chart (all numeric for math)
      const obligatedAmount = Number(itemData?.combined_obligated_amount ||
                             itemData?.total_obligated_amount ||
                             itemData?.total_obligation || 0);
      // Check multiple field names for outlayed amount (different API versions use different field names)
      const outlayedAmount = parseFloat(itemData?.total_outlayed_amount_for_overall_award as string) ||
                            parseFloat(itemData?.total_outlay as string) ||
                            parseFloat(itemData?.total_account_outlay as string) || 0;
      const nonFederalFunding = parseFloat(itemData?.total_non_federal_funding_amount as string) || 0;
      // Total Funding = Obligated + Non-Federal (per USAspending)
      const totalFunding = obligatedAmount + nonFederalFunding;
      
      return (
        <Box>
          {/* Award Overview Section - Two Columns */}
          <Box sx={{ mb: 4, borderBottom: '1px solid #374151', pb: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {/* Left Column: Awarding Agency & Recipient */}
              <Box>
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Awarding Agency
                  </Typography>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {itemData?.awarding_agency_name || 'N/A'}
                    {itemData?.awarding_agency_code && (
                      <Typography component="span" variant="body2" sx={{ color: '#64748b', ml: 1 }}>
                        ({itemData.awarding_agency_code})
                      </Typography>
                    )}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                    Recipient
                  </Typography>
                  <Typography variant="h6" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {itemData?.recipient_name || (itemData?.recipient_name_normalized ? itemData.recipient_name_normalized.toUpperCase() : 'N/A')}
                  </Typography>
                  {itemData?.recipient_city_name && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                        {itemData.recipient_city_name}
                        {itemData?.recipient_location_state && `, ${itemData.recipient_location_state}`}
                        {itemData?.recipient_zip_code && ` ${itemData.recipient_zip_code}`}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                        {itemData?.recipient_country_name || itemData?.recipient_location_country || 'UNITED STATES'}
                      </Typography>
                      {itemData?.prime_award_transaction_recipient_cd_current && (
                        <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>
                          Congressional District: {itemData.prime_award_transaction_recipient_cd_current}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
              
              {/* Right Column: Parent Contract & CFDA & Dates */}
              <Box>
                {/* Parent IDV Information for Child Awards - Top Right */}
                {itemData?.is_idv_child && itemData?.parent_idv_id && (
                  <Box sx={{ mb: 3, textAlign: 'right' }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                      Parent Contract
                    </Typography>
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-block',
                        cursor: 'pointer',
                        '&:hover': {
                          opacity: 0.8,
                        },
                      }}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (useDemoData) return;
                        if (!itemData?.parent_idv_id || !user_id) return;
                        
                        try {
                          console.log('📥 Fetching parent contract:', itemData.parent_idv_id);
                          
                          // Make API call to lambda with just the award_id
                          const awardResponse = await govtContractsSearchAPI.getAward({
                            award_id: itemData.parent_idv_id,
                          });
                          
                          if (awardResponse.success && awardResponse.result) {
                            const parentAward = awardResponse.result;
                            console.log('✅ Parent contract fetched, opening new dialog:', parentAward.award_id);
                            
                            // Open new dialog with parent award data
                            const parentTitle = parentAward.recipient_name 
                              ? `Government Contract - ${parentAward.recipient_name}${parentAward.awarding_agency_name ? ` / ${parentAward.awarding_agency_name}` : ''}`
                              : `Government Contract ${parentAward.award_id || ''}`;
                            
                            openItemDetails(
                              'govt_contract',
                              parentAward,
                              parentTitle,
                              {
                                user_id: user_id,
                                parentAward: null, // Don't pass parent since this IS the parent
                              }
                            );
                          } else {
                            console.error('Failed to fetch parent contract:', awardResponse);
                          }
                        } catch (error) {
                          console.error('❌ Error fetching parent contract:', error);
                        }
                      }}
                    >
                      <Typography variant="body2" sx={{ color: '#3b82f6', fontWeight: 600, fontFamily: 'monospace' }}>
                        {itemData.parent_idv_id}
                      </Typography>
                    </Box>
                  </Box>
                )}
                
                {itemData?.cfda_number && (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 1, fontWeight: 600, fontSize: '12px' }}>
                      Assistance Listings (CFDA Programs)
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                      {itemData.cfda_number}
                      {itemData?.cfda_title && ` - ${itemData.cfda_title}`}
                    </Typography>
                  </Box>
                )}
                
                {(() => {
                  const startDate = itemData?.period_of_performance_start_date || itemData?.period_start_date;
                  const endDate = itemData?.period_of_performance_current_end_date || 
                                (itemData?.award_or_idv_flag === 'IDV' ? itemData?.ordering_period_end_date : null) ||
                                itemData?.period_end_date;
                  if (!startDate || !endDate) return null;
                  
                  const start = new Date(startDate);
                  const end = new Date(endDate);
                  const now = new Date();
                  const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                  const elapsedDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                  const progressPercent = Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100));
                  
                  // Calculate years remaining for "In Progress" text
                  const remainingDays = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
                  const yearsRemaining = Math.floor(remainingDays / 365);
                  
                  return (
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600, fontSize: '12px' }}>
                        Dates
                      </Typography>
                        {remainingDays > 0 && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 600 }}>
                              In Progress
                            </Typography>
                            {yearsRemaining > 0 && (
                              <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                                ({yearsRemaining} {yearsRemaining === 1 ? 'year' : 'years'} remain)
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Box>
                      {/* Progress Bar */}
                      <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <svg width="304" height="40">
                          <rect x="0" y="0" rx="5" ry="5" width="304" height="10" fill="#f1f1f1" />
                          <rect x="0" y="0" rx="5" ry="5" width={`${progressPercent}%`} height="10" fill="#10b981" />
                          <circle cx="5" cy="5" r="5" fill="#10b981" />
                          <circle cx="299" cy="5" r="5" fill="#ef4444" />
                          <line 
                            x1={(progressPercent / 100) * 304} 
                            x2={(progressPercent / 100) * 304} 
                            y1="0" 
                            y2="10" 
                            stroke="#64748b" 
                            strokeWidth="2"
                          />
                          <polygon 
                            points={`${(progressPercent / 100) * 304},10 ${(progressPercent / 100) * 304 - 3},15 ${(progressPercent / 100) * 304 + 3},15`}
                            fill="#64748b"
                          />
                        </svg>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, width: '100%' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>Start Date</Typography>
                            <Typography variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>
                              {formatDate(startDate)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                            <Typography variant="caption" sx={{ color: '#94a3b8' }}>End Date</Typography>
                            <Typography variant="body2" sx={{ color: '#e2e8f0', ml: 1 }}>
                              {formatDate(endDate)}
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  );
                })()}
              </Box>
            </Box>
          </Box>

          {/* Award Amounts Visualization */}
          <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography variant="h5" sx={{ color: '#3b82f6', fontWeight: 600 }}>
                $ Award Amounts
              </Typography>
            </Box>
            <Box sx={{ borderBottom: '1px solid #374151', mb: 3 }} />
            
            {/* Chart: simple bar + label flags (total off to the right). */}
            <Box sx={{ mb: 3 }}>
              {(() => {
                const chartWidth = 640;
                const barHeight = 32;
                const chartHeight = 56;
                const labelRowHeight = 56;
                const totalForChart = totalFunding > 0 ? totalFunding : 1;
                const obligatedWidth = (obligatedAmount / totalForChart) * chartWidth;
                const nonFederalWidth = (nonFederalFunding / totalForChart) * chartWidth;
                const outlayedWidth = (outlayedAmount / totalForChart) * chartWidth;
                const pct = (x: number) => (x / chartWidth) * 100;
                const bubbleStyle = { px: 1.5, py: 0.75, borderRadius: 1.5, color: '#fff', textAlign: 'center' as const, pointerEvents: 'none' as const };
                const flagAtLine = (lineLeftPct: number, color: string, label: string, amount: number, key: string) => (
                  <Box
                    key={key}
                    sx={{
                      position: 'absolute',
                      left: `max(${lineLeftPct}%, 2%)`,
                      top: 0,
                      transform: 'translateX(-100%)',
                      ...bubbleStyle,
                      bgcolor: color,
                    }}
                  >
                    <Box component="span" sx={{ display: 'block', fontSize: '0.8rem', opacity: 0.95, lineHeight: 1.3 }}>{label}:</Box>
                    <Box component="span" sx={{ display: 'block', fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.35 }}>{formatCurrency(amount)}</Box>
                  </Box>
                );
                return (
                  <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
                    {/* Amount paid bubble above the chart */}
                    <Box sx={{ position: 'relative', minHeight: labelRowHeight, width: '100%', mb: 0.5 }}>
                      {outlayedAmount > 0 && outlayedWidth > 0 && flagAtLine(pct(outlayedWidth), '#10b981', 'Amount paid', outlayedAmount, 'outlayed')}
                    </Box>
                    {/* Chart moved down slightly */}
                    <Box sx={{ width: '100%', minHeight: chartHeight, mt: 0.5 }}>
                      <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" style={{ display: 'block' }}>
                        <rect x="0" y={(chartHeight - barHeight) / 2} width={chartWidth} height={barHeight} fill="rgba(30, 41, 59, 0.5)" />
                        <rect x="0" y={(chartHeight - barHeight) / 2} width={obligatedWidth} height={barHeight} fill="#4773aa" />
                        <rect x={obligatedWidth} y={(chartHeight - barHeight) / 2} width={nonFederalWidth} height={barHeight} fill="#64748b" />
                        {outlayedAmount > 0 && (
                          <rect x="0" y={(chartHeight - barHeight) / 2} width={outlayedWidth} height={barHeight} fill="#10b981" />
                        )}
                        {(() => {
                          const barTop = (chartHeight - barHeight) / 2;
                          const barBottom = barTop + barHeight;
                          const lineTop = barTop - barHeight * 0.25;
                          return (
                            <>
                              {outlayedAmount > 0 && outlayedWidth > 0 && (
                                <line x1={outlayedWidth} y1={lineTop} x2={outlayedWidth} y2={barBottom} stroke="#10b981" strokeWidth="2" />
                              )}
                              {obligatedWidth > 0 && obligatedWidth < chartWidth && (
                                <line x1={obligatedWidth} y1={lineTop} x2={obligatedWidth} y2={barBottom} stroke="#4773aa" strokeWidth="2" />
                              )}
                              <line x1={chartWidth} y1={lineTop} x2={chartWidth} y2={barBottom} stroke="#64748b" strokeWidth="2" />
                            </>
                          );
                        })()}
                      </svg>
                    </Box>
                    {/* Obligated amount at blue line (below bar) - separate row so no overlap with amount paid above */}
                    <Box sx={{ position: 'relative', minHeight: labelRowHeight, width: '100%', mt: 0.5 }}>
                      {obligatedWidth > 0 && flagAtLine(pct(obligatedWidth), '#4773aa', 'Obligated amount', obligatedAmount, 'obligated')}
                    </Box>
                    {/* Non-Federal and Total at end below */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, mt: 1 }}>
                      {nonFederalFunding > 0 && (
                        <Box sx={{ ...bubbleStyle, bgcolor: '#64748b' }}>
                          <Box component="span" sx={{ display: 'block', fontSize: '0.8rem', opacity: 0.95, lineHeight: 1.3 }}>Non-Federal funding:</Box>
                          <Box component="span" sx={{ display: 'block', fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.35 }}>{formatCurrency(nonFederalFunding)}</Box>
                        </Box>
                      )}
                      <Box sx={{ ...bubbleStyle, bgcolor: '#64748b' }}>
                        <Box component="span" sx={{ display: 'block', fontSize: '0.8rem', opacity: 0.95, lineHeight: 1.3 }}>Total funding:</Box>
                        <Box component="span" sx={{ display: 'block', fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.35 }}>{formatCurrency(totalFunding)}</Box>
                      </Box>
                    </Box>
                  </Box>
                );
              })()}
            </Box>
            
            {/* Amount Details */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#10b981' }} />
                  <Typography variant="body2" sx={{ color: '#94a3b8' }}>Amount Paid</Typography>
                  <Tooltip
                    title="The total amount of money that has actually been paid out or spent from the obligated amount."
                    arrow
                    placement="top"
                  >
                    <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                  </Tooltip>
                </Box>
                <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  {formatCurrency(outlayedAmount)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#4773aa' }} />
                  <Typography variant="body2" sx={{ color: '#94a3b8' }}>Obligated Amount</Typography>
                  <Tooltip
                    title="The total amount of money that the government has committed to spend on this award. This is the maximum amount that can be paid out."
                    arrow
                    placement="top"
                  >
                    <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                  </Tooltip>
                </Box>
                <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  {formatCurrency(obligatedAmount)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#64748b' }} />
                  <Typography variant="body2" sx={{ color: '#94a3b8' }}>Non-Federal Funding</Typography>
                  <Tooltip
                    title="Funding provided by sources other than the federal government, such as state or local governments, private organizations, or other non-federal entities."
                    arrow
                    placement="top"
                  >
                    <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                  </Tooltip>
                </Box>
                <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  {formatCurrency(nonFederalFunding)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '4px' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: '16px', height: '16px', borderRadius: '2px', backgroundColor: '#64748b' }} />
                  <Typography variant="body2" sx={{ color: '#94a3b8' }}>Total Funding</Typography>
                  <Tooltip
                    title="The sum of all funding sources for this award, including both federal obligated amounts and any non-federal funding contributions."
                    arrow
                    placement="top"
                  >
                    <InfoIcon sx={{ fontSize: '14px', color: '#64748b', cursor: 'help', ml: 0.5 }} />
                  </Tooltip>
                </Box>
                <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  {formatCurrency(totalFunding)}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Basic Award Information */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Award Information
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                  Award ID
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                  {itemData?.award_id || 'N/A'}
                </Typography>
              </Box>
              {itemData?.award_type && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Award Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.award_type}
                  </Typography>
                </Box>
              )}
              {itemData?.is_assistance !== undefined && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Type
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.is_assistance ? 'Financial Assistance' : 'Contract'}
                  </Typography>
                </Box>
              )}
              {itemData?.fiscal_year && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Fiscal Year
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.fiscal_year}
                  </Typography>
                </Box>
              )}
              {(itemData?.combined_obligated_amount || itemData?.total_obligated_amount || itemData?.total_obligation) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    {itemData?.combined_obligated_amount && itemData?.award_or_idv_flag === 'IDV' 
                      ? 'Combined Obligated Amount' 
                      : 'Total Obligated Amount'}
                    {itemData?.award_or_idv_flag === 'IDV' && (
                      <Tooltip
                        title={itemData?.combined_obligated_amount 
                          ? "The combined obligated amount from all child awards (delivery orders) under this IDV."
                          : "For IDV (Indefinite Delivery Vehicle) awards, the obligated amount is typically $0 on the parent award. The actual obligations are on the child awards (delivery orders). Visit USAspending.gov to see the combined obligated amounts from all child awards."}
                        arrow
                        placement="top"
                      >
                        <InfoIcon sx={{ fontSize: '12px', color: '#64748b', cursor: 'help', ml: 0.5, verticalAlign: 'middle' }} />
                      </Tooltip>
                    )}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {formatCurrency(
                      itemData.combined_obligated_amount || 
                      itemData.total_obligated_amount || 
                      itemData.total_obligation
                    )}
                    {itemData?.award_or_idv_flag === 'IDV' && !itemData?.combined_obligated_amount && (itemData?.total_obligated_amount === 0 || !itemData?.total_obligated_amount) && (
                      <Typography component="span" variant="caption" sx={{ color: '#94a3b8', ml: 1, fontStyle: 'italic' }}>
                        (IDV - see child awards)
                      </Typography>
                    )}
                  </Typography>
                </Box>
              )}
              {(itemData?.period_of_performance_start_date || itemData?.period_start_date) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Period Start Date
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatDate(itemData.period_of_performance_start_date || itemData.period_start_date)}
                  </Typography>
                </Box>
              )}
              {(itemData?.period_of_performance_current_end_date || itemData?.period_end_date) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    {itemData?.award_or_idv_flag === 'IDV' && !itemData?.period_of_performance_current_end_date 
                      ? 'Ordering Period End Date' 
                      : 'Period End Date'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {formatDate(
                      itemData.period_of_performance_current_end_date || 
                      (itemData?.award_or_idv_flag === 'IDV' ? itemData?.ordering_period_end_date : null) ||
                      itemData?.period_end_date
                    )}
                  </Typography>
                </Box>
              )}
              {(itemData?.transaction_count !== undefined || itemData?.subaward_count !== undefined) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Transactions / Subawards
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.transaction_count ?? 0} / {itemData.subaward_count ?? 0}
                  </Typography>
                </Box>
              )}
            </Box>
            {itemData?.usaspending_permalink && (
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  href={itemData.usaspending_permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    color: '#3b82f6',
                    borderColor: '#3b82f6',
                    '&:hover': {
                      borderColor: '#60a5fa',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    },
                  }}
                >
                  View on USAspending.gov
                </Button>
              </Box>
            )}
          </Box>

          {/* Agency Information */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Agency Information
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                  Awarding Agency
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                  {itemData?.awarding_agency_name || 'N/A'}
                </Typography>
                {itemData?.awarding_agency_code && (
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Code: {itemData.awarding_agency_code}
                  </Typography>
                )}
                {itemData?.awarding_sub_agency_name && (
                  <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                    Sub-Agency: {itemData.awarding_sub_agency_name}
                    {itemData?.awarding_sub_agency_code && ` (${itemData.awarding_sub_agency_code})`}
                  </Typography>
                )}
                {itemData?.awarding_office_name && (
                  <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                    Office: {itemData.awarding_office_name}
                    {itemData?.awarding_office_code && ` (${itemData.awarding_office_code})`}
                  </Typography>
                )}
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1, fontWeight: 600 }}>
                  Funding Agency
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                  {itemData?.funding_agency_name || 'N/A'}
                </Typography>
                {itemData?.funding_agency_code && (
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Code: {itemData.funding_agency_code}
                  </Typography>
                )}
                {itemData?.funding_sub_agency_name && (
                  <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                    Sub-Agency: {itemData.funding_sub_agency_name}
                    {itemData?.funding_sub_agency_code && ` (${itemData.funding_sub_agency_code})`}
                  </Typography>
                )}
                {itemData?.funding_office_name && (
                  <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                    Office: {itemData.funding_office_name}
                    {itemData?.funding_office_code && ` (${itemData.funding_office_code})`}
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>

          {/* Recipient Information */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Recipient Information
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                  Recipient Name
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                  {itemData?.recipient_name || (itemData?.recipient_name_normalized ? itemData.recipient_name_normalized.toUpperCase() : 'N/A')}
                </Typography>
              </Box>
              {(itemData?.recipient_id || itemData?.recipient_uei) && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    {itemData?.recipient_uei ? 'UEI' : 'Recipient ID'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {itemData?.recipient_uei || itemData?.recipient_id || 'N/A'}
                  </Typography>
                </Box>
              )}
              {itemData?.recipient_location_state && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    State
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.recipient_location_state}
                    {itemData?.recipient_state_name && ` (${itemData.recipient_state_name})`}
                  </Typography>
                </Box>
              )}
              {itemData?.recipient_location_country && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Country
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.recipient_location_country}
                    {itemData?.recipient_country_name && ` (${itemData.recipient_country_name})`}
                  </Typography>
                </Box>
              )}
              {itemData?.recipient_city_name && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    City
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.recipient_city_name}
                    {itemData?.recipient_county_name && `, ${itemData.recipient_county_name}`}
                  </Typography>
                </Box>
              )}
              {itemData?.recipient_address_line_1 && (
                <Box sx={{ gridColumn: '1 / -1' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Address
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.recipient_address_line_1}
                    {itemData?.recipient_address_line_2 && `, ${itemData.recipient_address_line_2}`}
                    {itemData?.recipient_zip_code && `, ${itemData.recipient_zip_code}`}
                  </Typography>
                </Box>
              )}
              {itemData?.recipient_parent_name && (
                <Box sx={{ gridColumn: '1 / -1' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Parent Organization
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                    {itemData.recipient_parent_name}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* Classification Codes */}
          <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
              Classification Codes
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {itemData?.naics_code && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    NAICS Code
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {itemData.naics_code}
                  </Typography>
                  {itemData?.naics_description && (
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                      {itemData.naics_description}
                    </Typography>
                  )}
                </Box>
              )}
              {itemData?.psc_code && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    PSC Code
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {itemData.psc_code}
                  </Typography>
                  {itemData?.psc_description && (
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                      {itemData.psc_description}
                    </Typography>
                  )}
                </Box>
              )}
              {itemData?.cfda_number && (
                <Box>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    CFDA Number
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {itemData.cfda_number}
                  </Typography>
                  {itemData?.cfda_title && (
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                      {itemData.cfda_title}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </Box>

          {/* Funding Information */}
          {(itemData?.federal_accounts_funding_this_award ||
            itemData?.treasury_accounts_funding_this_award ||
            itemData?.program_activities_funding_this_award ||
            itemData?.object_classes_funding_this_award ||
            itemData?.disaster_emergency_fund_codes_for_overall_award) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Funding Information
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
                {itemData?.federal_accounts_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Federal Account
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {itemData.federal_accounts_funding_this_award}
                    </Typography>
                  </Box>
                )}
                {itemData?.treasury_accounts_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Treasury Account
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {itemData.treasury_accounts_funding_this_award}
                    </Typography>
                  </Box>
                )}
                {itemData?.disaster_emergency_fund_codes_for_overall_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Disaster/Emergency Fund Code (DEFC)
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {itemData.disaster_emergency_fund_codes_for_overall_award}
                    </Typography>
                  </Box>
                )}
                {itemData?.program_activities_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Program Activity
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {itemData.program_activities_funding_this_award}
                    </Typography>
                  </Box>
                )}
                {itemData?.object_classes_funding_this_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Object Class
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {itemData.object_classes_funding_this_award}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Description */}
          {itemData?.description && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 1, fontWeight: 600 }}>
                Description
              </Typography>
              <Typography variant="body2" sx={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                {itemData.description}
              </Typography>
            </Box>
          )}

          {/* Transactions */}
          {itemData?.transactions && Array.isArray(itemData.transactions) && itemData.transactions.length > 0 && (
            <Box sx={{ mb: 3, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Transactions ({itemData.transactions.length})
                </Typography>
                <Tooltip
                  title={
                    <Box>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        The data available here may not represent the full transaction history.
                      </Typography>
                      {itemData?.usaspending_permalink ? (
                        <Typography variant="body2">
                          For complete transaction history, please visit{' '}
                          <Box
                            component="a"
                            href={itemData.usaspending_permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: '#60a5fa',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: '#93c5fd',
                              },
                            }}
                          >
                            USAspending.gov
                          </Box>
                          .
                        </Typography>
                      ) : (
                        <Typography variant="body2">
                          For complete transaction history, please visit the official USAspending.gov website.
                        </Typography>
                      )}
                    </Box>
                  }
                  arrow
                  placement="left"
                >
                  <WarningIcon 
                    sx={{ 
                      color: '#fbbf24', 
                      fontSize: '20px',
                      cursor: 'help',
                      '&:hover': {
                        color: '#f59e0b',
                      },
                    }} 
                  />
                </Tooltip>
              </Box>
              <Box sx={{ 
                maxHeight: '300px', 
                overflowY: 'auto',
                ...scrollbarStyles,
              }}>
                {itemData.transactions.map((transaction: any, idx: number) => (
                  <Box
                    key={transaction.transaction_id || idx}
                    sx={{
                      p: 2,
                      mb: 1,
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #374151',
                    }}
                  >
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      <strong>ID:</strong> {transaction.transaction_id || 'N/A'}
                    </Typography>
                    {transaction.action_date && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Date:</strong> {formatDate(transaction.action_date)}
                      </Typography>
                    )}
                    {transaction.federal_action_obligation && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Amount:</strong> {formatCurrency(parseFloat(transaction.federal_action_obligation))}
                      </Typography>
                    )}
                    {transaction.transaction_description && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Description:</strong> {transaction.transaction_description}
                      </Typography>
                    )}
                    {transaction.action_type && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Type:</strong> {transaction.action_type}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Child Awards (for IDV parents) */}
          {itemData?.is_idv_parent && (
            (itemData?.child_awards_details && Array.isArray(itemData.child_awards_details) && itemData.child_awards_details.length > 0) ||
            (itemData?.child_awards && Array.isArray(itemData.child_awards) && itemData.child_awards.length > 0) ||
            (childAwardsDetails && Array.isArray(childAwardsDetails) && childAwardsDetails.length > 0)
          ) && (
            <Box sx={{ mb: 3, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                  Child Awards ({itemData?.child_awards_details?.length || itemData?.child_awards?.length || childAwardsDetails.length})
                  {loadingChildAwards && (
                    <CircularProgress size={14} sx={{ ml: 1, color: '#3b82f6' }} />
                  )}
                </Typography>
                <Tooltip
                  title={
                    <Box>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Child awards (delivery orders) issued under this IDV. Each child award is a separate contract with its own transactions and obligations.
                      </Typography>
                      {itemData?.usaspending_permalink && (
                        <Typography variant="body2">
                          For complete child award details, please visit{' '}
                          <Box
                            component="a"
                            href={itemData.usaspending_permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: '#60a5fa',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: '#93c5fd',
                              },
                            }}
                          >
                            USAspending.gov
                          </Box>
                          .
                        </Typography>
                      )}
                    </Box>
                  }
                  arrow
                  placement="left"
                >
                  <InfoIcon 
                    sx={{ 
                      color: '#3b82f6', 
                      fontSize: '20px',
                      cursor: 'help',
                      '&:hover': {
                        color: '#60a5fa',
                      },
                    }} 
                  />
                </Tooltip>
              </Box>
              <Box sx={{ 
                maxHeight: '400px', 
                overflowY: 'auto',
                ...scrollbarStyles,
              }}>
                {(itemData?.child_awards_details || childAwardsDetails).map((childAward: any, idx: number) => (
                  <Box
                    key={childAward.award_id || idx}
                    sx={{
                      p: 2,
                      mb: 1,
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #374151',
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: 'rgba(30, 41, 59, 0.7)',
                        borderColor: '#3b82f6',
                      },
                    }}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (useDemoData) return;
                      if (!childAward?.award_id || !user_id) return;
                      
                      try {
                        console.log('📥 Fetching child award:', childAward.award_id);
                        
                        // Make API call to lambda with just the award_id
                          const awardResponse = await govtContractsSearchAPI.getAward({
                            award_id: childAward.award_id,
                          });
                          
                          if (awardResponse.success && awardResponse.result) {
                          const childAwardData = awardResponse.result;
                          console.log('✅ Child award fetched, opening new dialog:', childAwardData.award_id);
                          
                          // Open new dialog with child award data
                          const childTitle = childAwardData.recipient_name 
                            ? `Government Contract - ${childAwardData.recipient_name}${childAwardData.awarding_agency_name ? ` / ${childAwardData.awarding_agency_name}` : ''}`
                            : `Government Contract ${childAwardData.award_id || ''}`;
                          
                          openItemDetails(
                            'govt_contract',
                            childAwardData,
                            childTitle,
                            {
                              user_id: user_id,
                              parentAward: itemData, // Pass current award as parent
                            }
                          );
                          } else {
                          console.warn('⚠️ Child award not found in database:', childAward.award_id);
                          // Child award doesn't exist - could show a message or skip
                          // For now, we'll just log it
                          }
                        } catch (error) {
                        console.error('❌ Error fetching child award:', error);
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Box>
                        {childAward.award_id_piid && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5, fontFamily: 'monospace' }}>
                            <strong>PIID:</strong> {childAward.award_id_piid}
                          </Typography>
                        )}
                        {childAward.description && (
                          <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                            <strong>Description:</strong> {childAward.description}
                          </Typography>
                        )}
                        {childAward.award_type_description && (
                          <Typography variant="body2" sx={{ color: '#94a3b8', mb: 0.5 }}>
                            {childAward.award_type_description}
                          </Typography>
                        )}
                      </Box>
                      {childAward.total_obligated_amount && (
                        <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 600 }}>
                          {formatCurrency(parseFloat(childAward.total_obligated_amount.toString()))}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                      {childAward.recipient_name && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Recipient:</strong> {childAward.recipient_name}
                        </Typography>
                      )}
                      {childAward.awarding_agency_name && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Agency:</strong> {childAward.awarding_agency_name}
                        </Typography>
                      )}
                      {childAward.period_of_performance_start_date && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Start:</strong> {formatDate(String(childAward.period_of_performance_start_date))}
                        </Typography>
                      )}
                      {childAward.period_of_performance_current_end_date && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>End:</strong> {formatDate(String(childAward.period_of_performance_current_end_date))}
                        </Typography>
                      )}
                      {childAward.transaction_count !== undefined && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Transactions:</strong> {childAward.transaction_count}
                        </Typography>
                      )}
                      {childAward.subaward_count !== undefined && (
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          <strong>Subawards:</strong> {childAward.subaward_count}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Subawards */}
          {itemData?.subawards && Array.isArray(itemData.subawards) && itemData.subawards.length > 0 && (
            <Box sx={{ mb: 3, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Subawards ({itemData.subawards.length})
                </Typography>
                <Tooltip
                  title={
                    <Box>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        The data available here may not represent the full subaward history.
                      </Typography>
                      {itemData?.usaspending_permalink ? (
                        <Typography variant="body2">
                          For complete subaward history, please visit{' '}
                          <Box
                            component="a"
                            href={itemData.usaspending_permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: '#60a5fa',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: '#93c5fd',
                              },
                            }}
                          >
                            USAspending.gov
                          </Box>
                          .
                        </Typography>
                      ) : (
                        <Typography variant="body2">
                          For complete subaward history, please visit the official USAspending.gov website.
                        </Typography>
                      )}
                    </Box>
                  }
                  arrow
                  placement="left"
                >
                  <WarningIcon 
                    sx={{ 
                      color: '#fbbf24', 
                      fontSize: '20px',
                      cursor: 'help',
                      '&:hover': {
                        color: '#f59e0b',
                      },
                    }} 
                  />
                </Tooltip>
              </Box>
              <Box sx={{ 
                maxHeight: '300px', 
                overflowY: 'auto',
                ...scrollbarStyles,
              }}>
                {itemData.subawards.map((subaward: any, idx: number) => (
                  <Box
                    key={subaward.subaward_id || idx}
                    sx={{
                      p: 2,
                      mb: 1,
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      borderRadius: '4px',
                      border: '1px solid #374151',
                    }}
                  >
                    <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                      <strong>ID:</strong> {subaward.subaward_id || 'N/A'}
                    </Typography>
                    {subaward.subawardee_name && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Recipient:</strong> {subaward.subawardee_name}
                      </Typography>
                    )}
                    {subaward.subaward_amount && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0', mb: 0.5 }}>
                        <strong>Amount:</strong> {formatCurrency(parseFloat(subaward.subaward_amount))}
                      </Typography>
                    )}
                    {subaward.subaward_date && (
                      <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                        <strong>Date:</strong> {formatDate(subaward.subaward_date)}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Additional Financial Information */}
          {(itemData?.current_total_value_of_award || 
            itemData?.potential_total_value_of_award ||
            itemData?.base_and_exercised_options_value ||
            itemData?.base_and_all_options_value) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Additional Financial Information
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {itemData?.current_total_value_of_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Current Total Value
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(itemData.current_total_value_of_award)))}
                    </Typography>
                  </Box>
                )}
                {itemData?.potential_total_value_of_award && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Potential Total Value
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(itemData.potential_total_value_of_award)))}
                    </Typography>
                  </Box>
                )}
                {itemData?.base_and_exercised_options_value && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Base and Exercised Options
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(itemData.base_and_exercised_options_value)))}
                    </Typography>
                  </Box>
                )}
                {itemData?.base_and_all_options_value && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Base and All Options
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatCurrency(parseFloat(String(itemData.base_and_all_options_value)))}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Place of Performance */}
          {(itemData?.primary_place_of_performance_city_name ||
            itemData?.primary_place_of_performance_state_name ||
            itemData?.primary_place_of_performance_country_name) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Place of Performance
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {itemData?.primary_place_of_performance_city_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      City
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {itemData.primary_place_of_performance_city_name}
                      {itemData?.primary_place_of_performance_county_name && 
                        `, ${itemData.primary_place_of_performance_county_name}`}
                    </Typography>
                  </Box>
                )}
                {itemData?.primary_place_of_performance_state_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      State
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {itemData.primary_place_of_performance_state_name}
                      {itemData?.primary_place_of_performance_state_code && 
                        ` (${itemData.primary_place_of_performance_state_code})`}
                    </Typography>
                  </Box>
                )}
                {itemData?.primary_place_of_performance_country_name && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Country
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {itemData.primary_place_of_performance_country_name}
                      {itemData?.primary_place_of_performance_country_code && 
                        ` (${itemData.primary_place_of_performance_country_code})`}
                    </Typography>
                  </Box>
                )}
                {itemData?.primary_place_of_performance_zip_4 && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      ZIP Code
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {itemData.primary_place_of_performance_zip_4}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Dates and Metadata */}
          {(itemData?.action_date || 
            itemData?.last_modified_date ||
            itemData?.last_updated ||
            itemData?.initial_report_date) && (
            <Box sx={{ mb: 3, p: 2, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
                Dates and Metadata
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {itemData?.action_date && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Action Date
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatDate(itemData.action_date)}
                    </Typography>
                  </Box>
                )}
                {itemData?.last_modified_date && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Last Modified
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatDate(itemData.last_modified_date)}
                    </Typography>
                  </Box>
                )}
                {itemData?.last_updated && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Last Updated
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatLastUpdated(itemData.last_updated)}
                    </Typography>
                  </Box>
                )}
                {itemData?.initial_report_date && (
                  <Box>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Initial Report Date
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0' }}>
                      {formatDate(itemData.initial_report_date)}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Box>
      );
    }

    // Stock Result
    if (itemType === 'stock_result' || itemData?.symbol || itemData?.name) {
      const price = itemData?.current_price ?? itemData?.price ?? 0;
      const priceChange = itemData?.priceChange ?? itemData?.price_change ?? 0;
      const priceChangePercent = itemData?.priceChangePercent ?? itemData?.price_change_percent ?? 0;
      const marketCap = itemData?.marketCap ?? itemData?.market_cap ?? 0;
      const volatility = itemData?.volatility ?? 0;
      const peRatio = itemData?.pe_ratio ?? itemData?.pe ?? 0;
      const dividendYield = itemData?.dividend_yield ?? 0;
      const beta = itemData?.beta ?? 0;
      const eps = itemData?.eps ?? 0;
      const volume = itemData?.volume ?? 0;
      const avgVolume = itemData?.avg_volume ?? 0;
      const sharesOutstanding = itemData?.shares_outstanding ?? 0;
      const dayHigh = itemData?.day_high ?? 0;
      const dayLow = itemData?.day_low ?? 0;
      const yearHigh = itemData?.year_high ?? 0;
      const yearLow = itemData?.year_low ?? 0;
      const weekReturn = itemData?.weekReturn ?? itemData?.week_return ?? 0;
      const previousClose = itemData?.previous_close ?? 0;
      const isPositive = priceChange >= 0;

      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600, mb: 1 }}>
            {itemData?.name || title || 'Stock Information'}
          </Typography>
          {itemData?.symbol && (
            <Typography variant="h6" sx={{ color: '#94a3b8', mb: 3, fontWeight: 400 }}>
              {itemData.symbol}
            </Typography>
          )}

          {/* Price Information */}
          <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
              Price Information
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                  Current Price
                </Typography>
                <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600 }}>
                  ${price.toFixed(2)}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                  Price Change
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  <Typography 
                    variant="h5" 
                    sx={{ 
                      color: isPositive ? '#22c55e' : '#ef4444', 
                      fontWeight: 600 
                    }}
                  >
                    {isPositive ? '+' : ''}{priceChange.toFixed(2)}
                  </Typography>
                  <Typography 
                    variant="body1" 
                    sx={{ 
                      color: isPositive ? '#22c55e' : '#ef4444',
                    }}
                  >
                    ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
                  </Typography>
                </Box>
              </Grid>
              {previousClose > 0 && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Previous Close
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    ${previousClose.toFixed(2)}
                  </Typography>
                </Grid>
              )}
              {weekReturn !== 0 && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Week Return
                  </Typography>
                  <Typography 
                    variant="body1" 
                    sx={{ 
                      color: weekReturn >= 0 ? '#22c55e' : '#ef4444',
                      fontWeight: 600,
                    }}
                  >
                    {weekReturn >= 0 ? '+' : ''}{weekReturn.toFixed(2)}%
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>

          {/* Market Data */}
          <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
              Market Data
            </Typography>
            <Grid container spacing={3}>
              {marketCap > 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Market Cap
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    ${(marketCap / 1000000000).toFixed(2)}B
                  </Typography>
                </Grid>
              )}
              {sharesOutstanding > 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Shares Outstanding
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    {sharesOutstanding.toLocaleString()}
                  </Typography>
                </Grid>
              )}
              {volume > 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Volume
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    {volume.toLocaleString()}
                  </Typography>
                </Grid>
              )}
              {avgVolume > 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Average Volume
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    {avgVolume.toLocaleString()}
                  </Typography>
                </Grid>
              )}
              {volatility > 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Volatility
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    {volatility.toFixed(2)}%
                  </Typography>
                </Grid>
              )}
              {beta !== 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Beta
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    {beta.toFixed(2)}
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>

          {/* Price Ranges */}
          {(dayHigh > 0 || dayLow > 0 || yearHigh > 0 || yearLow > 0) && (
            <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                Price Ranges
              </Typography>
              <Grid container spacing={3}>
                {dayHigh > 0 && (
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Day High
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#22c55e', fontWeight: 600 }}>
                      ${dayHigh.toFixed(2)}
                    </Typography>
                  </Grid>
                )}
                {dayLow > 0 && (
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Day Low
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#ef4444', fontWeight: 600 }}>
                      ${dayLow.toFixed(2)}
                    </Typography>
                  </Grid>
                )}
                {yearHigh > 0 && (
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      52 Week High
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#22c55e', fontWeight: 600 }}>
                      ${yearHigh.toFixed(2)}
                    </Typography>
                  </Grid>
                )}
                {yearLow > 0 && (
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      52 Week Low
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#ef4444', fontWeight: 600 }}>
                      ${yearLow.toFixed(2)}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {/* Financial Metrics */}
          <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
              Financial Metrics
            </Typography>
            <Grid container spacing={3}>
              {peRatio > 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    P/E Ratio
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    {peRatio.toFixed(2)}
                  </Typography>
                </Grid>
              )}
              {eps !== 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    EPS
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    ${eps.toFixed(2)}
                  </Typography>
                </Grid>
              )}
              {dividendYield > 0 && (
                <Grid item xs={12} sm={6} md={4}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                    Dividend Yield
                  </Typography>
                  <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                    {dividendYield.toFixed(2)}%
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>

          {/* Company Information */}
          {(itemData?.industry || itemData?.sector || itemData?.data_source) && (
            <Box sx={{ mb: 4, p: 3, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '4px', border: '1px solid #374151' }}>
              <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600, mb: 2 }}>
                Company Information
              </Typography>
              <Grid container spacing={3}>
                {itemData?.industry && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Industry
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                      {itemData.industry}
                    </Typography>
                  </Grid>
                )}
                {itemData?.sector && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Sector
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                      {itemData.sector}
                    </Typography>
                  </Grid>
                )}
                {itemData?.data_source && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Data Source
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                      {itemData.data_source}
                    </Typography>
                  </Grid>
                )}
                {itemData?.last_updated && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5 }}>
                      Last Updated
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
                      {formatLastUpdated(itemData.last_updated)}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </Box>
      );
    }

    // News Article
    if (itemType === 'news_article' || itemData?.title || itemData?.source_name || itemData?.source_url) {
      return (
        <Box 
          sx={{ 
            p: 3,
            maxHeight: '70vh',
            overflow: 'auto',
            ...scrollbarStyles,
          }}
        >
          <Typography variant="h5" sx={{ color: '#ffffff', mb: 2, fontWeight: 600 }}>
            {title || itemData?.title || 'News Article'}
          </Typography>
          {(itemData?.source_name || itemData?.source_url) && (
            <Typography variant="body2" sx={{ color: '#94a3b8', mb: 3 }}>
              {itemData.source_name || itemData.source_url}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Image */}
            {itemData?.image_url && (
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, fontWeight: 600 }}>
                  Image
                </Typography>
                <Box
                  component="img"
                  src={itemData.image_url}
                  alt={itemData.title || 'Article image'}
                  sx={{
                    width: '100%',
                    maxHeight: 400,
                    objectFit: 'contain',
                    borderRadius: '4px',
                    border: '1px solid #374151',
                  }}
                />
              </Box>
            )}

            {/* Description */}
            {itemData?.description && (
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, fontWeight: 600 }}>
                  Description
                </Typography>
                <Typography variant="body2" sx={{ color: '#e2e8f0', lineHeight: 1.6 }}>
                  {itemData.description}
                </Typography>
              </Box>
            )}

            {/* Keywords */}
            {itemData?.keywords && (
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, fontWeight: 600 }}>
                  Keywords
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {itemData.keywords.split(',').map((keyword: string, index: number) => (
                    <Chip
                      key={index}
                      label={keyword.trim()}
                      size="small"
                      sx={{
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        color: '#93c5fd',
                        border: '1px solid #3b82f6',
                        fontSize: '0.75rem',
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* Source URL */}
            {itemData?.source_url && (
              <Box>
                <Button
                  variant="contained"
                  onClick={() => {
                    window.open(itemData.source_url, '_blank', 'noopener,noreferrer');
                  }}
                  startIcon={<LaunchIcon />}
                  sx={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    '&:hover': { 
                      background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' 
                    },
                    color: '#ffffff',
                    fontWeight: 600,
                  }}
                >
                  Open Article
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      );
    }


    // Default fallback
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" sx={{ color: '#ffffff', mb: 2 }}>
          {title || 'Item Details'}
        </Typography>
        <Typography variant="body1" sx={{ color: '#e2e8f0' }}>
          Preview not available for this item type.
        </Typography>
      </Box>
    );
  };

  // Removed getDialogMaxWidth - dialogs are now resizable with fixed initial size

  // If contentOnly mode, render just the content without Dialog wrapper
  if (contentOnly) {
    // Get itemData for header rendering
    const itemDataForHeader = data?.data && typeof data.data === 'object' ? data.data : data;
    
    return (
      <Box sx={{ p: 2.5 }}>
        {/* Header for Government Contracts in contentOnly mode */}
        {itemType === 'govt_contract' && (
          <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid #374151' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                {/* Back button for child awards */}
                {itemDataForHeader?.is_idv_child && parentAward && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        if (parentAward && onNavigateToParent) {
                          onNavigateToParent(parentAward);
                        }
                      }}
                      sx={{
                        color: '#3b82f6',
                        '&:hover': {
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                      }}
                    >
                      <ArrowBackIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="caption" sx={{ color: '#94a3b8', cursor: 'pointer' }} onClick={() => {
                      if (parentAward && onNavigateToParent) {
                        onNavigateToParent(parentAward);
                      }
                    }}>
                      Back to Parent IDV
                    </Typography>
                  </Box>
                )}
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600 }}>
                    {itemDataForHeader?.is_assistance ? 'Other Financial Assistance' : 'Contract'}
                  </Typography>
                  <Tooltip title="View on USAspending.gov">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const usaspendingUrl = itemDataForHeader?.usaspending_permalink || 
                          `https://www.usaspending.gov/award/${itemDataForHeader?.award_id}`;
                        window.open(usaspendingUrl, '_blank', 'noopener,noreferrer');
                      }}
                      sx={{
                        color: '#9ca3af',
                        '&:hover': {
                          color: '#3b82f6',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                      }}
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Refresh award data from USAspending API">
                    <span>
                      <IconButton
                        size="small"
                        onClick={handleEnrichAward}
                        disabled={useDemoData || enrichmentLoading || !itemDataForHeader?.award_id || !user_id}
                        sx={{
                          color: '#3b82f6',
                          '&:hover': {
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          },
                          '&:disabled': {
                            color: '#6b7280',
                          },
                        }}
                      >
                        {enrichmentLoading ? (
                          <CircularProgress size={20} sx={{ color: '#3b82f6' }} />
                        ) : (
                          <RefreshIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                {itemDataForHeader?.award_id_fain && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                      FAIN
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {itemDataForHeader.award_id_fain}
                    </Typography>
                  </Box>
                )}
              </Box>
              <Box sx={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                {/* Parent contract moved to main content area */}
              </Box>
            </Box>
          </Box>
        )}
        
        {/* Header for Roll Call in contentOnly mode (filesystem preview) */}
        {itemType === 'roll_call' && (
          <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid #374151' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                {itemDataForHeader?.roll_display ?? `Roll Call ${itemDataForHeader?.roll ?? '—'}`} · Congress {itemDataForHeader?.congress ?? '—'}, Session {itemDataForHeader?.session ?? '—'}
              </Typography>
              {itemDataForHeader?.bill_id_associated && (
                <>
                  <Typography component="span" sx={{ color: '#64748b' }}>·</Typography>
                  <Link
                    component="button"
                    variant="body2"
                    sx={{ color: '#60a5fa', cursor: 'pointer', textTransform: 'none', '&:hover': { textDecoration: 'underline' } }}
                    onClick={() => {
                      openItemDetails('congress_bill', { bill_id: itemDataForHeader.bill_id_associated }, itemDataForHeader.bill_id_associated, { user_id: user_id || user?.id });
                    }}
                  >
                    View
                  </Link>
                  <Typography component="span" sx={{ color: '#94a3b8', fontFamily: 'monospace' }}> {itemDataForHeader.bill_id_associated}</Typography>
                </>
              )}
              {itemDataForHeader?.congress != null && itemDataForHeader?.session != null && itemDataForHeader?.roll != null && (
                <Tooltip title="View voter data on Congress.gov">
                  <IconButton
                    size="small"
                    component="a"
                    href={`https://www.congress.gov/votes/${((itemDataForHeader as any).chamber ?? 'house').toLowerCase()}/${itemDataForHeader.congress}-${itemDataForHeader.session}/${itemDataForHeader.roll}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: '#9ca3af',
                      '&:hover': { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                    }}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        )}

        {/* Header for Congress Bills in contentOnly mode */}
        {itemType === 'congress_bill' && (
          <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid #374151' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                {(itemDataForHeader?.bill_id || data?.bill_id) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                      {itemDataForHeader?.bill_id || data.bill_id}
                    </Typography>
                    {itemDataForHeader?.bill_url && (
                      <Tooltip title="View on Congress.gov">
                        <IconButton
                          size="small"
                          onClick={() => {
                            window.open(itemDataForHeader.bill_url, '_blank', 'noopener,noreferrer');
                          }}
                          sx={{
                            color: '#9ca3af',
                            '&:hover': {
                              color: '#3b82f6',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            },
                          }}
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Refresh bill data from DynamoDB">
                      <span>
                        <IconButton
                          size="small"
                          onClick={handleRefreshBill}
                          disabled={useDemoData || refreshBillLoading || !itemDataForHeader?.bill_id}
                          sx={{
                            color: '#3b82f6',
                            '&:hover': {
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            },
                            '&:disabled': {
                              color: '#6b7280',
                            },
                          }}
                        >
                          {refreshBillLoading ? (
                            <CircularProgress size={20} sx={{ color: '#3b82f6' }} />
                          ) : (
                            <RefreshIcon fontSize="small" />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        )}
        
        {/* Enrichment status messages (for Government Contracts and Congress Bills) */}
        {itemType === 'govt_contract' && (
          <>
            {enrichmentSuccess && (
              <Alert 
                severity="success" 
                onClose={() => setEnrichmentSuccess(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}
              >
                {enrichmentSuccess}
              </Alert>
            )}
            {enrichmentError && (
              <Alert 
                severity="error" 
                onClose={() => setEnrichmentError(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
              >
                {enrichmentError}
              </Alert>
            )}
          </>
        )}
        {itemType === 'congress_bill' && (
          <>
            {enrichmentSuccess && (
              <Alert 
                severity="success" 
                onClose={() => setEnrichmentSuccess(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}
              >
                {enrichmentSuccess}
              </Alert>
            )}
            {enrichmentError && (
              <Alert 
                severity="error" 
                onClose={() => setEnrichmentError(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
              >
                {enrichmentError}
              </Alert>
            )}
          </>
        )}
        {renderContent()}
      </Box>
    );
  }

  // Handle Escape key to close
  useEffect(() => {
    if (!open) return;
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  // Drag handlers - use preview outline approach
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isResizing) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    // Initialize preview position
    previewPositionRef.current = { ...position };
    // Show preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'block';
      previewRef.current.style.left = `${position.x}px`;
      previewRef.current.style.top = `${position.y}px`;
      previewRef.current.style.width = `${size.width}px`;
      previewRef.current.style.height = `${size.height}px`;
    }
  }, [position, size, isResizing]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Use requestAnimationFrame for smooth updates
    rafIdRef.current = requestAnimationFrame(() => {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      const maxX = window.innerWidth - size.width;
      const maxY = window.innerHeight - size.height;
      
      const clampedX = Math.max(0, Math.min(maxX, newX));
      const clampedY = Math.max(64, Math.min(maxY, newY));
      
      // Store in ref (no state update = no re-render)
      previewPositionRef.current = { x: clampedX, y: clampedY };
      
      // Update preview outline directly via DOM
      if (previewRef.current) {
        previewRef.current.style.left = `${clampedX}px`;
        previewRef.current.style.top = `${clampedY}px`;
      }
    });
  }, [isDragging, dragStart, size]);

  const handleDragEnd = useCallback(() => {
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Apply preview position to actual position when mouse is released
    const newPosition = previewPositionRef.current;
    setPosition(newPosition);
    if (onPositionChange) {
      onPositionChange(newPosition);
    }
    
    // Hide preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'none';
    }
    
    setIsDragging(false);
  }, [onPositionChange]);

  // Resize handlers - use preview outline approach
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    });
    // Initialize preview size
    previewSizeRef.current = { ...size };
    // Show preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'block';
      previewRef.current.style.left = `${position.x}px`;
      previewRef.current.style.top = `${position.y}px`;
      previewRef.current.style.width = `${size.width}px`;
      previewRef.current.style.height = `${size.height}px`;
    }
  }, [isDragging, size, position]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Use requestAnimationFrame for smooth updates
    rafIdRef.current = requestAnimationFrame(() => {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      
      const newWidth = Math.max(400, Math.min(window.innerWidth - 100, resizeStart.width + deltaX));
      const newHeight = Math.max(300, Math.min(window.innerHeight - 100, resizeStart.height + deltaY));
      
      // Store in ref (no state update = no re-render)
      previewSizeRef.current = { width: newWidth, height: newHeight };
      
      // Update preview outline directly via DOM
      if (previewRef.current) {
        previewRef.current.style.width = `${newWidth}px`;
        previewRef.current.style.height = `${newHeight}px`;
      }
    });
  }, [isResizing, resizeStart]);

  const handleResizeEnd = useCallback(() => {
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // Apply preview size to actual size when mouse is released
    const newSize = previewSizeRef.current;
    setSize(newSize);
    if (onSizeChange) {
      onSizeChange(newSize);
    }
    
    // Hide preview outline
    if (previewRef.current) {
      previewRef.current.style.display = 'none';
    }
    
    setIsResizing(false);
  }, [onSizeChange]);

  // Global mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Sync position and size with initial values
  useEffect(() => {
    if (initialPosition) {
      setPosition(initialPosition);
      previewPositionRef.current = initialPosition;
    }
  }, [initialPosition?.x, initialPosition?.y]);

  useEffect(() => {
    if (initialSize) {
      setSize(initialSize);
      previewSizeRef.current = initialSize;
    }
  }, [initialSize?.width, initialSize?.height]);

  // Cache content when data changes (only once per data change) - non-blocking
  useEffect(() => {
    if (data && onCacheContent && dialogId) {
      // Check if we've already cached this data to prevent infinite loops
      const dataString = JSON.stringify(data);
      if (cachedDataRef.current !== dataString) {
        cachedDataRef.current = dataString;
        onCacheContent(data);
        // Save to sessionStorage asynchronously to avoid blocking
        const saveCache = () => {
          try {
            sessionStorage.setItem(`dialog-cache-${dialogId}`, dataString);
          } catch (e) {
            // Ignore
          }
        };
        if ('requestIdleCallback' in window) {
          requestIdleCallback(saveCache, { timeout: 1000 });
        } else {
          setTimeout(saveCache, 0);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dialogId]); // Don't include onCacheContent to prevent infinite loops

  if (!open) return null;

  const isConstrained = Boolean(containerElement);
  const positionType = isConstrained ? 'absolute' : 'fixed';
  const paperPosition = isConstrained
    ? { left: '5%', top: '5%', width: '90%', height: '90%', maxWidth: '100%', maxHeight: '100%' }
    : { left: `${position.x}px`, top: `${position.y}px`, width: `${size.width}px`, height: `${size.height}px` };

  const dialogContent = (
    <>
      {/* Preview outline - shown during drag/resize (hidden in constrained mode) */}
      <Box
        ref={previewRef}
        sx={{
          position: positionType,
          ...(isConstrained ? { display: 'none' } : { left: `${position.x}px`, top: `${position.y}px`, width: `${size.width}px`, height: `${size.height}px` }),
          border: '2px solid #3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          pointerEvents: 'none',
          zIndex: 1101,
          display: 'none', // Hidden by default, shown during drag/resize via direct DOM manipulation
          boxShadow: '0 0 8px rgba(59, 130, 246, 0.6)',
        }}
      />
      <Box
        sx={{
          position: positionType,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: zIndex,
          pointerEvents: 'none',
        }}
        onMouseDown={(e) => {
          if (onBringToFront && e.target === e.currentTarget) {
            requestAnimationFrame(() => onBringToFront());
          }
        }}
      >
        <Paper
          ref={paperRef}
          elevation={8}
          onMouseDown={(e) => {
            if (isConstrained) return;
            const target = e.target as HTMLElement;
            const isInteractiveElement = target.closest('button, a, input, select, textarea, [role="button"], [onClick]');
            const isTitleBar = target.closest('[data-title-bar]');
            if (onBringToFront && (isTitleBar || !isInteractiveElement)) {
              requestAnimationFrame(() => onBringToFront());
            }
          }}
          sx={{
            position: positionType,
            ...paperPosition,
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            border: '2px solid #374151',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            pointerEvents: 'auto',
            cursor: isConstrained ? 'default' : (isDragging ? 'move' : 'default'),
            zIndex: zIndex,
          }}
        >
          {/* Title bar - draggable (disabled when constrained to container) */}
          <Box
            data-title-bar
            data-tutorial="item-details-titlebar"
            onMouseDown={isConstrained ? undefined : handleDragStart}
            sx={{
              color: '#ffffff',
              borderBottom: '1px solid #374151',
              pb: 2,
              px: 3,
              pt: 2,
              cursor: isConstrained ? 'default' : 'move',
              userSelect: 'none',
            }}
          >
        {/* Title content will be rendered per item type */}
        {itemType === 'govt_contract' && (() => {
          return (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                {/* Back button for child awards */}
                {itemData?.is_idv_child && parentAward && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        if (parentAward && onNavigateToParent) {
                          onNavigateToParent(parentAward);
                        }
                      }}
                      sx={{
                        color: '#3b82f6',
                        '&:hover': {
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                      }}
                    >
                      <ArrowBackIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="caption" sx={{ color: '#94a3b8', cursor: 'pointer' }} onClick={() => {
                      if (parentAward && onNavigateToParent) {
                        onNavigateToParent(parentAward);
                      }
                    }}>
                      Back to Parent IDV
                    </Typography>
                  </Box>
                )}
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 600 }}>
                    {itemData?.is_assistance ? 'Other Financial Assistance' : 'Contract'}
                  </Typography>
                  <Tooltip title="View on USAspending.gov">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const usaspendingUrl = itemData?.usaspending_permalink || 
                          `https://www.usaspending.gov/award/${itemData?.award_id}`;
                        window.open(usaspendingUrl, '_blank', 'noopener,noreferrer');
                      }}
                      sx={{
                        color: '#9ca3af',
                        '&:hover': {
                          color: '#3b82f6',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                      }}
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Refresh award data from USAspending API">
                    <span>
                      <IconButton
                        size="small"
                        onClick={handleEnrichAward}
                        disabled={useDemoData || enrichmentLoading || !itemData?.award_id || !user_id}
                        sx={{
                          color: '#3b82f6',
                          '&:hover': {
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          },
                          '&:disabled': {
                            color: '#6b7280',
                          },
                        }}
                      >
                        {enrichmentLoading ? (
                          <CircularProgress size={20} sx={{ color: '#3b82f6' }} />
                        ) : (
                          <RefreshIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                {itemData?.award_id_fain && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                      FAIN
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {itemData.award_id_fain}
                    </Typography>
                  </Box>
                )}
              </Box>
              <Box sx={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                {/* Parent contract moved to main content area */}
            </Box>
          </Box>
          );
        })()}
        {itemType === 'congress_bill' && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              {(itemData?.bill_id || data?.bill_id) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                    {itemData?.bill_id || data.bill_id}
                  </Typography>
                  {itemData?.bill_url && (
                    <Tooltip title="View on Congress.gov">
                      <IconButton
                        size="small"
                        onClick={() => {
                          window.open(itemData.bill_url, '_blank', 'noopener,noreferrer');
                        }}
                        sx={{
                          color: '#9ca3af',
                          '&:hover': {
                            color: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          },
                        }}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Refresh bill data from DynamoDB">
                    <span>
                      <IconButton
                        size="small"
                        onClick={handleRefreshBill}
                        disabled={useDemoData || refreshBillLoading || !itemData?.bill_id}
                        sx={{
                          color: '#3b82f6',
                          '&:hover': {
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          },
                          '&:disabled': {
                            color: '#6b7280',
                          },
                        }}
                      >
                        {refreshBillLoading ? (
                          <CircularProgress size={20} sx={{ color: '#3b82f6' }} />
                        ) : (
                          <RefreshIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              )}
            </Box>
          </Box>
        )}
        {itemType === 'sec_filing' && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
              Filing Details: {data?.form || 'Filing'} - {data?.filingEntity || data?.reportingFor || 'SEC Filing'}
            </Typography>
          </Box>
        )}
        {!['govt_contract', 'congress_bill', 'sec_filing'].includes(itemType) && (
          <Typography component="div" variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
            {title || 'Item Details'}
          </Typography>
        )}
        
        {/* Universal Action Bar - Right side (appears for all item types) */}
        <Box
          sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.5 }}
          data-tutorial="item-details-actions"
        >
          {/* Tutorial Help */}
          <TutorialHelpIcon tutorialKey="item-details" title="Details window tutorial" />
          {/* Add to Context (Sidebar) */}
          <Tooltip title="Add to Context">
            <IconButton
              size="small"
              onClick={handleAddToContext}
              sx={{
                color: '#9ca3af',
                '&:hover': {
                  color: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
              }}
            >
              <AddToContextIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          
          {/* Add to Files */}
          <Tooltip title="Save to Files">
            <span>
              <IconButton
                size="small"
                onClick={handleAddToFiles}
                disabled={!user}
                sx={{
                  color: '#fbbf24',
                  '&:hover': {
                    color: '#f59e0b',
                    backgroundColor: 'rgba(251, 191, 36, 0.1)',
                  },
                  '&:disabled': {
                    color: '#6b7280',
                  },
                }}
              >
                <FolderIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          
          {/* Minimize Button - hidden when disableMinimize or constrained to container (e.g. demo) */}
          {!disableMinimize && !containerElement && (
          <Tooltip title="Minimize">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                if (onMinimize) {
                  onMinimize();
                } else if (dialogManager && !dialogId) {
                  // If not managed, add to manager and minimize
                  const id = dialogManager.openDialog({
                    type: 'item_details',
                    title: title || 'Item Details',
                    data: {
                      itemType,
                      data,
                      title,
                      folder_path,
                      user_id,
                      onEnrich,
                      onNavigateToChild,
                      onNavigateToParent,
                      parentAward,
                      item_id,
                    },
                    props: {},
                    position,
                    size,
                  });
                  dialogManager.minimizeDialog(id);
                  onClose(); // Close the unmanaged dialog
                }
              }}
              sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
            >
              <MinimizeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          )}
          
          {/* Close Button */}
          <IconButton
            size="small"
            onClick={onClose}
            sx={{ color: '#9ca3af', '&:hover': { color: '#ef4444' } }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
          </Box>
          <Box
            sx={{
              mt: 2,
              p: 2.5,
              flex: 1,
              overflow: 'auto',
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
            }}
            data-tutorial="item-details-content"
          >
        {/* Enrichment status messages (for Government Contracts and Congress Bills) */}
        {itemType === 'govt_contract' && (
          <>
            {enrichmentSuccess && (
              <Alert 
                severity="success" 
                onClose={() => setEnrichmentSuccess(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}
              >
                {enrichmentSuccess}
              </Alert>
            )}
            {enrichmentError && (
              <Alert 
                severity="error" 
                onClose={() => setEnrichmentError(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
              >
                {enrichmentError}
              </Alert>
            )}
          </>
        )}
        {itemType === 'congress_bill' && (
          <>
            {enrichmentSuccess && (
              <Alert 
                severity="success" 
                onClose={() => setEnrichmentSuccess(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}
              >
                {enrichmentSuccess}
              </Alert>
            )}
            {enrichmentError && (
              <Alert 
                severity="error" 
                onClose={() => setEnrichmentError(null)}
                sx={{ mb: 2, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
              >
                {enrichmentError}
              </Alert>
            )}
          </>
        )}

            {renderContent()}
          </Box>
          <Box sx={{ borderTop: '1px solid #374151', p: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              onClick={onClose}
              sx={{
                color: '#94a3b8',
                '&:hover': {
                  backgroundColor: 'rgba(71, 85, 105, 0.1)',
                },
              }}
            >
              Close
            </Button>
          </Box>

          {/* Resize handle - bottom right corner (hidden when constrained to container) */}
          {!isConstrained && (
          <Box
            onMouseDown={handleResizeStart}
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '20px',
              height: '20px',
              cursor: 'nwse-resize',
              background: 'linear-gradient(135deg, transparent 0%, transparent 40%, #3b82f6 40%, #3b82f6 50%, transparent 50%, transparent 100%)',
              '&:hover': {
                background: 'linear-gradient(135deg, transparent 0%, transparent 40%, #2563eb 40%, #2563eb 50%, transparent 50%, transparent 100%)',
              },
            }}
          />
          )}
        </Paper>
      </Box>
      
      {/* File Browser Dialog for saving items to files */}
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
        title="Save to Files"
      />
    </>
  );

  if (containerElement) {
    return createPortal(
      <Box sx={{ position: 'absolute', inset: 0, zIndex, pointerEvents: 'none' }}>
        <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {dialogContent}
        </Box>
      </Box>,
      containerElement
    );
  }
  return <Portal>{dialogContent}</Portal>;
};

export default ItemDetailsDialog;
