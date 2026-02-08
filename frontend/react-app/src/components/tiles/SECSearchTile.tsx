import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  TextField,
  Button,
  Chip,
  Select,
  InputLabel,
  FormControlLabel,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Pagination,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Description as DocumentIcon,
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
  ExpandMore as ExpandMoreIcon,
  Dashboard as AddToContextIcon,
  Chat as SidebarChatIcon,
  ViewColumn as ViewColumnIcon,
  Stop as StopIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { secSearchAPI, SECSearchParams, SECSearchResult, SECAutocompleteSuggestion } from '../../services/api';
import { useTilePinning, TileHeaderActions, TileCustomizationDialog, addFilingToContext, addMultipleFilingsToContext } from './common';
import { getIconByName, getDefaultIconForTileType } from './common/tileIconHelper';
import MultiSelectField from '../MultiSelectField';
import { useAuth } from '@/contexts/AuthContext';
import { useEasyMode } from '@/contexts/EasyModeContext';
import { useDemoDashboard } from '@/contexts/DemoDashboardContext';
import { useGlobalChat } from '@/contexts/GlobalChatContext';
import FileBrowserDialog from '../common/FileBrowserDialog';
import { useDialogManagerHelpers } from '../../hooks/useDialogManagerHelpers';
import { filesystemAPI } from '../../services/api';

// SEC Form Categories (from SEC website) - simplified for tile
interface FormCategory {
  id: string;
  label: string;
  formTypes: string[];
}

const SEC_FORM_CATEGORIES: FormCategory[] = [
  {
    id: 'all',
    label: 'View all',
    formTypes: [], // Empty means all forms
  },
  {
    id: 'form-cat1',
    label: 'All annual, quarterly, and current reports',
    formTypes: ['1-K', '1-SA', '1-U', '1-Z', '1-Z-W', '10-D', '10-K', '10-KT', '10-Q', '10-QT', '11-K', '11-KT', '13F-HR', '13F-NT', '15-12B', '15-12G', '15-15D', '15F-12B', '15F-12G', '15F-15D', '18-K', '20-F', '24F-2NT', '25', '25-NSE', '40-17F2', '40-17G', '40-F', '6-K', '8-K', '8-K12G3', '8-K15D5', 'ABS-15G', 'ABS-EE', 'ANNLRPT', 'DSTRBRPT', 'IRANNOTICE', 'N-30B-2', 'N-30D', 'N-CEN', 'N-CSR', 'N-CSRS', 'N-MFP', 'N-MFP1', 'N-MFP2', 'N-PX', 'N-Q', 'NPORT-EX', 'NSAR-A', 'NSAR-B', 'NSAR-U', 'NT 10-D', 'NT 10-K', 'NT 10-Q', 'NT 11-K', 'NT 20-F', 'QRTLYRPT', 'SD', 'SP 15D2'],
  },
  {
    id: 'form-cat2',
    label: 'Insider equity awards, transactions, and ownership (Section 16 Reports)',
    formTypes: ['3', '4', '5'],
  },
  {
    id: 'form-cat3',
    label: 'Beneficial ownership reports',
    formTypes: ['SC 13D', 'SCHEDULE 13D', 'SC 13G', 'SCHEDULE 13G'],
  },
  {
    id: 'form-cat4',
    label: 'Exempt offerings',
    formTypes: ['1-A', '1-A POS', '1-A-W', '253G1', '253G2', '253G3', '253G4', 'C', 'D', 'DOS'],
  },
  {
    id: 'form-cat5',
    label: 'Registration statements and prospectuses',
    formTypes: ['10-12B', '10-12G', '18-12B', '20FR12B', '20FR12G', '40-24B2', '40FR12B', '40FR12G', '424A', '424B1', '424B2', '424B3', '424B4', '424B5', '424B7', '424B8', '424H', '425', '485APOS', '485BPOS', '485BXT', '487', '497', '497J', '497K', '8-A12B', '8-A12G', 'AW', 'AW WD', 'DEL AM', 'DRS', 'F-1', 'F-10', 'F-10EF', 'F-10POS', 'F-3', 'F-3ASR', 'F-3D', 'F-3DPOS', 'F-3MEF', 'F-4', 'F-4 POS', 'F-4MEF', 'F-6', 'F-6 POS', 'F-6EF', 'F-7', 'F-7 POS', 'F-8', 'F-8 POS', 'F-80', 'F-80POS', 'F-9', 'F-9 POS', 'F-N', 'F-X', 'FWP', 'N-2', 'POS AM', 'POS EX', 'POS462B', 'POS462C', 'POSASR', 'RW', 'RW WD', 'S-1', 'S-11', 'S-11MEF', 'S-1MEF', 'S-20', 'S-3', 'S-3ASR', 'S-3D', 'S-3DPOS', 'S-3MEF', 'S-4', 'S-4 POS', 'S-4EF', 'S-4MEF', 'S-6', 'S-8', 'S-8 POS', 'S-B', 'S-BMEF', 'SF-1', 'SF-3', 'SUPPL', 'UNDER'],
  },
  {
    id: 'form-cat6',
    label: 'Filing review correspondence',
    formTypes: ['CORRESP', 'DOSLTR', 'DRSLTR', 'UPLOAD'],
  },
  {
    id: 'form-cat7',
    label: 'SEC orders and notices',
    formTypes: ['40-APP', 'CT ORDER', 'EFFECT', 'QUALIF', 'REVOKED'],
  },
  {
    id: 'form-cat8',
    label: 'Proxy materials',
    formTypes: ['ARS', 'DEF 14A', 'DEF 14C', 'DEFA14A', 'DEFA14C', 'DEFC14A', 'DEFC14C', 'DEFM14A', 'DEFM14C', 'DEFN14A', 'DEFR14A', 'DEFR14C', 'DFAN14A', 'DFRN14A', 'PRE 14A', 'PRE 14C', 'PREC14A', 'PREC14C', 'PREM14A', 'PREM14C', 'PREN14A', 'PRER14A', 'PRER14C', 'PRRN14A', 'PX14A6G', 'PX14A6N', 'SC 14N'],
  },
  {
    id: 'form-cat9',
    label: 'Tender offers and going private transactions',
    formTypes: ['CB', 'SC 13E1', 'SC 13E3', 'SC 14D9', 'SC 14F1', 'SC TO-C', 'SC TO-I', 'SC TO-T', 'SC13E4F', 'SC14D9C', 'SC14D9F', 'SC14D1F'],
  },
  {
    id: 'form-cat10',
    label: 'Trust indenture filings',
    formTypes: ['305B2', 'T-3'],
  },
];

// Build form types list
interface FormType {
  id: string;
  label: string;
}

const buildFormTypes = (): FormType[] => {
  const formTypeMap = new Map<string, FormType>();
  
  // Add forms from categories (these are the main ones)
  SEC_FORM_CATEGORIES.forEach(category => {
    if (category.id !== 'all') {
      category.formTypes.forEach(formId => {
        // Handle negative forms (exclusions) - skip them for now
        if (formId.startsWith('-')) return;
        
        if (!formTypeMap.has(formId)) {
          formTypeMap.set(formId, {
            id: formId,
            label: formId,
          });
        }
      });
    }
  });
  
  // Add additional common form types from SEC website (extracted from HTML)
  // These are forms that may not be in categories but are available
  const additionalForms = [
    '1', '1-E', '1-E AD', '1-K', '1-SA', '1-U', '1-Z', '1-Z-W',
    '10-12B', '10-12G', '10-C', '10-D', '10-K', '10-K405', '10-KT', '10-M', '10-Q', '10-QT',
    '10KSB', '10KSB40', '10KSB405', '10KT405', '10QSB', '10SB12B', '10SB12G',
    '11-K', '11-KT',
    '12G-2', '12G3-2A', '12G3-2B', '12G32BR',
    '13F-E', '13F-HR', '13F-NT', '13FCONP',
    '144',
    '15-12B', '15-12G', '15-15D', '15F-12B', '15F-12G', '15F-15D',
    '18-12B', '18-12G', '18-K',
    '19-B', '19B-4', '19B-4E',
    '2-A', '2-AF', '2-E',
    '20-F', '20-FR', '20FR12B', '20FR12G',
    '24F-1', '24F-2EL', '24F-2NT', '24F-2TM',
    '25', '25-NSE',
    '253G1', '253G2', '253G3', '253G4',
    '26', '27', '28',
    '3', '305B2',
    '34-12H', '34-36CF', '34-36MR',
    '35-11', '35-2', '35-3', '35-7B', '35-APP', '35-CERT',
    '39-10B2', '39-304C', '39-304D', '39-310B',
    '4',
    '40-17F1', '40-17F2', '40-17G', '40-17GCS', '40-202A', '40-203A', '40-205A', '40-205E', '40-206A',
    '40-24B2', '40-33', '40-6B', '40-6C', '40-8B25', '40-8F-2', '40-8F-A', '40-8F-B', '40-8F-L', '40-8F-M',
    '40-8FC', '40-APP', '40-F', '40-OIP', '40-RPT',
    '40FR12B', '40FR12G',
    '424A', '424B1', '424B2', '424B3', '424B4', '424B5', '424B7', '424B8', '424H', '425',
    '45B-3',
    '485A24E', '485A24F', '485APOS', '485B24E', '485B24F', '485BPOS', '485BXT', '485BXTF',
    '486A24E', '486APOS', '486B24E', '486BPOS', '486BXT',
    '487', '497', '497AD', '497H2', '497J', '497K', '497K1', '497K2', '497K3A', '497K3B', '497VPI', '497VPU',
    '5',
    '6-K', '6B NTC', '6B ORDR',
    '7-A',
    '8-A12B', '8-A12G', '8-B12B', '8-B12G', '8-K', '8-K12B', '8-K12G3', '8-K15D5', '8-M',
    '8A12BEF', '8A12BT', '8F-2 NTC', '8F-2 ORDR',
    '9-M',
    'ABS-15G', 'ABS-EE',
    'ADB', 'ADN-MTL', 'ADV', 'ADV-E', 'ADV-H-C', 'ADV-H-T', 'ADV-NR', 'ADVCO', 'ADVW',
    'AFDB',
    'ANNLRPT',
    'APP NTC', 'APP ORDR', 'APP WD', 'APP WDG',
    'ARS',
    'ATS-N', 'ATS-N ORDR INEFF', 'ATS-N ORDR LTD OPN', 'ATS-N ORDR REVK', 'ATS-N ORDR SUSP',
    'ATS-N-C', 'ATS-N-W', 'ATS-N/A ORDR INEFF', 'ATS-N/CA', 'ATS-N/MA', 'ATS-N/MA CP', 'ATS-N/OFA', 'ATS-N/UA',
    'AW', 'AW WD',
    'BDCO',
    'BW-2', 'BW-3',
    'C', 'C-AR', 'C-AR-W', 'C-AR/A-W', 'C-TR', 'C-TR-W', 'C-U', 'C-U-W', 'C-W', 'C/A-W',
    'CA-1',
    'CB',
    'CERT', 'CERTAMX', 'CERTARCA', 'CERTBATS', 'CERTBSE', 'CERTCBO', 'CERTCIN', 'CERTCSE', 'CERTISE', 'CERTNAS', 'CERTNYS', 'CERTPAC', 'CERTPBS',
    'CFPORTAL', 'CFPORTAL-W',
    'CORRESP',
    'CT ORDER',
    'D',
    'DEF 14A', 'DEF 14C', 'DEF-OC', 'DEF13E3', 'DEFA14A', 'DEFA14C', 'DEFC14A', 'DEFC14C',
    'DEFM14A', 'DEFM14C', 'DEFN14A', 'DEFR14A', 'DEFR14C', 'DEFS14A', 'DEFS14C',
    'DEL AM',
    'DFAN14A', 'DFRN14A',
    'DOS',
    'DOSLTR',
    'DRS',
    'DRSLTR',
    'DSTRBRPT',
    'EBRD',
    'EFFECT',
    'F-1', 'F-10', 'F-10EF', 'F-10MEF', 'F-10POS', 'F-1MEF', 'F-2', 'F-2D', 'F-2DPOS', 'F-2MEF',
    'F-3', 'F-3ASR', 'F-3D', 'F-3DPOS', 'F-3MEF', 'F-4', 'F-4 POS', 'F-4EF', 'F-4MEF',
    'F-6', 'F-6 POS', 'F-6EF', 'F-7', 'F-7 POS', 'F-8', 'F-8 POS', 'F-80', 'F-80POS',
    'F-9', 'F-9 POS', 'F-9EF', 'F-9MEF', 'F-N', 'F-X',
    'FOCUSN',
    'FWP',
    'G-405', 'G-405N', 'G-FIN', 'G-FINW',
    'HISTORY',
    'IADB',
    'IBRD',
    'ID-NEWCIK',
    'IFC',
    'IRANNOTICE',
    'MA', 'MA-A', 'MA-I', 'MA-W',
    'MSD', 'MSDCO', 'MSDW',
    'N-1', 'N-14', 'N-14 8C', 'N-14AE', 'N-14MEF', 'N-18F1', 'N-1A', 'N-1A EL',
    'N-2', 'N-2 POSASR', 'N-23C-1', 'N-23C-2', 'N-23C3A', 'N-23C3B', 'N-23C3C', 'N-27D-1', 'N-2ASR', 'N-2MEF',
    'N-3', 'N-3 EL', 'N-30B-2', 'N-30D',
    'N-4', 'N-4 EL', 'N-5', 'N-54A', 'N-54C',
    'N-6', 'N-6C9', 'N-6F',
    'N-8A', 'N-8B-2', 'N-8B-3', 'N-8B-4', 'N-8F', 'N-8F NTC', 'N-8F ORDR',
    'N-CEN', 'N-CR', 'N-CSR', 'N-CSRS',
    'N-MFP', 'N-MFP1', 'N-MFP2',
    'N-PX',
    'N-Q',
    'N-VP', 'N-VPFS',
    'N14AE24', 'N14EL24',
    'NO ACT',
    'NPORT-EX', 'NPORT-NP', 'NPORT-P',
    'NRSRO-CE', 'NRSRO-UPD',
    'NSAR-A', 'NSAR-AT', 'NSAR-B', 'NSAR-BT', 'NSAR-U',
    'NT 10-D', 'NT 10-K', 'NT 10-Q', 'NT 11-K', 'NT 15D2', 'NT 20-F',
    'NT N-CEN', 'NT N-MFP', 'NT N-MFP1', 'NT N-MFP2', 'NT NPORT-EX', 'NT NPORT-N', 'NT NPORT-P',
    'NT-NCEN', 'NT-NCSR', 'NT-NSAR',
    'NTFNCEN', 'NTFNCSR', 'NTFNSAR',
    'NTN 10-D', 'NTN 10D', 'NTN 10K', 'NTN 10Q', 'NTN 11K', 'NTN 20F', 'NTN15D2',
    'OC',
    'OIP NTC', 'OIP ORDR',
    'POS 8C', 'POS AM', 'POS AMC', 'POS AMI', 'POS EX', 'POS462B', 'POS462C', 'POSASR',
    'PRE 14A', 'PRE 14C', 'PRE13E3', 'PREA14A', 'PREA14C', 'PREC14A', 'PREC14C',
    'PREM14A', 'PREM14C', 'PREN14A', 'PRER14A', 'PRER14C', 'PRES14A', 'PRES14C', 'PRRN14A',
    'PWR-ATT',
    'PX14A6G', 'PX14A6N',
    'QRTLYRPT',
    'QUALIF',
    'REG-NR',
    'REGDEX',
    'REVOKED',
    'RW', 'RW WD',
    'S-1', 'S-11', 'S-11MEF', 'S-1MEF', 'S-2', 'S-20', 'S-2MEF',
    'S-3', 'S-3ASR', 'S-3D', 'S-3DPOS', 'S-3MEF',
    'S-4', 'S-4 POS', 'S-4EF', 'S-4MEF',
    'S-6', 'S-6EL24',
    'S-8', 'S-8 POS',
    'S-B', 'S-BMEF',
    'SB-1', 'SB-1MEF', 'SB-2', 'SB-2MEF',
    'SBSE', 'SBSE-A', 'SBSE-BD', 'SBSE-C', 'SBSE-W',
    'SBSEF', 'SBSEF-V', 'SBSEF-W', 'SBSEF/A',
    'SC 13D', 'SC 13E1', 'SC 13E3', 'SC 13E4', 'SC 13G',
    'SC 14D1', 'SC 14D9', 'SC 14F1', 'SC 14N', 'SC 14N-S',
    'SC TO-C', 'SC TO-I', 'SC TO-T',
    'SC13E4F', 'SC14D1F', 'SC14D9', 'SC14D9C', 'SC14D9F',
    'SCHEDULE 13D', 'SCHEDULE 13G',
    'SD',
    'SDR', 'SDR-A', 'SDR-W',
    'SE',
    'SEC ACTION', 'SEC STAFF ACTION', 'SEC STAFF LETTER',
    'SF-1', 'SF-3',
    'SH-ER', 'SH-NT',
    'SL',
    'SP 15D2',
    'SPDSCL',
    'STOP ORDER',
    'SUPPL',
    'T-3',
    'TA-1', 'TA-2', 'TA-W', 'TACO',
    'TH',
    'TTW',
    'U-1', 'U-12-IA', 'U-12-IB', 'U-13-1', 'U-13-60', 'U-13E-1', 'U-33-S',
    'U-3A-2', 'U-3A3-1', 'U-57', 'U-6B-2', 'U-7D', 'U-9C-3', 'U-R-1',
    'U5A', 'U5B', 'U5S',
    'UNDER',
    'UPLOAD',
    'WDL-REQ',
    'X-17A-5',
  ];
  
  additionalForms.forEach(formId => {
    if (!formTypeMap.has(formId)) {
      formTypeMap.set(formId, {
        id: formId,
        label: formId,
      });
    }
  });
  
  return Array.from(formTypeMap.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const ALL_FORM_TYPES = buildFormTypes();

interface SECSearchTileProps {
  id: string;
  size?: { width: number; height: number };
  dashboardContext?: string;
  onRemove: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
  onSettingsChange: (id: string, settings: any) => void;
  onDragStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  onSelectionChange?: (isSelected: boolean) => void;
  isSelected?: boolean;
  searchParams?: Partial<SECSearchParams>;
  filterSettings?: {
    entities?: Array<{ entity: string; cik?: string }>;
    forms?: string[];
    locations?: string[];
    incorporationStates?: string[];
  };
  filers?: SECAutocompleteSuggestion[]; // Store full filer information for persistence
  displayOptions?: {
    showEntity?: boolean;
    showForm?: boolean;
    showFilingDate?: boolean;
    showLocation?: boolean;
    showIncorporation?: boolean;
    showCIK?: boolean;
    showResultsTable?: boolean;
    maxResults?: number;
    compactView?: boolean;
    results?: SECSearchResult[];
  };
  paginationState?: {
    totalResultsLoaded?: number;
    lastEvaluatedKeys?: any[];
    hasMore?: boolean;
  };
  results?: SECSearchResult[];
  autoRefresh?: boolean;
  isPinned?: boolean;
  customTitle?: string;
  customColor?: string;
  customIcon?: string;
}

/**
 * SECSearchTile - Search and display SEC filings with session-based persistence
 * 
 * Persistence Strategy:
 * - Search parameters (query setup): Persisted to backend database across sessions
 * - Search results (data): Persisted in session memory during user login only
 * - Users can manually refresh for fresh data when needed
 */
const SECSearchTile: React.FC<SECSearchTileProps> = memo(({
  id,
  size,
  dashboardContext,
  onRemove,
  onUpdate,
  onSettingsChange,
  onDragStart,
  isDragging = false,
  isResizing = false,
  onSelectionChange,
  isSelected = false,
  searchParams: initialSearchParams = {},
  filterSettings: initialFilterSettings,
  filers: initialFilers = [],
  displayOptions: initialDisplayOptions = {
    showEntity: true,
    showForm: true,
    showFilingDate: true,
    showLocation: true,
    showIncorporation: true,
    showCIK: true,
    showResultsTable: true,
    maxResults: 50,
    compactView: false,
  },
  paginationState,
  results: resultsProp,
  autoRefresh = false,
  isPinned = false,
  customTitle,
  customColor,
  customIcon,
}) => {
  const { user } = useAuth();
  const { activeSessionId } = useGlobalChat();
  const { openItemDetails } = useDialogManagerHelpers();
  const { isEasyMode } = useEasyMode();
  const { isDemo } = useDemoDashboard();
  
  // Debug authentication state
  useEffect(() => {
    console.log('🔐 SECSearchTile Auth State:', { 
      userId: user?.id, 
      activeSessionId,
      userExists: !!user 
    });
  }, [user?.id, activeSessionId]);
  
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [formTypesModalOpen, setFormTypesModalOpen] = useState(false);
  const [showAllFormTypesDialog, setShowAllFormTypesDialog] = useState(false);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<null | HTMLElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  
  // Search state - matching SEC search page structure
  // Convert initialSearchParams to use arrays for entityName and keywords (like PoliticianTradesSearchTile)
  const normalizeEntityName = (value: string | string[] | undefined): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    // If it's a comma-separated string, split it
    return value.split(',').map(name => name.trim()).filter(Boolean);
  };
  
  const normalizeKeywords = (value: string | string[] | undefined): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    // If it's a space-separated string, split it
    return value.split(' ').map(k => k.trim()).filter(Boolean);
  };
  
  const [currentSearchParams, setCurrentSearchParams] = useState<SECSearchParams>({
    dateFrom: initialSearchParams.dateFrom || '2001-01-01',
    dateTo: initialSearchParams.dateTo || new Date().toISOString().split('T')[0],
    cik: initialSearchParams.cik,
    entityName: normalizeEntityName(initialSearchParams.entityName),
    keywords: normalizeKeywords(initialSearchParams.keywords),
    formTypes: initialSearchParams.formTypes,
    located: initialSearchParams.located,
  });
  // Store all results for client-side filtering
  const [allResults, setAllResults] = useState<SECSearchResult[]>([]);

  // Track if initial search has been performed
  const [hasPerformedInitialSearch, setHasPerformedInitialSearch] = useState(false);
  
  // Refs for stopping search
  const shouldContinueSearchRef = useRef<boolean>(true);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentJobIdRef = useRef<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<{ currentPage: number; totalPages: number | null } | null>(null);
  
  // Multi-select state - we'll read/write directly from currentSearchParams like PoliticianTradesSearchTile
  // Store full filer information for persistence (name, CIK, ticker)
  const [persistedFilers, setPersistedFilers] = useState<SECAutocompleteSuggestion[]>(initialFilers);
  const [companySuggestions, setCompanySuggestions] = useState<SECAutocompleteSuggestion[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  
  // Filter state matching SEC search page - restore from props if available
  // Must be declared before useEffect that uses it
  // Match the structure from SECSearchPage.tsx
  const [selectedFilters, setSelectedFilters] = useState<{
    entities: Array<{ entity: string; cik?: string }>;
    forms: string[];
    locations: string[];
    incorporationStates: string[];
  }>({
    entities: initialFilterSettings?.entities?.map(e => 
      typeof e === 'string' 
        ? { entity: e } // Convert string to object if needed
        : { entity: e.entity, cik: e.cik }
    ) || [],
    forms: initialFilterSettings?.forms || [],
    locations: initialFilterSettings?.locations || [],
    incorporationStates: initialFilterSettings?.incorporationStates || []
  });

  // Session-based persistence: Restore results from session data on mount
  // Results persist for the duration of user login, searchParams persist to backend
  useEffect(() => {
    if (initialDisplayOptions.results && initialDisplayOptions.results.length > 0 && allResults.length === 0) {
      console.log('🔄 SECSearchTile: Restoring session results from tile data:', initialDisplayOptions.results.length, 'results');
      setAllResults(initialDisplayOptions.results);
    }
  }, [initialDisplayOptions.results, allResults.length]);
  // Demo mode: seed allResults from results prop so dummy data shows without a search
  useEffect(() => {
    if (isDemo && resultsProp && resultsProp.length > 0 && allResults.length === 0) {
      setAllResults(resultsProp);
      setHasPerformedInitialSearch(true);
    }
  }, [isDemo, resultsProp, allResults.length]);

  // Sync filterSettings prop to state (only if actually different)
  useEffect(() => {
    console.log('🔄 SECSearchTile: filterSettings sync effect triggered', {
      tileId: id,
      initialFilterSettings,
    });
    if (initialFilterSettings) {
      setSelectedFilters(prev => {
        const newFilters = {
          entities: initialFilterSettings.entities?.map(e => 
            typeof e === 'string' 
              ? { entity: e }
              : { entity: e.entity, cik: e.cik }
          ) || [],
          forms: initialFilterSettings.forms || [],
          locations: initialFilterSettings.locations || [],
          incorporationStates: initialFilterSettings.incorporationStates || [],
        };
        // Check if filters actually changed
        const prevStr = JSON.stringify(prev);
        const newStr = JSON.stringify(newFilters);
        if (prevStr === newStr) {
          console.log('🔄 SECSearchTile: filterSettings unchanged, skipping update', {
            tileId: id,
            currentFilters: prev,
            newFilters,
          });
          return prev;
        }
        console.log('🔄 SECSearchTile: Updating selectedFilters from filterSettings prop', {
          tileId: id,
          previousFilters: prev,
          newFilters,
        });
        return newFilters;
      });
    } else {
      console.log('🔄 SECSearchTile: No initialFilterSettings prop provided', {
        tileId: id,
      });
    }
  }, [initialFilterSettings, id]);

  // Filters are client-side only - not persisted to dashboard
  
  // Compute available filters from all results
  const availableFilters = useMemo(() => {
    const formCounts = new Map<string, number>();
    const entityCounts = new Map<string, number>();
    const locationCounts = new Map<string, number>();
    const incorporationCounts = new Map<string, number>();
    
    allResults.forEach(result => {
      // Count forms
      if (result.form) {
        formCounts.set(result.form, (formCounts.get(result.form) || 0) + 1);
      }
      
      // Count entities (from filingEntity)
      if (result.filingEntity) {
        const entityKey = result.cik 
          ? `${result.filingEntity} (CIK ${result.cik.padStart(10, '0')})` 
          : result.filingEntity;
        entityCounts.set(entityKey, (entityCounts.get(entityKey) || 0) + 1);
      }
      
      // Count locations
      if (result.located) {
        locationCounts.set(result.located, (locationCounts.get(result.located) || 0) + 1);
      }
      
      // Count incorporation states
      if (result.incorporated) {
        incorporationCounts.set(result.incorporated, (incorporationCounts.get(result.incorporated) || 0) + 1);
      }
    });
    
    return {
      form_filters: Array.from(formCounts.entries())
        .map(([form, count]) => ({ form, count }))
        .sort((a, b) => b.count - a.count),
      entity_filters: Array.from(entityCounts.entries())
        .map(([entity, count]) => ({ entity, count }))
        .sort((a, b) => b.count - a.count),
      location_filters: Array.from(locationCounts.entries())
        .map(([location, count]) => ({ location, count }))
        .sort((a, b) => b.count - a.count),
      incorporation_filters: Array.from(incorporationCounts.entries())
        .map(([incorporation, count]) => ({ incorporation, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [allResults]);
  
  // Selection state
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  // Display options state - memoize to prevent infinite re-renders
  const localDisplayOptions = useMemo(() => ({
    ...{
      showEntity: true,
      showForm: true,
      showFilingDate: true,
      showLocation: true,
      showIncorporation: true,
      showCIK: true,
      showResultsTable: true,
      maxResults: 50,
      compactView: false,
    },
    ...initialDisplayOptions
  }), [initialDisplayOptions]);

  // Column visibility state - separate state that can be toggled via column menu
  const [visibleColumns, setVisibleColumns] = useState({
    entity: localDisplayOptions.showEntity,
    form: localDisplayOptions.showForm,
    filingDate: localDisplayOptions.showFilingDate,
    location: localDisplayOptions.showLocation,
    incorporation: localDisplayOptions.showIncorporation,
    cik: localDisplayOptions.showCIK,
  });

  // Handle column toggle
  const handleColumnToggle = useCallback((columnKey: keyof typeof visibleColumns) => {
    setVisibleColumns((prev) => {
      const newColumns = {
        ...prev,
        [columnKey]: !prev[columnKey],
      };
      
      // Update display options via onSettingsChange to persist
      const displayOptionKey = `show${columnKey.charAt(0).toUpperCase() + columnKey.slice(1)}` as keyof typeof localDisplayOptions;
      onSettingsChange(id, {
        displayOptions: {
          ...localDisplayOptions,
          [displayOptionKey]: newColumns[columnKey],
        },
      });
      
      return newColumns;
    });
  }, [localDisplayOptions, id, onSettingsChange]);

  // Persist displayOptions when they change (maxResults, compactView, showResultsTable, etc.)
  // Use ref to track previous value and only persist when it actually changes (not from prop updates)
  const prevDisplayOptionsRef = useRef(localDisplayOptions);
  useEffect(() => {
    // Only persist if displayOptions actually changed (deep comparison)
    const prev = prevDisplayOptionsRef.current;
    const hasChanged = JSON.stringify(prev) !== JSON.stringify(localDisplayOptions);
    if (hasChanged) {
      prevDisplayOptionsRef.current = localDisplayOptions;
      onSettingsChange(id, { displayOptions: localDisplayOptions });
    }
  }, [localDisplayOptions, id, onSettingsChange]);

  // Persist searchParams when they change
  useEffect(() => {
    onSettingsChange(id, { searchParams: currentSearchParams, filers: persistedFilers });
  }, [currentSearchParams, persistedFilers, id, onSettingsChange]);

  // Column width state for dynamic sizing
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(() => {
    const saved = localStorage.getItem(`secSearch_pageSize_${id}`);
    return saved ? parseInt(saved) : 5;
  });
  const isPageSizeManuallySet = localStorage.getItem(`secSearch_pageSize_${id}`) !== null;
  const tileRef = useRef<HTMLDivElement>(null);
  const lastClickTimeRef = useRef<number>(0);



  // Pinning functionality
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });

  // Auto refresh functionality
  const autoRefreshRef = useRef<NodeJS.Timeout>();

      

  // Stop search handler
  const handleStopSearch = useCallback(() => {
    console.log('🛑 SECSearchTile: Stopping search');
    
    // Set flag to stop polling
    shouldContinueSearchRef.current = false;
    
    // Clear polling timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    
    // Cancel the job on backend if we have a job ID
    if (currentJobIdRef.current) {
      console.log(`🛑 SECSearchTile: Cancelling job ${currentJobIdRef.current} on backend`);
      secSearchAPI.cancelJob(currentJobIdRef.current).catch(err => {
        console.error('❌ SECSearchTile: Error cancelling job:', err);
      });
      currentJobIdRef.current = null;
    }
    
    // Clear frontend search state
    setIsLoading(false);
    setFetchProgress(null);
    
    console.log('🛑 SECSearchTile: Search stopped - backend may continue in background');
  }, []);

  const performSearch = useCallback(async () => {
    if (!currentSearchParams) return;
    
    // Demo mode: use dummy data only, no API calls. Filter is applied by existing filter effect.
    if (isDemo) {
      const source = (resultsProp && resultsProp.length > 0) ? resultsProp : allResults;
      setAllResults(source);
      setHasPerformedInitialSearch(true);
      setIsLoading(false);
      return;
    }
    
    // Reset stop flag
    shouldContinueSearchRef.current = true;
    
    console.log('🏛️ SECSearchTile: Starting search with params:', currentSearchParams);
    setIsLoading(true);
    setError(null);
    setFetchProgress({ currentPage: 0, totalPages: null }); // Initialize progress
    
    try {
      // Build search request - entityName and keywords are already arrays in currentSearchParams
      // Convert arrays to the format the API expects (strings for backward compatibility)
      const entityNameArray = Array.isArray(currentSearchParams.entityName) 
        ? currentSearchParams.entityName 
        : (currentSearchParams.entityName ? [currentSearchParams.entityName] : []);
      const keywordsArray = Array.isArray(currentSearchParams.keywords)
        ? currentSearchParams.keywords
        : (currentSearchParams.keywords ? [currentSearchParams.keywords] : []);
      
      const searchRequest = {
        ...currentSearchParams,
        // Convert arrays to comma/space-separated strings for API (maintains backward compatibility)
        entityName: entityNameArray.length > 0 ? entityNameArray.join(',') : undefined,
        keywords: keywordsArray.length > 0 ? keywordsArray.join(' ') : undefined,
        // Extract CIK if we have entity names (for single entity searches)
        cik: entityNameArray.length === 1 && currentSearchParams.cik 
          ? currentSearchParams.cik 
          : (Array.isArray(currentSearchParams.cik) && currentSearchParams.cik.length === 1
            ? currentSearchParams.cik[0]
            : currentSearchParams.cik),
        page: 1,
      };
      
      console.log('📤 SECSearchTile: Sending async search request:', searchRequest);
      
      // Start async search - returns job_id immediately
      const startResponse = await secSearchAPI.searchAsync(searchRequest);
      
      if (!startResponse.job_id) {
        throw new Error('No job_id returned from async search');
      }
      
      const jobId = startResponse.job_id;
      currentJobIdRef.current = jobId; // Store job ID for cancellation
      console.log(`✅ SECSearchTile: Async search started with job_id: ${jobId}`);
      
      // Check if this is a cached response with results
      // Handle cached results - check both direct results and S3
      if (startResponse.cached && startResponse.status === 'COMPLETED') {
        console.log(`✅ SECSearchTile: Cached search found`, startResponse);
        
        let results: any[] = [];
        
        // First check if results are directly in the response
        if (startResponse.results && startResponse.results.length > 0) {
          results = startResponse.results;
          console.log(`✅ SECSearchTile: Found ${results.length} cached results in startResponse.results`);
        } else if (startResponse.results_s3_key) {
          // Fetch from S3 as fallback
          try {
            console.log(`SECSearchTile: Fetching cached results from S3: ${startResponse.results_s3_key}`);
            const s3Results = await secSearchAPI.fetchResultsFromS3(jobId, startResponse.results_s3_key);
            if (s3Results.results) {
              results = s3Results.results;
              console.log(`✅ SECSearchTile: Found ${results.length} cached results from S3`);
            }
          } catch (error) {
            console.error(`❌ SECSearchTile: Error fetching cached results from S3:`, error);
            // Fall through to polling as backup
          }
        }
        
        if (results.length > 0) {
          // Store all results for filtering (don't limit here - filtering will handle display limits)
          const allResultsData = results;
          console.log('📊 SECSearchTile: Setting cached allResults:', allResultsData.length);
          setAllResults(allResultsData);
          // currentResults will be set by filter useEffect
          
            // Update tile data - session metadata only (not raw results)
            onUpdate(id, {
              lastUpdated: new Date().toISOString(),
            });
            
            // Persist search params to backend (database) - NOT results
            onSettingsChange(id, { searchParams: currentSearchParams, filers: persistedFilers });
            
            // Mark initial search as performed
            setHasPerformedInitialSearch(true);
            
            console.log(`✅ SECSearchTile: Displaying ${allResultsData.length} cached results - State updated`);
            setIsLoading(false);
            return; // Done - no need to poll
        }
      }
      
      // Poll for job completion
      const pollForResults = async () => {
        // Check if search was stopped
        if (!shouldContinueSearchRef.current) {
          console.log(`🛑 SECSearchTile: Polling stopped for job ${jobId}`);
          setIsLoading(false);
          setFetchProgress(null);
          return;
        }
        
        try {
          const jobStatus = await secSearchAPI.getJobStatus(jobId);
          
          // Check again after async call
          if (!shouldContinueSearchRef.current) {
            console.log(`🛑 SECSearchTile: Search was stopped during polling for job ${jobId}`);
            setIsLoading(false);
            setFetchProgress(null);
            return;
          }
          
          if (!jobStatus) {
            console.warn(`⚠️ SECSearchTile: No status found for job ${jobId}`);
            return;
          }
          
          // Update progress from backend
          if (jobStatus.progress) {
            setFetchProgress({
              currentPage: jobStatus.progress.current_page || 0,
              totalPages: jobStatus.progress.total_pages || null,
            });
          }
          
          // Check if job is complete
          if (jobStatus.status === 'COMPLETED') {
            console.log('SECSearchTile: Job completed, jobStatus:', jobStatus);
            
            // Get results from job_status
            let results: any[] = [];
            if (jobStatus.results?.results) {
              results = jobStatus.results.results;
              console.log(`✅ SECSearchTile: Found ${results.length} results in jobStatus.results.results`);
            } else if (jobStatus.results_s3_key) {
              // Fetch from S3
              console.log(`SECSearchTile: Results stored in S3: ${jobStatus.results_s3_key} - fetching...`);
              try {
                const s3Results = await secSearchAPI.fetchResultsFromS3(jobId, jobStatus.results_s3_key);
                if (s3Results.results) {
                  results = s3Results.results;
                  console.log(`✅ SECSearchTile: Fetched ${results.length} results from S3`);
                } else {
                  console.warn(`⚠️ SECSearchTile: No results in S3 response`);
                }
              } catch (error) {
                console.error(`❌ SECSearchTile: Error fetching results from S3:`, error);
                // Continue with empty results - user can retry
              }
            } else {
              console.warn('⚠️ SECSearchTile: No results found in response structure');
              console.log('Full jobStatus structure:', JSON.stringify(jobStatus, null, 2));
            }
            
            // Store all results for filtering (don't limit here - filtering will handle display limits)
            console.log('📊 SECSearchTile: Setting allResults:', results.length);
            setAllResults(results);
            // currentResults will be set by filter useEffect
            
            // Update tile data - session metadata only (not raw results)
            onUpdate(id, {
              lastUpdated: new Date().toISOString(),
            });
            
            // Persist search params to backend (database) - NOT results
            onSettingsChange(id, { searchParams: currentSearchParams, filers: persistedFilers });
            
            // Mark initial search as performed
            setHasPerformedInitialSearch(true);
            
            console.log(`✅ SECSearchTile: Found ${results.length} results - State updated`);
            setIsLoading(false);
            setFetchProgress(null); // Clear progress when complete
          } else if (jobStatus.status === 'FAILED') {
            console.error('❌ SECSearchTile: Search job failed:', jobStatus.error);
            setError(jobStatus.error || 'Search failed');
            setAllResults([]);
            setHasPerformedInitialSearch(true);
            setIsLoading(false);
            setFetchProgress(null); // Clear progress on failure
          } else {
            // Still in progress, poll again (only if search wasn't stopped)
            if (shouldContinueSearchRef.current) {
              pollingTimeoutRef.current = setTimeout(pollForResults, 2000); // Poll every 2 seconds
            }
          }
        } catch (err) {
          console.error('❌ SECSearchTile: Error polling job status:', err);
          setError('Search failed: ' + (err as Error).message);
          setAllResults([]);
          setHasPerformedInitialSearch(true);
          setIsLoading(false);
          setFetchProgress(null); // Clear progress on error
        }
      };
      
      // Start polling after a short delay
      pollingTimeoutRef.current = setTimeout(pollForResults, 1000);
      
    } catch (err) {
      console.error('❌ SECSearchTile: Search error:', err);
      setError('Search failed: ' + (err as Error).message);
      setAllResults([]);
      setHasPerformedInitialSearch(true);
      setIsLoading(false);
      setFetchProgress(null); // Clear progress on error
      currentJobIdRef.current = null; // Clear job ID on error
    }
  }, [currentSearchParams, localDisplayOptions.maxResults, id, onUpdate, isDemo, resultsProp, allResults]);
  
  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      shouldContinueSearchRef.current = false;
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    };
  }, []);

  // Dynamic pagination based on tile height
  const calculateResultsPerPage = useCallback(() => {
    if (!tileRef.current) return 5; // Default fallback
    
    const tileHeight = tileRef.current.clientHeight;
    const headerHeight = 60; // Approximate header height
    const paginationHeight = 40; // Approximate pagination height
    const tableHeaderHeight = 40; // Table header height
    const rowHeight = 32; // Approximate row height
    const padding = 24; // Tile padding (12px * 2)
    
    // Calculate available height for table rows
    const availableHeight = tileHeight - headerHeight - paginationHeight - tableHeaderHeight - padding;
    const maxRows = Math.floor(availableHeight / rowHeight);
    
    // Ensure minimum of 3 rows and maximum of 20 rows
    return Math.max(3, Math.min(20, maxRows));
  }, []);

  // Update results per page when tile size changes (only if not manually set)
  useEffect(() => {
    if (!isPageSizeManuallySet) {
      const newResultsPerPage = calculateResultsPerPage();
      setResultsPerPage(newResultsPerPage);
    }
  }, [calculateResultsPerPage, size, isPageSizeManuallySet]);

  // Add ResizeObserver to recalculate when tile is resized (only if not manually set)
  useEffect(() => {
    if (!tileRef.current || isPageSizeManuallySet) return;

    const resizeObserver = new ResizeObserver(() => {
      if (!isPageSizeManuallySet) {
        const newResultsPerPage = calculateResultsPerPage();
        setResultsPerPage(newResultsPerPage);
      }
    });

    resizeObserver.observe(tileRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [calculateResultsPerPage, isPageSizeManuallySet]);

  // Auto refresh effect
  useEffect(() => {
    if (autoRefresh && !isDragging && !isResizing) {
      autoRefreshRef.current = setInterval(performSearch, 600000); // 10 minutes
      return () => {
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current);
        }
      };
    }
  }, [autoRefresh, performSearch, isDragging, isResizing]);

  // Client-side filtering function - operates on allResults, never triggers API calls
  // Logic: OR within each filter type, AND between filter types
  const filterResults = useCallback((results: SECSearchResult[]): SECSearchResult[] => {
    let filtered = [...results];
    
    // Filter by entities (OR logic - any selected entity matches)
    // A result matches if it matches ANY of the selected entities
    if (selectedFilters.entities.length > 0) {
      filtered = filtered.filter(result => {
        const reportingFor = (result.reportingFor || '').toLowerCase().trim();
        const filingEntity = (result.filingEntity || '').toLowerCase().trim();
        const resultCik = (result.cik || '').trim();
        
        return selectedFilters.entities.some(entity => {
          // Extract entity name from filter (might be "Name (CIK 0000000000)" or just "Name")
          const entityFilterName = entity.entity.toLowerCase().trim();
          const entityCik = (entity.cik || '').trim();
          
          // Extract just the name part if it's in "Name (CIK 0000000000)" format
          const nameMatch = entityFilterName.match(/^(.+?)\s*\(CIK\s+\d+\)$/);
          const entityNameOnly = nameMatch ? nameMatch[1].trim() : entityFilterName;
          
          // Match by CIK if available (most accurate)
          if (entityCik && resultCik) {
            // Normalize CIKs (remove leading zeros for comparison, or pad to 10 digits)
            const normalizedEntityCik = entityCik.padStart(10, '0');
            const normalizedResultCik = resultCik.padStart(10, '0');
            if (normalizedEntityCik === normalizedResultCik) {
              return true;
            }
          }
          
          // Match by entity name (exact match first, then contains)
          // Check if reportingFor or filingEntity exactly matches the entity name
          if (reportingFor === entityNameOnly || filingEntity === entityNameOnly) {
            return true;
          }
          
          // Also check if the entity name is contained in reportingFor or filingEntity
          // (for cases where entity name might be part of a longer string)
          if (reportingFor.includes(entityNameOnly) || filingEntity.includes(entityNameOnly)) {
            return true;
          }
          
          // Also check if the full filter string (with CIK) matches
          if (reportingFor.includes(entityFilterName) || filingEntity.includes(entityFilterName)) {
            return true;
          }
          
          return false;
        });
      });
    }
    
    // Filter by forms (OR logic - any selected form matches)
    if (selectedFilters.forms.length > 0) {
      filtered = filtered.filter(result => {
        const resultForm = result.form || '';
        return selectedFilters.forms.some(form => form === resultForm);
      });
    }
    
    // Filter by locations (OR logic - any selected location matches)
    if (selectedFilters.locations.length > 0) {
      filtered = filtered.filter(result => {
        const located = (result.located || '').toLowerCase();
        return selectedFilters.locations.some(loc => {
          const locLower = loc.toLowerCase();
          return located === locLower || located.includes(locLower);
        });
      });
    }
    
    // Filter by incorporation states (OR logic - any selected state matches)
    if (selectedFilters.incorporationStates.length > 0) {
      filtered = filtered.filter(result => {
        const incorporated = (result.incorporated || '').toLowerCase();
        return selectedFilters.incorporationStates.some(state => {
          const stateLower = state.toLowerCase();
          return incorporated === stateLower || incorporated.includes(stateLower);
        });
      });
    }
    
    return filtered;
  }, [selectedFilters]);

  // Apply filters to allResults - use useMemo instead of useEffect to avoid infinite loops
  const currentResults = useMemo(() => {
    if (allResults.length === 0) {
      return [];
    }
    
    const hasFilters = selectedFilters.entities.length > 0 ||
                       selectedFilters.forms.length > 0 ||
                       selectedFilters.locations.length > 0 ||
                       selectedFilters.incorporationStates.length > 0;
    
    if (hasFilters) {
      return filterResults(allResults);
    } else {
      // No filters - show all results
      return allResults;
    }
  }, [allResults, selectedFilters, filterResults]);

  // Preview mode: Run fresh query when opened in preview ONLY if no pagination state exists
  useEffect(() => {
    if (dashboardContext === 'filesystem_preview' && !isLoading) {
      // Skip fresh query if tile already has pagination state (preserve "load more +X" state)
      if (paginationState && paginationState.totalResultsLoaded !== undefined && paginationState.totalResultsLoaded > 0) {
        console.log('🔄 SECSearchTile: Preview mode - preserving existing pagination state (totalResultsLoaded:', paginationState.totalResultsLoaded, ')');
        return;
      }
      
      // Only auto-search if we have meaningful search params (not just defaults)
      // Check for actual values, not just empty arrays or default dates
      const hasSearchCriteria = 
        (currentSearchParams.cik && (Array.isArray(currentSearchParams.cik) ? currentSearchParams.cik.length > 0 : currentSearchParams.cik.trim() !== '')) ||
        (Array.isArray(currentSearchParams.entityName) && currentSearchParams.entityName.length > 0 && currentSearchParams.entityName.some(name => name && name.trim() !== '')) ||
        (!Array.isArray(currentSearchParams.entityName) && currentSearchParams.entityName && currentSearchParams.entityName.trim() !== '') ||
        (Array.isArray(currentSearchParams.keywords) && currentSearchParams.keywords.length > 0 && currentSearchParams.keywords.some(kw => kw && kw.trim() !== '')) ||
        (!Array.isArray(currentSearchParams.keywords) && currentSearchParams.keywords && currentSearchParams.keywords.trim() !== '') ||
        (currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0) ||
        (Array.isArray(currentSearchParams.located) && currentSearchParams.located.length > 0 && currentSearchParams.located.some(loc => loc && loc.trim() !== '')) ||
        (!Array.isArray(currentSearchParams.located) && currentSearchParams.located && currentSearchParams.located.trim() !== '');
      
      if (hasSearchCriteria) {
        console.log('🔄 SECSearchTile: Preview mode - running fresh query (no pagination state)');
        setHasPerformedInitialSearch(false); // Reset to allow fresh search
        performSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardContext]); // Only run when dashboardContext changes (i.e., when opened in preview)

  // Initial load: Fetch fresh results if none exist
  useEffect(() => {
    if (!hasPerformedInitialSearch && currentResults.length === 0 && !isLoading) {
      // Only auto-search if we have meaningful search params (not just defaults)
      // Check for actual values, not just empty arrays or default dates
      const hasSearchCriteria = 
        (currentSearchParams.cik && (Array.isArray(currentSearchParams.cik) ? currentSearchParams.cik.length > 0 : currentSearchParams.cik.trim() !== '')) ||
        (Array.isArray(currentSearchParams.entityName) && currentSearchParams.entityName.length > 0 && currentSearchParams.entityName.some(name => name && name.trim() !== '')) ||
        (!Array.isArray(currentSearchParams.entityName) && currentSearchParams.entityName && currentSearchParams.entityName.trim() !== '') ||
        (Array.isArray(currentSearchParams.keywords) && currentSearchParams.keywords.length > 0 && currentSearchParams.keywords.some(kw => kw && kw.trim() !== '')) ||
        (!Array.isArray(currentSearchParams.keywords) && currentSearchParams.keywords && currentSearchParams.keywords.trim() !== '') ||
        (currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0) ||
        (Array.isArray(currentSearchParams.located) && currentSearchParams.located.length > 0 && currentSearchParams.located.some(loc => loc && loc.trim() !== '')) ||
        (!Array.isArray(currentSearchParams.located) && currentSearchParams.located && currentSearchParams.located.trim() !== '');
      
      if (hasSearchCriteria) {
        console.log('🔄 SECSearchTile: Initial load - performing search with existing params');
        performSearch();
      } else {
        console.log('⏸️ SECSearchTile: No meaningful search criteria - skipping auto-search');
        // Mark as performed so we don't keep checking
        setHasPerformedInitialSearch(true);
      }
    }
  }, [hasPerformedInitialSearch, currentResults.length, isLoading, currentSearchParams, performSearch]);

  // Format date helper
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Calculate optimal column widths based on content
  const calculateColumnWidths = useCallback((results: SECSearchResult[]) => {
    const widths: Record<string, number> = {};
    
    // Sample of results to measure (use first 50 for performance)
    const sampleResults = results.slice(0, 50);
    
    if (sampleResults.length === 0) return widths;
    
    // Base minimum widths (in pixels)
    const minWidths = {
      checkbox: 50,
      entity: 150,
      form: 80,
      filingDate: 100,
      location: 120,
      incorporation: 100,
      cik: 100,
    };
    
    // Calculate content-based widths
    widths.checkbox = minWidths.checkbox;
    
    if (visibleColumns.entity) {
      const maxLength = Math.max(...sampleResults.map(r => (r.filingEntity || '').length));
      widths.entity = Math.max(minWidths.entity, Math.min(maxLength * 8 + 32, 250));
    }
    
    if (visibleColumns.form) {
      widths.form = minWidths.form; // Fixed size for form types
    }
    
    if (visibleColumns.filingDate) {
      widths.filingDate = minWidths.filingDate; // Fixed for date format
    }
    
    if (visibleColumns.location) {
      const maxLength = Math.max(...sampleResults.map(r => (r.located || '').length));
      widths.location = Math.max(minWidths.location, Math.min(maxLength * 8 + 32, 200));
    }
    
    if (visibleColumns.incorporation) {
      const maxLength = Math.max(...sampleResults.map(r => (r.incorporated || '').length));
      widths.incorporation = Math.max(minWidths.incorporation, Math.min(maxLength * 8 + 32, 150));
    }
    
    if (visibleColumns.cik) {
      widths.cik = minWidths.cik; // Fixed for CIK numbers
    }
    
    return widths;
  }, [visibleColumns]);

  // Calculate pagination values - limit to maxResults for display
  const displayResults = currentResults.slice(0, localDisplayOptions.maxResults || 50);
  const totalPages = Math.ceil(displayResults.length / resultsPerPage);
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentPageResults = displayResults.slice(startIndex, endIndex);

  // Update column widths when results or visible columns change
  useEffect(() => {
    if (currentResults.length > 0) {
      const newWidths = calculateColumnWidths(currentResults);
      setColumnWidths(newWidths);
    }
  }, [currentResults, calculateColumnWidths]);

  // Handle result selection with single click, Ctrl+click, and Shift+click
  const handleResultClick = (e: React.MouseEvent, accession: string, index: number) => {
    // Don't handle if clicking on interactive elements (buttons, links, etc.)
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    
    e.stopPropagation();
    
    const isCtrlClick = e.ctrlKey || e.metaKey;
    const isShiftClick = e.shiftKey;
    
    setSelectedResults(prev => {
      const newSelected = new Set(prev);
      
      if (isShiftClick && lastSelectedIndex !== null) {
        // Range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const resultsToSelect = currentPageResults.slice(start, end + 1);
        resultsToSelect.forEach(result => newSelected.add(result.accession));
      } else if (isCtrlClick) {
        // Multi-select: toggle this item
        if (newSelected.has(accession)) {
          newSelected.delete(accession);
        } else {
          newSelected.add(accession);
        }
        setLastSelectedIndex(index);
      } else {
        // Single click: toggle this item (select if not selected, deselect if selected)
        if (newSelected.has(accession)) {
          newSelected.delete(accession);
        } else {
          newSelected.clear();
          newSelected.add(accession);
        }
        setLastSelectedIndex(index);
      }
      
      return newSelected;
    });
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, accession: string) => {
    e.stopPropagation();
    
    // Determine which results to drag
    const resultsToDrag = selectedResults.has(accession) ? selectedResults : new Set([accession]);
    
    // Set drag data
    const selectedResultObjects = currentResults.filter(result => 
      resultsToDrag.has(result.accession)
    );
    
    if (selectedResultObjects.length > 0) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'sec_filings',
        filings: selectedResultObjects
      }));
      
      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${selectedResultObjects.length} filing${selectedResultObjects.length > 1 ? 's' : ''}`;
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
  const handleRowContextMenu = (e: React.MouseEvent, accession: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this result is not selected, select only it
    if (!selectedResults.has(accession)) {
      setSelectedResults(new Set([accession]));
    }
    
    setContextMenuAnchor(e.currentTarget as HTMLElement);
  };


  const handleRemove = () => {
    onRemove(id);
  };

  // Context menu handlers
  const handleContextMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenuAnchor(event.currentTarget);
  };

  const handleContextMenuClose = () => {
    setContextMenuAnchor(null);
  };

  const handleAddToFiles = () => {
    if (selectedResults.size === 0 || !user) return;
    setFileBrowserOpen(true);
    handleContextMenuClose();
  };

  const handleFileBrowserSelect = async (folderPath: string) => {
    if (!user || selectedResults.size === 0) return;
    
    try {
      const selectedResultObjects = currentResults.filter(result => 
        selectedResults.has(result.accession)
      );

      // Save all filings to the filesystem with FULL data using bulk operation
      // Note: currentResults contains the full filing objects from the search API
      // This ensures we save the complete filing with all fields
      const items = selectedResultObjects.map(filing => {
        const title = filing.filingEntity 
          ? `SEC Filing - ${filing.filingEntity}${filing.form ? ` (${filing.form})` : ''}`
          : `SEC Filing ${filing.accession || ''}`;
        return {
          context_data: filing, // Full filing object with all fields
          title: title,
          item_type: 'sec_filing' as const,
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
        console.log(`✅ Saved ${result?.succeeded || selectedResultObjects.length} of ${selectedResultObjects.length} filing(s) to filesystem`);
        if (result?.errors && result.errors.length > 0) {
          console.warn(`⚠️ ${result.errors.length} filing(s) failed to save:`, result.errors);
        }
      } else {
        throw new Error(response.error || 'Failed to save filings');
      }
      setSelectedResults(new Set());
    } catch (error) {
      console.error('Error saving filings to filesystem:', error);
    }
  };

  const handleAddToContext = () => {
    const selectedResultObjects = currentResults.filter(result => 
      selectedResults.has(result.accession)
    );

    if (selectedResultObjects.length === 0) return;

    // Use the same context manager functions as the parent page
    // For single filing, use the same format as parent page: "Form - Entity"
    // For multiple filings, each gets its own context item with proper formatting
    if (selectedResultObjects.length === 1) {
      addFilingToContext(selectedResultObjects[0]);
    } else {
      addMultipleFilingsToContext(selectedResultObjects);
    }

    setSelectedResults(new Set());
    handleContextMenuClose();
  };

  // Filer search handler (no API calls in demo mode)
  const handleFilerSearch = (query: string): string[] => {
    if (query.length < 2) return companySuggestions.map(s => s.name);
    if (isDemo) return companySuggestions.map(s => s.name); // No autocomplete API in demo
    // Trigger async autocomplete search
    const searchAsync = async () => {
      setAutocompleteLoading(true);
      try {
        const response = await secSearchAPI.getAutocomplete(query);
        if (response.suggestions) {
          setCompanySuggestions(response.suggestions.slice(0, 20));
        }
      } catch (error) {
        console.error('Failed to load company suggestions:', error);
      } finally {
        setAutocompleteLoading(false);
      }
    };
    searchAsync();
    return companySuggestions.map(s => s.name);
  };

  const renderSearchDialog = () => (
    <Dialog
      open={searchDialogOpen}
      onClose={() => setSearchDialogOpen(false)}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          border: '1px solid #374151',
        }
      }}
    >
      <DialogTitle sx={{ 
        color: '#ffffff', 
        borderBottom: '1px solid #374151',
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
        <DocumentIcon sx={{ color: '#3b82f6' }} />
        SEC Search Parameters
      </DialogTitle>
      <DialogContent sx={{ p: 3 }}>
        <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
          Configure your SEC filing search parameters. These will be applied when you click Search.
        </Typography>
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
          {/* Row 1: Filers and Keywords */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <MultiSelectField<string>
              label="Filers (Companies/Individuals)"
              selectedItems={(() => {
                // Use persisted filers if available, otherwise fall back to entityName from searchParams
                if (persistedFilers.length > 0) {
                  return persistedFilers.map(f => f.name);
                }
                const entityNames = Array.isArray(currentSearchParams.entityName) 
                  ? currentSearchParams.entityName 
                  : (currentSearchParams.entityName ? [currentSearchParams.entityName] : []);
                return entityNames;
              })()}
              onItemsChange={(entityNames) => {
                // Find full filer information from suggestions or persisted filers
                const filers: SECAutocompleteSuggestion[] = [];
                const ciks: string[] = [];
                
                entityNames.forEach(name => {
                  // First try to find in current suggestions
                  let suggestion = companySuggestions.find(s => s.name === name);
                  // If not found, try persisted filers
                  if (!suggestion) {
                    suggestion = persistedFilers.find(f => f.name === name);
                  }
                  
                  if (suggestion) {
                    filers.push(suggestion);
                    if (suggestion.cik) {
                      ciks.push(suggestion.cik);
                    }
                  } else {
                    // Fallback: create a basic suggestion with just the name
                    filers.push({ name, cik: '', ticker: '' });
                  }
                });
                
                // Update persisted filers
                setPersistedFilers(filers);
                
                // Update search params
                setCurrentSearchParams(prev => ({ 
                  ...prev, 
                  entityName: entityNames.length > 0 ? entityNames : undefined,
                  cik: ciks.length === 1 ? ciks[0] : (ciks.length > 1 ? ciks : prev.cik),
                }));
                
                // Persist filers to backend
                onSettingsChange(id, { filers });
              }}
              suggestions={companySuggestions.map(s => s.name)}
              renderItem={(name) => {
                // Try to find in persisted filers first, then suggestions
                let suggestion = persistedFilers.find(f => f.name === name);
                if (!suggestion) {
                  suggestion = companySuggestions.find(s => s.name === name);
                }
                if (suggestion && suggestion.cik) {
                  return `${suggestion.name} (${suggestion.ticker || 'N/A'}) - CIK: ${suggestion.cik}`;
                }
                return name;
              }}
              getItemKey={(name) => name}
              placeholder="Add company, CIK, or individual name..."
              helperText="Select filers to search for"
              allowCustomInput={false}
              isLoading={autocompleteLoading}
              onSearch={handleFilerSearch}
            />

            {/* Keywords - Hidden in easy mode */}
            {!isEasyMode && (
            <MultiSelectField<string>
              label="Keywords"
              selectedItems={(() => {
                const keywords = Array.isArray(currentSearchParams.keywords)
                  ? currentSearchParams.keywords
                  : (currentSearchParams.keywords ? [currentSearchParams.keywords] : []);
                return keywords;
              })()}
              onItemsChange={(keywords) => {
                setCurrentSearchParams(prev => ({ 
                  ...prev, 
                  keywords: keywords.length > 0 ? keywords : undefined,
                }));
              }}
              suggestions={[]}
              renderItem={(keyword) => keyword}
              getItemKey={(keyword) => keyword}
              placeholder="Type keyword and press Enter to add..."
              helperText="Add keywords for search"
              allowCustomInput={true}
              isLoading={false}
              disableAutocomplete={true}
            />
            )}
          </Box>

          {/* Row 2: Date Range - Filed from and Filed to */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              label="Filed from"
              type="date"
              value={currentSearchParams.dateFrom || ''}
              onChange={(e) => setCurrentSearchParams(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
              InputLabelProps={{ shrink: true }}
              sx={{
                '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />

            <TextField
              label="Filed to"
              type="date"
              value={currentSearchParams.dateTo || ''}
              onChange={(e) => setCurrentSearchParams(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
              InputLabelProps={{ shrink: true }}
              sx={{
                '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                '& .MuiInputLabel-root': { color: '#94a3b8' },
              }}
            />
          </Box>

          {/* Row 3: Form Types and Location - Hidden in easy mode */}
          {!isEasyMode && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            {/* Form Types - Button to open modal (like SEC page) */}
            <Box>
              <TextField
                label="Filing category"
                value={
                  currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0
                    ? `${currentSearchParams.formTypes.length} form${currentSearchParams.formTypes.length > 1 ? 's' : ''} selected`
                    : 'View all'
                }
                onClick={() => setFormTypesModalOpen(true)}
                InputProps={{
                  readOnly: true,
                  endAdornment: <ExpandMoreIcon sx={{ color: '#9ca3af' }} />,
                }}
                variant="outlined"
                sx={{
                  cursor: 'pointer',
                  '& .MuiOutlinedInput-root': { backgroundColor: '#334155', color: '#ffffff' },
                  '& .MuiInputLabel-root': { color: '#94a3b8' },
                }}
              />
              {currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {currentSearchParams.formTypes.slice(0, 3).map((formType) => (
                    <Chip
                      key={formType}
                      label={formType}
                      size="small"
                      onDelete={() => {
                        setCurrentSearchParams(prev => ({
                          ...prev,
                          formTypes: prev.formTypes?.filter(ft => ft !== formType)
                        }));
                      }}
                      sx={{
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        color: '#93c5fd',
                        border: '1px solid #3b82f6',
                        '& .MuiChip-deleteIcon': { color: '#93c5fd' },
                      }}
                    />
                  ))}
                  {currentSearchParams.formTypes.length > 3 && (
                    <Chip
                      label={`+${currentSearchParams.formTypes.length - 3} more`}
                      size="small"
                      onClick={() => setShowAllFormTypesDialog(true)}
                      sx={{
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        color: '#93c5fd',
                        border: '1px solid #3b82f6',
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        },
                      }}
                    />
                  )}
                </Box>
              )}
            </Box>

            {/* Location */}
            <FormControl variant="outlined">
              <InputLabel sx={{ color: '#94a3b8' }}>Located</InputLabel>
              <Select
                value={currentSearchParams.located || 'all'}
                onChange={(e) => {
                  const value = e.target.value;
                  setCurrentSearchParams(prev => ({ 
                    ...prev, 
                    located: value === 'all' ? undefined : value 
                  }));
                }}
                label="Located"
                sx={{
                  backgroundColor: '#334155', 
                  color: '#ffffff',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
                }}
              >
                <MenuItem value="all">All locations</MenuItem>
                <MenuItem value="AL">Alabama</MenuItem>
                <MenuItem value="AK">Alaska</MenuItem>
                <MenuItem value="AZ">Arizona</MenuItem>
                <MenuItem value="AR">Arkansas</MenuItem>
                <MenuItem value="CA">California</MenuItem>
                <MenuItem value="CO">Colorado</MenuItem>
                <MenuItem value="CT">Connecticut</MenuItem>
                <MenuItem value="DE">Delaware</MenuItem>
                <MenuItem value="FL">Florida</MenuItem>
                <MenuItem value="GA">Georgia</MenuItem>
              </Select>
            </FormControl>
          </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #334155', p: 3 }}>
        <Button
          onClick={() => setSearchDialogOpen(false)}
          sx={{ color: '#94a3b8' }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            // Clear client-side filters when performing a new search (matching SECSearchPage behavior)
            setSelectedFilters({
              entities: [],
              forms: [],
              locations: [],
              incorporationStates: [],
            });
            // Persist search params before performing search
            onSettingsChange(id, { searchParams: currentSearchParams, filers: persistedFilers });
            performSearch();
            setSearchDialogOpen(false);
          }}
          variant="contained"
          startIcon={<SearchIcon />}
          sx={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            '&:hover': { background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)' },
          }}
        >
          Search
        </Button>
      </DialogActions>
    </Dialog>
  );

  const renderFilterDialog = () => (
    <Dialog
      open={filterDialogOpen}
      onClose={() => setFilterDialogOpen(false)}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          color: '#ffffff',
          border: '1px solid #334155',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #334155' }}>
        <Box display="flex" alignItems="center" gap={1}>
          <FilterIcon />
          <Typography variant="h6">Filter Results</Typography>
          <Chip
            label={`${currentResults.length} of ${allResults.length} results`}
            size="small"
            sx={{
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              ml: 1
            }}
          />
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 3 }}>
        <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
          Refine search results by: Click headings to show top filters. Document counts shown in <span style={{ color: '#3b82f6' }}>#</span>
        </Typography>


        {/* Page Size Selection */}
        <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
          <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
            Results Per Page:
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControl sx={{ minWidth: 120 }}>
              <TextField
                select
                value={resultsPerPage}
                onChange={(e) => {
                  const newSize = parseInt(e.target.value);
                  setResultsPerPage(newSize);
                  setCurrentPage(1); // Reset to first page when changing page size
                  localStorage.setItem(`secSearch_pageSize_${id}`, newSize.toString());
                }}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: '#475569',
                    color: '#ffffff',
                    '& fieldset': {
                      borderColor: '#64748b',
                    },
                    '&:hover fieldset': {
                      borderColor: '#3b82f6',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#3b82f6',
                    },
                  },
                  '& .MuiSelect-select': {
                    color: '#ffffff',
                  },
                  '& .MuiSelect-icon': {
                    color: '#94a3b8',
                  },
                  '& .MuiInputLabel-root': {
                    color: '#94a3b8',
                  },
                }}
                SelectProps={{
                  MenuProps: {
                    PaperProps: {
                      sx: {
                        backgroundColor: '#334155',
                        '& .MuiMenuItem-root': {
                          color: '#ffffff',
                          '&:hover': {
                            backgroundColor: '#475569',
                          },
                          '&.Mui-selected': {
                            backgroundColor: '#3b82f6',
                            '&:hover': {
                              backgroundColor: '#2563eb',
                            },
                          },
                        },
                      },
                    },
                  },
                }}
              >
                {[5, 10, 25, 50, 100].map((size) => (
                  <MenuItem key={size} value={size}>
                    {size} results
                  </MenuItem>
                ))}
              </TextField>
            </FormControl>
          </Box>
        </Box>

        {/* Applied Filters Section */}
        {(selectedFilters.entities.length > 0 || 
          selectedFilters.forms.length > 0 || 
          selectedFilters.locations.length > 0 || 
          selectedFilters.incorporationStates.length > 0) && (
          <Box sx={{ mb: 3, p: 2, backgroundColor: '#334155', borderRadius: '4px', border: '1px solid #475569' }}>
            <Typography variant="subtitle2" sx={{ color: '#e2e8f0', mb: 2, fontWeight: 600 }}>
              Applied Filters:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {selectedFilters.entities.map((entity, idx) => {
                const entityLabel = entity.cik 
                  ? `${entity.entity} (CIK ${entity.cik.padStart(10, '0')})`
                  : entity.entity;
                return (
                  <Chip
                    key={`entity-${idx}`}
                    label={`Entity: ${entityLabel}`}
                    onDelete={() => {
                      setSelectedFilters(prev => ({
                        ...prev,
                        entities: prev.entities.filter((_, i) => i !== idx)
                      }));
                    }}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      color: '#3b82f6',
                      border: '1px solid #3b82f6',
                      '& .MuiChip-deleteIcon': { color: '#3b82f6' }
                    }}
                  />
                );
              })}
              {selectedFilters.forms.map(form => (
                <Chip
                  key={`form-${form}`}
                  label={`Form: ${form}`}
                  onDelete={() => {
                    setSelectedFilters(prev => ({
                      ...prev,
                      forms: prev.forms.filter(f => f !== form)
                    }));
                  }}
                  size="small"
                  sx={{
                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                    color: '#22c55e',
                    border: '1px solid #22c55e',
                    '& .MuiChip-deleteIcon': { color: '#22c55e' }
                  }}
                />
              ))}
              {selectedFilters.locations.map(location => (
                <Chip
                  key={`location-${location}`}
                  label={`Location: ${location}`}
                  onDelete={() => {
                    setSelectedFilters(prev => ({
                      ...prev,
                      locations: prev.locations.filter(l => l !== location)
                    }));
                  }}
                  size="small"
                  sx={{
                    backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    color: '#a855f7',
                    border: '1px solid #a855f7',
                    '& .MuiChip-deleteIcon': { color: '#a855f7' }
                  }}
                />
              ))}
              {selectedFilters.incorporationStates.map(state => (
                <Chip
                  key={`state-${state}`}
                  label={`State: ${state}`}
                  onDelete={() => {
                    setSelectedFilters(prev => ({
                      ...prev,
                      incorporationStates: prev.incorporationStates.filter(s => s !== state)
                    }));
                  }}
                  size="small"
                  sx={{
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    color: '#f59e0b',
                    border: '1px solid #f59e0b',
                    '& .MuiChip-deleteIcon': { color: '#f59e0b' }
                  }}
                />
              ))}
            </Box>
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setSelectedFilters({
                    entities: [],
                    forms: [],
                    locations: [],
                    incorporationStates: []
                  });
                }}
                sx={{
                  color: '#94a3b8',
                  borderColor: '#475569',
                  '&:hover': {
                    borderColor: '#64748b',
                    backgroundColor: 'rgba(71, 85, 105, 0.1)'
                  }
                }}
              >
                Clear All Filters
              </Button>
            </Box>
          </Box>
        )}

        {/* Filter Sections */}
        {availableFilters.entity_filters?.length === 0 && 
         availableFilters.form_filters?.length === 0 && 
         availableFilters.location_filters?.length === 0 && 
         availableFilters.incorporation_filters?.length === 0 ? (
          <Box 
            sx={{ 
              textAlign: 'center', 
              py: 6, 
              backgroundColor: '#334155', 
              borderRadius: '4px',
              border: '1px solid #475569'
            }}
          >
            <Typography variant="h6" sx={{ color: '#cbd5e1', mb: 2, fontWeight: 500 }}>
              No Filters Available
            </Typography>
            <Typography variant="body2" sx={{ color: '#94a3b8' }}>
              {allResults.length === 0 
                ? 'No search results found. Try adjusting your search criteria.'
                : 'All results are identical - no additional filters can be applied.'
              }
            </Typography>
          </Box>
        ) : (
          <Box 
            display="flex" 
            flexDirection="column" 
            gap={2}
            sx={{
              '& .MuiAccordion-root': {
                backgroundColor: '#334155',
                border: '1px solid #475569',
                borderRadius: '4px',
                boxShadow: 'none',
                '&:before': {
                  display: 'none',
                },
                '&.Mui-expanded': {
                  margin: '8px 0',
                },
                '&:not(:last-child)': {
                  marginBottom: '8px',
                },
              },
              '& .MuiAccordionSummary-root': {
                backgroundColor: '#475569',
                borderRadius: '4px 4px 0 0',
                minHeight: '56px',
                '&.Mui-expanded': {
                  minHeight: '56px',
                  borderRadius: '4px 4px 0 0',
                },
                '&:hover': {
                  backgroundColor: '#64748b',
                },
              },
              '& .MuiAccordionDetails-root': {
                padding: '16px',
                backgroundColor: '#334155',
                borderRadius: '0 0 4px 4px',
                borderTop: '1px solid #475569',
              },
              '& .MuiAccordionSummary-content': {
                margin: '12px 0',
              },
              '& .MuiAccordionSummary-expandIconWrapper': {
                color: '#e2e8f0',
                '&.Mui-expanded': {
                  transform: 'rotate(180deg)',
                },
              },
            }}
          >
            {/* Entities Filter */}
            {availableFilters.entity_filters && availableFilters.entity_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Entities ({availableFilters.entity_filters.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '6px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#475569',
                        borderRadius: '3px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '3px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.entity_filters.map((filter, idx) => {
                      // Check if this entity is selected - match SECSearchPage logic
                      const match = filter.entity.match(/^(.+?)\s*\(CIK\s+(\d+)\)$/);
                      let entityObj: { entity: string; cik?: string };
                      if (match) {
                        const [, name, cik] = match;
                        entityObj = { entity: name.trim(), cik: cik };
                      } else {
                        entityObj = { entity: filter.entity.trim() };
                      }
                      
                      const isSelected = selectedFilters.entities.some(
                        e => e.entity === entityObj.entity && 
                             (entityObj.cik ? e.cik === entityObj.cik : !e.cik)
                      );
                      
                      return (
                        <Box
                          key={idx}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters((prev: typeof selectedFilters) => {
                              const exists = prev.entities.some(
                                e => e.entity === entityObj.entity && 
                                     (entityObj.cik ? e.cik === entityObj.cik : !e.cik)
                              );
                              if (exists) {
                                // Remove if already selected
                                return {
                                  ...prev,
                                  entities: prev.entities.filter(
                                    e => !(e.entity === entityObj.entity && 
                                          (entityObj.cik ? e.cik === entityObj.cik : !e.cik))
                                  ),
                                };
                              } else {
                                // Add if not selected
                                return {
                                  ...prev,
                                  entities: [...prev.entities, entityObj],
                                };
                              }
                            });
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.entity}
                          </Typography>
                          <Chip
                            label={filter.count}
                            size="small"
                            sx={{
                              backgroundColor: '#3b82f6',
                              color: '#ffffff',
                              minWidth: '28px',
                              height: '22px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              '& .MuiChip-label': {
                                px: 0.75,
                              },
                            }}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Forms Filter */}
            {availableFilters.form_filters && availableFilters.form_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Form Types ({availableFilters.form_filters.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '6px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#475569',
                        borderRadius: '3px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '3px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.form_filters.map((filter) => {
                      const isSelected = selectedFilters.forms.includes(filter.form);
                      return (
                        <Box
                          key={filter.form}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters(prev => ({
                              ...prev,
                              forms: isSelected
                                ? prev.forms.filter(f => f !== filter.form)
                                : [...prev.forms, filter.form]
                            }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.form}
                          </Typography>
                          <Chip
                            label={filter.count}
                            size="small"
                            sx={{
                              backgroundColor: '#3b82f6',
                              color: '#ffffff',
                              minWidth: '28px',
                              height: '22px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              '& .MuiChip-label': {
                                px: 0.75,
                              },
                            }}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Locations Filter */}
            {availableFilters.location_filters && availableFilters.location_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Locations ({availableFilters.location_filters.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '6px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#475569',
                        borderRadius: '3px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '3px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.location_filters.map((filter) => {
                      const isSelected = selectedFilters.locations.includes(filter.location);
                      return (
                        <Box
                          key={filter.location}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters(prev => ({
                              ...prev,
                              locations: isSelected
                                ? prev.locations.filter(l => l !== filter.location)
                                : [...prev.locations, filter.location]
                            }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.location}
                          </Typography>
                          <Chip
                            label={filter.count}
                            size="small"
                            sx={{
                              backgroundColor: '#3b82f6',
                              color: '#ffffff',
                              minWidth: '28px',
                              height: '22px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              '& .MuiChip-label': {
                                px: 0.75,
                              },
                            }}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {/* Incorporation States Filter */}
            {availableFilters.incorporation_filters && availableFilters.incorporation_filters.length > 0 && (
              <Accordion>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}
                  sx={{ cursor: 'pointer' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.95rem' }}>
                    Incorporation States ({availableFilters.incorporation_filters.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box 
                    sx={{ 
                      maxHeight: '200px', 
                      overflowY: 'auto',
                      '&::-webkit-scrollbar': {
                        width: '6px',
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: '#475569',
                        borderRadius: '3px',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#3b82f6',
                        borderRadius: '3px',
                        '&:hover': {
                          backgroundColor: '#2563eb',
                        },
                      },
                    }}
                  >
                    {availableFilters.incorporation_filters.map((filter) => {
                      const isSelected = selectedFilters.incorporationStates.includes(filter.incorporation);
                      return (
                        <Box
                          key={filter.incorporation}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isSelected
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(71, 85, 105, 0.5)' },
                            transition: 'background-color 0.15s ease',
                          }}
                          onClick={() => {
                            setSelectedFilters(prev => ({
                              ...prev,
                              incorporationStates: isSelected
                                ? prev.incorporationStates.filter(s => s !== filter.incorporation)
                                : [...prev.incorporationStates, filter.incorporation]
                            }));
                          }}
                        >
                          <Typography variant="body2" sx={{ color: '#e2e8f0', flex: 1, fontSize: '0.875rem' }}>
                            {filter.incorporation}
                          </Typography>
                          <Chip
                            label={filter.count}
                            size="small"
                            sx={{
                              backgroundColor: '#3b82f6',
                              color: '#ffffff',
                              minWidth: '28px',
                              height: '22px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              '& .MuiChip-label': {
                                px: 0.75,
                              },
                            }}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #334155', p: 3, gap: 1 }}>
        <Button
          onClick={() => {
            setSelectedFilters({
              entities: [],
              forms: [],
              locations: [],
              incorporationStates: []
            });
          }}
          disabled={
            selectedFilters.entities.length === 0 && 
            selectedFilters.forms.length === 0 && 
            selectedFilters.locations.length === 0 && 
            selectedFilters.incorporationStates.length === 0
          }
          sx={{ 
            color: '#94a3b8',
            '&:hover': {
              backgroundColor: 'rgba(148, 163, 184, 0.1)',
            },
            '&.Mui-disabled': {
              color: '#64748b',
            },
          }}
        >
          Clear All
        </Button>
        <Button
          onClick={() => setFilterDialogOpen(false)}
          sx={{ color: '#94a3b8' }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Form type handlers
  const handleFormTypeToggle = (formType: string) => {
    setCurrentSearchParams(prev => {
      const currentFormTypes = prev.formTypes || [];
      const isSelected = currentFormTypes.includes(formType);
      
      if (isSelected) {
        return {
          ...prev,
          formTypes: currentFormTypes.filter(ft => ft !== formType)
        };
      } else {
        return {
          ...prev,
          formTypes: [...currentFormTypes, formType]
        };
      }
    });
  };

  const filteredFormTypes = selectedCategoryFilter === 'all' 
    ? ALL_FORM_TYPES 
    : ALL_FORM_TYPES.filter(formType => {
        const category = SEC_FORM_CATEGORIES.find(cat => cat.id === selectedCategoryFilter);
        return category?.formTypes.includes(formType.id) || false;
      });

  const areAllFilteredFormsSelected = filteredFormTypes.length > 0 && 
    filteredFormTypes.every(form => (currentSearchParams.formTypes || []).includes(form.id));

  const handleSelectAllForms = (checked: boolean) => {
    if (checked) {
      const allFilteredFormIds = filteredFormTypes.map(form => form.id);
      setCurrentSearchParams(prev => ({
        ...prev,
        formTypes: Array.from(new Set([...(prev.formTypes || []), ...allFilteredFormIds]))
      }));
    } else {
      const filteredFormIds = new Set(filteredFormTypes.map(form => form.id));
      setCurrentSearchParams(prev => ({
        ...prev,
        formTypes: (prev.formTypes || []).filter(ft => !filteredFormIds.has(ft))
      }));
    }
  };

  const renderFormTypesModal = () => (
    <Dialog
      open={formTypesModalOpen}
      onClose={() => setFormTypesModalOpen(false)}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1e293b',
          color: '#ffffff',
          border: '1px solid #374151',
        },
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderBottom: '1px solid #374151',
        pb: 2,
      }}>
        <Box>
          <Typography variant="h6" sx={{ color: '#ffffff', mb: 1 }}>
            Check forms that you want to search
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3b8' }}>
            Use the category select to narrow the choices.
          </Typography>
        </Box>
        <IconButton
          onClick={() => setFormTypesModalOpen(false)}
          sx={{ color: '#9ca3b8', '&:hover': { color: '#ffffff' } }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ mt: 2 }}>
        {/* Category Filter Dropdown */}
        <Box sx={{ mb: 3 }}>
          <FormControl 
            variant="outlined" 
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: '#374151' },
                '&:hover fieldset': { borderColor: '#3b82f6' },
                '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
              },
              '& .MuiInputLabel-root': { color: '#9ca3b8' },
              '& .MuiSelect-select': { color: '#ffffff' },
            }}
          >
            <InputLabel>Category Filter</InputLabel>
            <Select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              label="Category Filter"
            >
              {SEC_FORM_CATEGORIES.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* Check All/Uncheck All */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={areAllFilteredFormsSelected}
                indeterminate={
                  !areAllFilteredFormsSelected &&
                  filteredFormTypes.some(form => (currentSearchParams.formTypes || []).includes(form.id))
                }
                onChange={(e) => handleSelectAllForms(e.target.checked)}
                sx={{
                  color: '#9ca3b8',
                  '&.Mui-checked': { color: '#3b82f6' },
                }}
              />
            }
            label="Check/uncheck all forms"
            sx={{ color: '#9ca3b8' }}
          />
        </Box>

        {/* Form Types Checkboxes */}
        <Box
          sx={{
            maxHeight: '400px',
            overflowY: 'auto',
            border: '1px solid #374151',
            borderRadius: '4px',
            p: 2,
          }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1 }}>
            {filteredFormTypes.map((formType) => {
              const isSelected = (currentSearchParams.formTypes || []).includes(formType.id);
              return (
                <FormControlLabel
                  key={formType.id}
                  control={
                    <Checkbox
                      checked={isSelected}
                      onChange={() => handleFormTypeToggle(formType.id)}
                      sx={{
                        color: '#9ca3b8',
                        '&.Mui-checked': { color: '#3b82f6' },
                      }}
                    />
                  }
                  label={formType.label}
                  sx={{ 
                    color: '#9ca3b8',
                    '& .MuiFormControlLabel-label': { fontSize: '0.875rem' },
                  }}
                />
              );
            })}
          </Box>
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ borderTop: '1px solid #334155', p: 3 }}>
        <Button
          onClick={() => setFormTypesModalOpen(false)}
          sx={{ color: '#94a3b8' }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );

  // Context Menu
  const tileColor = customColor || '#3b82f6';
  
  return (
    <Box
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
          background: currentResults.length > 0 ? tileColor : '#dc2626',
        },
      }}
      ref={tileRef}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Header with controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onSelectionChange && (
            <Checkbox
              checked={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                const currentTime = Date.now();
                if (currentTime - lastClickTimeRef.current < 300) {
                  // Double click detected, ignore
                  return;
                }
                lastClickTimeRef.current = currentTime;
                onSelectionChange(!isSelected);
              }}
              sx={{ color: '#9ca3b8', '&.Mui-checked': { color: '#3b82f6' }, p: 0.5 }}
              size="small"
            />
          )}
          
          {(() => {
            const TileIcon = getIconByName(customIcon, getDefaultIconForTileType('sec_search'));
            const iconColor = customColor || '#3b82f6';
            const displayTitle = customTitle || 'SEC Search';
            return (
              <>
                <TileIcon sx={{ color: iconColor, fontSize: '1.5rem' }} />
                <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '1.1rem' }}>
                  {displayTitle}
                </Typography>
              </>
            );
          })()}
          
          {isLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1 }}>
              <CircularProgress size={16} sx={{ color: '#3b82f6' }} />
              {fetchProgress && (
                <Typography variant="caption" sx={{ color: '#3b82f6', fontWeight: 500 }}>
                  {fetchProgress.totalPages 
                    ? `Fetching page ${fetchProgress.currentPage} of ${fetchProgress.totalPages}`
                    : `Fetching page ${fetchProgress.currentPage}`}
                </Typography>
              )}
              {/* Stop Search Button - shown next to progress */}
              <Tooltip title="Stop Search" arrow>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStopSearch();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{
                    color: '#ef4444',
                    border: '1px solid #ef4444',
                    padding: '4px',
                    '&:hover': { 
                      color: '#dc2626', 
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      borderColor: '#dc2626',
                    },
                  }}
                >
                  <StopIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
          
          {!isLoading && (
            <Typography variant="caption" sx={{ color: '#9ca3b8', ml: 1 }}>
              {allResults.length > 0 && currentResults.length !== allResults.length 
                ? `${currentResults.length} of ${allResults.length} results`
                : `${allResults.length} results`}
            </Typography>
          )}
        </Box>

        <TileHeaderActions
          pinButton={{
            isPinned: pinnedState,
            onTogglePin: togglePin,
          }}
          contextButton={{
            onClick: handleContextMenuClick,
            disabled: selectedResults.size === 0,
            tooltip: `Add ${selectedResults.size > 0 ? `${selectedResults.size} filing(s)` : 'selected filings'} to context`,
            icon: <AddToContextIcon fontSize="small" />,
          }}
          customizeButton={{
            onClick: (e) => {
              e.stopPropagation();
              setCustomizeDialogOpen(true);
            },
          }}
          refreshButton={{
            onClick: (e) => {
              e.stopPropagation();
              performSearch();
            },
            disabled: isLoading,
            isLoading: isLoading,
            icon: isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />,
          }}
          deleteButton={{
            onClick: handleRemove,
            icon: <CloseIcon sx={{ fontSize: 18 }} />,
          }}
          collapsibleActions={
            <>
              {/* Refresh Button - shown when expanded */}
              <Tooltip title="Refresh" arrow>
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      performSearch();
                    }}
                    disabled={isLoading}
                    onMouseDown={(e) => e.stopPropagation()}
                    sx={{
                      color: isLoading ? '#6b7280' : '#9ca3af',
                      '&:hover': { color: isLoading ? '#6b7280' : '#3b82f6' },
                      '&.Mui-disabled': { color: '#6b7280' },
                      padding: '6px',
                    }}
                  >
                    {isLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Select columns to display">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColumnMenuAnchor(e.currentTarget);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: '#9ca3af', '&:hover': { color: '#3b82f6' } }}
                >
                  <ViewColumnIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="Filter Results" arrow>
                <IconButton
                  onClick={() => setFilterDialogOpen(true)}
                  sx={{
                    color: '#9ca3b8',
                    '&:hover': { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                    padding: '6px',
                  }}
                  size="small"
                >
                  <FilterIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="Edit Search Criteria" arrow>
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchDialogOpen(true);
                  }}
                  disabled={isLoading}
                  sx={{
                    color: isLoading ? '#6b7280' : '#9ca3b8',
                    '&:hover': { color: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                    padding: '6px',
                  }}
                  size="small"
                >
                  <SearchIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
        />
      </Box>

      {/* Results Table */}
      {error && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
          {error}
        </Alert>
      )}

      <Box sx={{ 
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        mt: 1 // Small top margin
      }}>
        {/* No Results / No Search */}
        {!isLoading && currentResults.length === 0 && !error && (
          <Box 
            sx={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 6,
              px: 3,
              flexShrink: 0,
              minHeight: '200px',
            }}
          >
            {(() => {
              // Check if there's any search criteria
              const hasSearchCriteria = 
                (currentSearchParams.cik && (Array.isArray(currentSearchParams.cik) ? currentSearchParams.cik.length > 0 : currentSearchParams.cik.trim() !== '')) ||
                (Array.isArray(currentSearchParams.entityName) && currentSearchParams.entityName.length > 0 && currentSearchParams.entityName.some(name => name && name.trim() !== '')) ||
                (!Array.isArray(currentSearchParams.entityName) && currentSearchParams.entityName && currentSearchParams.entityName.trim() !== '') ||
                (Array.isArray(currentSearchParams.keywords) && currentSearchParams.keywords.length > 0 && currentSearchParams.keywords.some(kw => kw && kw.trim() !== '')) ||
                (!Array.isArray(currentSearchParams.keywords) && currentSearchParams.keywords && currentSearchParams.keywords.trim() !== '') ||
                (currentSearchParams.formTypes && currentSearchParams.formTypes.length > 0) ||
                (currentSearchParams.dateFrom && currentSearchParams.dateFrom.trim() !== '') ||
                (currentSearchParams.dateTo && currentSearchParams.dateTo.trim() !== '');
              
              if (!hasPerformedInitialSearch && !hasSearchCriteria) {
                return (
                  <>
                    <IconButton
                      onClick={() => setSearchDialogOpen(true)}
                      sx={{
                        color: '#3b82f6',
                        mb: 2,
                        '&:hover': {
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          transform: 'scale(1.1)',
                        },
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <SearchIcon sx={{ fontSize: '4rem' }} />
                    </IconButton>
                    <Typography variant="h6" color="#3b82f6" sx={{ fontWeight: 600, mb: 1 }}>
                      Start Your Search
                    </Typography>
                    <Typography variant="body2" color="#9ca3af" sx={{ textAlign: 'center', maxWidth: '300px' }}>
                      Click the magnifying glass above to configure your search parameters
                    </Typography>
                  </>
                );
              } else {
                return (
                  <>
                    <Typography variant="body2" color="#9ca3af" sx={{ mb: 2 }}>
                      No results found
                    </Typography>
                    <Button
                      variant="outlined"
                      startIcon={<SearchIcon />}
                      onClick={() => setSearchDialogOpen(true)}
                      sx={{
                        color: '#3b82f6',
                        borderColor: '#3b82f6',
                        '&:hover': {
                          borderColor: '#2563eb',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        },
                      }}
                    >
                      Adjust Search Parameters
                    </Button>
                  </>
                );
              }
            })()}
          </Box>
        )}
        {currentResults.length > 0 && (
        <TableContainer sx={{ 
          flex: 1,
          backgroundColor: 'transparent',
          borderRadius: 0,
          boxShadow: 'none',
          border: 'none',
          overflow: 'auto',
          '&::-webkit-scrollbar': {
            width: '6px',
            height: '6px',
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
          '&::-webkit-scrollbar-corner': {
            backgroundColor: 'rgba(55, 65, 81, 0.3)',
          },
        }}>
          <Table 
            size="small" 
            sx={{
              tableLayout: 'fixed',
              width: 'max-content',
              minWidth: '100%',
              '& .MuiTableCell-root': {
                borderBottom: '1px solid rgba(55, 65, 81, 0.3)',
                padding: '8px 12px',
                overflow: 'hidden',
                wordBreak: 'break-word',
              },
              '& .MuiTableHead-root .MuiTableCell-root': {
                borderBottom: '2px solid rgba(59, 130, 246, 0.5)',
                backgroundColor: 'rgba(15, 23, 42, 0.5)',
              },
              '& .MuiTableRow-root:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ 
                  color: '#9ca3af', 
                  fontWeight: 600, 
                  fontSize: '0.875rem',
                  width: columnWidths.checkbox || 50,
                  minWidth: columnWidths.checkbox || 50,
                  maxWidth: columnWidths.checkbox || 50,
                }}>
                  <Checkbox
                    size="small"
                    indeterminate={selectedResults.size > 0 && selectedResults.size < currentPageResults.length}
                    checked={currentPageResults.length > 0 && selectedResults.size === currentPageResults.length}
                    onChange={() => {
                      if (selectedResults.size === currentPageResults.length) {
                        // Deselect all on current page
                        const newSelected = new Set(selectedResults);
                        currentPageResults.forEach(result => newSelected.delete(result.accession));
                        setSelectedResults(newSelected);
                      } else {
                        // Select all on current page
                        const newSelected = new Set(selectedResults);
                        currentPageResults.forEach(result => newSelected.add(result.accession));
                        setSelectedResults(newSelected);
                      }
                    }}
                    sx={{ 
                      color: '#9ca3af', 
                      '&.Mui-checked': { color: '#10b981' }, 
                      '&.MuiCheckbox-indeterminate': { color: '#10b981' } 
                    }}
                  />
                </TableCell>
                {visibleColumns.entity && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.entity,
                    minWidth: columnWidths.entity,
                  }}>Entity</TableCell>
                )}
                {visibleColumns.form && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.form,
                    minWidth: columnWidths.form,
                  }}>Form</TableCell>
                )}
                {visibleColumns.filingDate && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.filingDate,
                    minWidth: columnWidths.filingDate,
                  }}>Filing Date</TableCell>
                )}
                {visibleColumns.location && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.location,
                    minWidth: columnWidths.location,
                  }}>Location</TableCell>
                )}
                {visibleColumns.incorporation && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.incorporation,
                    minWidth: columnWidths.incorporation,
                  }}>Incorporation</TableCell>
                )}
                {visibleColumns.cik && (
                  <TableCell sx={{ 
                    color: '#9ca3b8', 
                    fontWeight: 600, 
                    fontSize: '0.875rem',
                    width: columnWidths.cik,
                    minWidth: columnWidths.cik,
                  }}>CIK</TableCell>
                )}
                <TableCell sx={{ 
                  color: '#9ca3b8', 
                  fontWeight: 600, 
                  fontSize: '0.875rem',
                  width: 120,
                  minWidth: 120,
                }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentPageResults.map((result, index) => (
                <TableRow
                  key={result.accession}
                  draggable
                  onDragStart={(e) => handleDragStart(e, result.accession)}
                  onClick={(e) => handleResultClick(e, result.accession, index)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (user?.id || isDemo) {
                      openItemDetails(
                        'sec_filing',
                        result,
                        `Filing Details: ${result.form} - ${result.filingEntity}`,
                        { user_id: user?.id, constrainToDemo: isDemo }
                      );
                    }
                  }}
                  onContextMenu={(e) => handleRowContextMenu(e, result.accession)}
                  sx={{
                    backgroundColor: selectedResults.has(result.accession) ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                    cursor: 'pointer',
                    userSelect: 'none',
                    '&:hover': {
                      backgroundColor: selectedResults.has(result.accession) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.05)',
                    },
                  }}
                >
                  {/* Empty cell to maintain row height and alignment with header checkbox */}
                  <TableCell 
                    padding="none"
                    sx={{ 
                      width: '40px',
                      minWidth: '40px',
                      maxWidth: '40px',
                      padding: '8px 4px',
                    }}
                  />
                  {visibleColumns.entity && (
                    <TableCell sx={{ 
                      color: '#ffffff', 
                      fontSize: '0.875rem',
                      width: columnWidths.entity,
                      minWidth: columnWidths.entity,
                      padding: '8px 12px',
                    }}>
                      <Typography variant="body2" noWrap title={result.filingEntity}>
                        {result.filingEntity}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.form && (
                    <TableCell sx={{ 
                      fontSize: '0.875rem',
                      width: columnWidths.form,
                      minWidth: columnWidths.form,
                      padding: '8px 12px',
                    }}>
                      <Chip
                        label={result.form}
                        size="small"
                        sx={{
                          backgroundColor: '#2563eb',
                          color: '#ffffff',
                          fontSize: '0.75rem',
                        }}
                      />
                    </TableCell>
                  )}
                  {visibleColumns.filingDate && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.filingDate,
                      minWidth: columnWidths.filingDate,
                      padding: '8px 12px',
                    }}>
                      {formatDate(result.filingDate)}
                    </TableCell>
                  )}
                  {visibleColumns.location && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.location,
                      minWidth: columnWidths.location,
                      padding: '8px 12px',
                    }}>
                      <Typography variant="body2" noWrap title={result.located}>
                        {result.located || 'N/A'}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.incorporation && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.incorporation,
                      minWidth: columnWidths.incorporation,
                      padding: '8px 12px',
                    }}>
                      <Typography variant="body2" noWrap title={result.incorporated}>
                        {result.incorporated || 'N/A'}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.cik && (
                    <TableCell sx={{ 
                      color: '#9ca3b8', 
                      fontSize: '0.875rem',
                      width: columnWidths.cik,
                      minWidth: columnWidths.cik,
                      padding: '8px 12px',
                    }}>
                      {result.cik}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        )}
        
        {/* Pagination */}
        {currentResults.length > 0 && totalPages > 1 && (
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            mt: 2, 
            borderTop: '1px solid rgba(55, 65, 81, 0.3)', 
            pt: 2,
            flexShrink: 0
          }}>
            <Pagination
              count={totalPages}
              page={currentPage}
              onChange={(_, page) => setCurrentPage(page)}
              size="small"
              sx={{
                '& .MuiPaginationItem-root': {
                  color: '#9ca3b8',
                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                  '&.Mui-selected': {
                    backgroundColor: '#3b82f6',
                    color: '#ffffff',
                    '&:hover': { backgroundColor: '#2563eb' },
                  },
                },
              }}
            />
          </Box>
        )}
      </Box>

      {/* Context Menu */}
      <Menu
        anchorEl={contextMenuAnchor}
        open={Boolean(contextMenuAnchor)}
        onClose={handleContextMenuClose}
        PaperProps={{
          sx: {
            backgroundColor: '#334155',
            border: '1px solid #475569',
            '& .MuiMenuItem-root': {
              color: '#ffffff',
              '&:hover': { backgroundColor: '#475569' },
            },
          },
        }}
      >
        <MenuItem onClick={handleAddToContext} sx={{ color: '#3b82f6', fontWeight: 600 }}>
          <ListItemIcon><SidebarChatIcon sx={{ color: '#3b82f6', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to Context" />
        </MenuItem>
        <MenuItem onClick={handleAddToFiles} sx={{ fontWeight: 600 }}>
          <ListItemIcon><FolderIcon sx={{ color: '#fbbf24', mr: 1, fontSize: 18 }} /></ListItemIcon>
          <ListItemText primary="Add to Files" />
        </MenuItem>
      </Menu>

      {/* File Browser Dialog */}
      <FileBrowserDialog
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onSelect={handleFileBrowserSelect}
        allowCreateFolder={true}
      />

      {/* Column Selection Menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={() => setColumnMenuAnchor(null)}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            border: '2px solid #374151',
            color: '#ffffff',
          },
        }}
      >
        {[
          { key: 'entity', label: 'Entity' },
          { key: 'form', label: 'Form' },
          { key: 'filingDate', label: 'Filing Date' },
          { key: 'location', label: 'Location' },
          { key: 'incorporation', label: 'Incorporation' },
          { key: 'cik', label: 'CIK' },
        ].map((column) => (
          <MenuItem
            key={column.key}
            onClick={() => handleColumnToggle(column.key as keyof typeof visibleColumns)}
            sx={{
              color: visibleColumns[column.key as keyof typeof visibleColumns] ? '#3b82f6' : '#94a3b8',
            }}
          >
            <Checkbox
              checked={visibleColumns[column.key as keyof typeof visibleColumns]}
              sx={{ color: '#64748b', '&.Mui-checked': { color: '#3b82f6' } }}
            />
            {column.label}
          </MenuItem>
        ))}
      </Menu>

      {/* Dialogs */}
      {renderSearchDialog()}
      {renderFilterDialog()}
      {renderFormTypesModal()}


      {/* Dialog to show all selected form types */}
      <Dialog
        open={showAllFormTypesDialog}
        onClose={() => setShowAllFormTypesDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#1f2937',
            border: '1px solid #374151',
          },
        }}
      >
        <DialogTitle sx={{ color: '#ffffff', borderBottom: '1px solid #374151' }}>
          All Selected Form Types
          <Typography variant="body2" sx={{ color: '#9ca3af', mt: 0.5, fontWeight: 'normal' }}>
            {(currentSearchParams.formTypes || []).length} form type{(currentSearchParams.formTypes || []).length !== 1 ? 's' : ''} selected
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ 
            maxHeight: '400px', 
            overflow: 'auto', 
            p: 2,
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
          }}>
            {(currentSearchParams.formTypes || []).map((formType) => (
              <Box
                key={formType}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 1.5,
                  mb: 1,
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid #3b82f6',
                  borderRadius: 1,
                  '&:hover': {
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                  },
                }}
              >
                <Typography sx={{ color: '#ffffff' }}>{formType}</Typography>
                <IconButton
                  size="small"
                  onClick={() => {
                    setCurrentSearchParams(prev => ({
                      ...prev,
                      formTypes: (prev.formTypes || []).filter(ft => ft !== formType),
                    }));
                    if ((currentSearchParams.formTypes || []).length === 1) {
                      setShowAllFormTypesDialog(false);
                    }
                  }}
                  sx={{ color: '#ef4444' }}
                >
                  <CloseIcon />
                </IconButton>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
          <Button
            onClick={() => setShowAllFormTypesDialog(false)}
            sx={{
              color: '#9ca3af',
              '&:hover': {
                backgroundColor: 'rgba(107, 114, 128, 0.1)',
              },
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tile Customization Dialog */}
      <TileCustomizationDialog
        open={customizeDialogOpen}
        onClose={() => setCustomizeDialogOpen(false)}
        onSave={(customizations) => {
          onSettingsChange(id, customizations);
        }}
        currentTitle={customTitle || 'SEC Search'}
        currentColor={customColor}
        currentIcon={customIcon}
      />
    </Box>
  );
});

SECSearchTile.displayName = 'SECSearchTile';

export default SECSearchTile;