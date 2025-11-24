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
  Link,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Collapse,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Grid,
} from '@mui/material';
import {
  Search as SearchIcon,
  Description as DocumentIcon,
  OpenInNew as OpenInNewIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Close as CloseIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Download as DownloadIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
import { useSECSearch, useSECAutocomplete } from '../hooks/useAPI';
import { SECSearchParams, SECSearchResult, SECAutocompleteSuggestion, secSearchAPI } from '../services/api';
import { unifiedMessageHandler } from '../services/unifiedMessageHandler';
import { useAuth } from '../contexts/AuthContext';

// Custom styled components
const GlassCard = ({ children, sx = {}, ...props }: any) => {
  // Ensure sx is always an object
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

// SEC Form Categories (from SEC website)
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
    id: 'form-cat0',
    label: 'Exclude insider equity awards, transactions, and ownership (Section 16 Reports)',
    formTypes: ['-3', '-4', '-5'],
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

// SEC Form Types - comprehensive list (extracted from SEC website HTML)
// This is a subset - we'll build it dynamically from categories and add common ones
interface FormType {
  id: string;
  label: string;
  categories: string[];
  description?: string;
}

// Build comprehensive form types list from categories and SEC website data
// This includes all form types that appear in the SEC modal
const buildFormTypes = (): FormType[] => {
  const formTypeMap = new Map<string, FormType>();
  
  // Add forms from categories (these are the main ones)
  SEC_FORM_CATEGORIES.forEach(category => {
    if (category.id !== 'all' && category.id !== 'form-cat0') {
      category.formTypes.forEach(formId => {
        // Handle negative forms (exclusions) - skip them for now
        if (formId.startsWith('-')) return;
        
        if (!formTypeMap.has(formId)) {
          formTypeMap.set(formId, {
            id: formId,
            label: formId,
            categories: [category.id],
          });
        } else {
          const existing = formTypeMap.get(formId)!;
          if (!existing.categories.includes(category.id)) {
            existing.categories.push(category.id);
          }
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
        categories: [],
      });
    }
  });
  
  return Array.from(formTypeMap.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const ALL_FORM_TYPES = buildFormTypes();

// SEC Location Options (from SEC website - complete list)
const LOCATION_OPTIONS = [
  { value: 'all', label: 'View all' },
  // US States
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'X1', label: 'United States' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
  { value: 'GU', label: 'Guam' },
  { value: 'PR', label: 'Puerto Rico' },
  { value: 'VI', label: 'Virgin Islands, U.s.' },
  { value: '2J', label: 'United States Minor Outlying Islands' },
  // Canada Provinces
  { value: 'A0', label: 'Alberta, Canada' },
  { value: 'A1', label: 'British Columbia, Canada' },
  { value: 'Z4', label: 'Canada (Federal Level)' },
  { value: 'A2', label: 'Manitoba, Canada' },
  { value: 'A3', label: 'New Brunswick, Canada' },
  { value: 'A4', label: 'Newfoundland, Canada' },
  { value: 'A5', label: 'Nova Scotia, Canada' },
  { value: 'A6', label: 'Ontario, Canada' },
  { value: 'A7', label: 'Prince Edward Island, Canada' },
  { value: 'A8', label: 'Quebec, Canada' },
  { value: 'A9', label: 'Saskatchewan, Canada' },
  { value: 'B0', label: 'Yukon, Canada' },
  // Countries (major ones - can be expanded)
  { value: 'B2', label: 'Afghanistan' },
  { value: 'Y6', label: 'Aland Islands' },
  { value: 'B3', label: 'Albania' },
  { value: 'B4', label: 'Algeria' },
  { value: 'B5', label: 'American Samoa' },
  { value: 'B6', label: 'Andorra' },
  { value: 'B7', label: 'Angola' },
  { value: '1A', label: 'Anguilla' },
  { value: 'B8', label: 'Antarctica' },
  { value: 'B9', label: 'Antigua and Barbuda' },
  { value: 'C1', label: 'Argentina' },
  { value: '1B', label: 'Armenia' },
  { value: '1C', label: 'Aruba' },
  { value: 'C3', label: 'Australia' },
  { value: 'C4', label: 'Austria' },
  { value: '1D', label: 'Azerbaijan' },
  { value: 'C5', label: 'Bahamas' },
  { value: 'C6', label: 'Bahrain' },
  { value: 'C7', label: 'Bangladesh' },
  { value: 'C8', label: 'Barbados' },
  { value: '1F', label: 'Belarus' },
  { value: 'C9', label: 'Belgium' },
  { value: 'D1', label: 'Belize' },
  { value: 'G6', label: 'Benin' },
  { value: 'D0', label: 'Bermuda' },
  { value: 'D2', label: 'Bhutan' },
  { value: 'D3', label: 'Bolivia' },
  { value: '1E', label: 'Bosnia and Herzegovina' },
  { value: 'B1', label: 'Botswana' },
  { value: 'D4', label: 'Bouvet Island' },
  { value: 'D5', label: 'Brazil' },
  { value: 'D6', label: 'British Indian Ocean Territory' },
  { value: 'D9', label: 'Brunei Darussalam' },
  { value: 'E0', label: 'Bulgaria' },
  { value: 'X2', label: 'Burkina Faso' },
  { value: 'E2', label: 'Burundi' },
  { value: 'E3', label: 'Cambodia' },
  { value: 'E4', label: 'Cameroon' },
  { value: 'E8', label: 'Cape Verde' },
  { value: 'E9', label: 'Cayman Islands' },
  { value: 'F0', label: 'Central African Republic' },
  { value: 'F2', label: 'Chad' },
  { value: 'F3', label: 'Chile' },
  { value: 'F4', label: 'China' },
  { value: 'F6', label: 'Christmas Island' },
  { value: 'F7', label: 'Cocos (Keeling) Islands' },
  { value: 'F8', label: 'Colombia' },
  { value: 'F9', label: 'Comoros' },
  { value: 'G0', label: 'Congo' },
  { value: 'Y3', label: 'Congo, the Democratic Republic of the' },
  { value: 'G1', label: 'Cook Islands' },
  { value: 'G2', label: 'Costa Rica' },
  { value: 'L7', label: 'Cote D\'ivoire' },
  { value: '1M', label: 'Croatia' },
  { value: 'G3', label: 'Cuba' },
  { value: 'G4', label: 'Cyprus' },
  { value: '2N', label: 'Czech Republic' },
  { value: 'G7', label: 'Denmark' },
  { value: '1G', label: 'Djibouti' },
  { value: 'G9', label: 'Dominica' },
  { value: 'G8', label: 'Dominican Republic' },
  { value: 'H1', label: 'Ecuador' },
  { value: 'H2', label: 'Egypt' },
  { value: 'H3', label: 'El Salvador' },
  { value: 'H4', label: 'Equatorial Guinea' },
  { value: '1J', label: 'Eritrea' },
  { value: '1H', label: 'Estonia' },
  { value: 'H5', label: 'Ethiopia' },
  { value: 'H7', label: 'Falkland Islands (Malvinas)' },
  { value: 'H6', label: 'Faroe Islands' },
  { value: 'H8', label: 'Fiji' },
  { value: 'H9', label: 'Finland' },
  { value: 'I0', label: 'France' },
  { value: 'I3', label: 'French Guiana' },
  { value: 'I4', label: 'French Polynesia' },
  { value: '2C', label: 'French Southern Territories' },
  { value: 'I5', label: 'Gabon' },
  { value: 'I6', label: 'Gambia' },
  { value: '2Q', label: 'Georgia (country)' },
  { value: '2M', label: 'Germany' },
  { value: 'J0', label: 'Ghana' },
  { value: 'J1', label: 'Gibraltar' },
  { value: 'J3', label: 'Greece' },
  { value: 'J4', label: 'Greenland' },
  { value: 'J5', label: 'Grenada' },
  { value: 'J6', label: 'Guadeloupe' },
  { value: 'J8', label: 'Guatemala' },
  { value: 'Y7', label: 'Guernsey' },
  { value: 'J9', label: 'Guinea' },
  { value: 'S0', label: 'Guinea-bissau' },
  { value: 'K0', label: 'Guyana' },
  { value: 'K1', label: 'Haiti' },
  { value: 'K4', label: 'Heard Island and Mcdonald Islands' },
  { value: 'X4', label: 'Holy See (Vatican City State)' },
  { value: 'K2', label: 'Honduras' },
  { value: 'K3', label: 'Hong Kong' },
  { value: 'K5', label: 'Hungary' },
  { value: 'K6', label: 'Iceland' },
  { value: 'K7', label: 'India' },
  { value: 'K8', label: 'Indonesia' },
  { value: 'K9', label: 'Iran, Islamic Republic of' },
  { value: 'L0', label: 'Iraq' },
  { value: 'L2', label: 'Ireland' },
  { value: 'Y8', label: 'Isle of Man' },
  { value: 'L3', label: 'Israel' },
  { value: 'L6', label: 'Italy' },
  { value: 'L8', label: 'Jamaica' },
  { value: 'M0', label: 'Japan' },
  { value: 'Y9', label: 'Jersey' },
  { value: 'M2', label: 'Jordan' },
  { value: '1P', label: 'Kazakhstan' },
  { value: 'M3', label: 'Kenya' },
  { value: 'J2', label: 'Kiribati' },
  { value: 'M4', label: 'Korea, Democratic People\'s Republic of' },
  { value: 'M5', label: 'Korea, Republic of' },
  { value: 'M6', label: 'Kuwait' },
  { value: '1N', label: 'Kyrgyzstan' },
  { value: 'M7', label: 'Lao People\'s Democratic Republic' },
  { value: '1R', label: 'Latvia' },
  { value: 'M8', label: 'Lebanon' },
  { value: 'M9', label: 'Lesotho' },
  { value: 'N0', label: 'Liberia' },
  { value: 'N1', label: 'Libyan Arab Jamahiriya' },
  { value: 'N2', label: 'Liechtenstein' },
  { value: '1Q', label: 'Lithuania' },
  { value: 'N4', label: 'Luxembourg' },
  { value: 'N5', label: 'Macau' },
  { value: '1U', label: 'Macedonia, the Former Yugoslav Republic of' },
  { value: 'N6', label: 'Madagascar' },
  { value: 'N7', label: 'Malawi' },
  { value: 'N8', label: 'Malaysia' },
  { value: 'N9', label: 'Maldives' },
  { value: 'O0', label: 'Mali' },
  { value: 'O1', label: 'Malta' },
  { value: '1T', label: 'Marshall Islands' },
  { value: 'O2', label: 'Martinique' },
  { value: 'O3', label: 'Mauritania' },
  { value: 'O4', label: 'Mauritius' },
  { value: '2P', label: 'Mayotte' },
  { value: 'O5', label: 'Mexico' },
  { value: '1K', label: 'Micronesia, Federated States of' },
  { value: '1S', label: 'Moldova, Republic of' },
  { value: 'O9', label: 'Monaco' },
  { value: 'P0', label: 'Mongolia' },
  { value: 'Z5', label: 'Montenegro' },
  { value: 'P1', label: 'Montserrat' },
  { value: 'P2', label: 'Morocco' },
  { value: 'P3', label: 'Mozambique' },
  { value: 'E1', label: 'Myanmar' },
  { value: 'T6', label: 'Namibia' },
  { value: 'P5', label: 'Nauru' },
  { value: 'P6', label: 'Nepal' },
  { value: 'P7', label: 'Netherlands' },
  { value: 'P8', label: 'Netherlands Antilles' },
  { value: '1W', label: 'New Caledonia' },
  { value: 'Q2', label: 'New Zealand' },
  { value: 'Q3', label: 'Nicaragua' },
  { value: 'Q4', label: 'Niger' },
  { value: 'Q5', label: 'Nigeria' },
  { value: 'Q6', label: 'Niue' },
  { value: 'Q7', label: 'Norfolk Island' },
  { value: '1V', label: 'Northern Mariana Islands' },
  { value: 'Q8', label: 'Norway' },
  { value: 'P4', label: 'Oman' },
  { value: 'R0', label: 'Pakistan' },
  { value: '1Y', label: 'Palau' },
  { value: '1X', label: 'Palestinian Territory, Occupied' },
  { value: 'R1', label: 'Panama' },
  { value: 'R2', label: 'Papua New Guinea' },
  { value: 'R4', label: 'Paraguay' },
  { value: 'R5', label: 'Peru' },
  { value: 'R6', label: 'Philippines' },
  { value: 'R8', label: 'Pitcairn' },
  { value: 'R9', label: 'Poland' },
  { value: 'S1', label: 'Portugal' },
  { value: 'S3', label: 'Qatar' },
  { value: 'S4', label: 'Reunion' },
  { value: 'S5', label: 'Romania' },
  { value: '1Z', label: 'Russian Federation' },
  { value: 'S6', label: 'Rwanda' },
  { value: 'Z0', label: 'Saint Barthelemy' },
  { value: 'U8', label: 'Saint Helena' },
  { value: 'U7', label: 'Saint Kitts and Nevis' },
  { value: 'U9', label: 'Saint Lucia' },
  { value: 'Z1', label: 'Saint Martin' },
  { value: 'V0', label: 'Saint Pierre and Miquelon' },
  { value: 'V1', label: 'Saint Vincent and the Grenadines' },
  { value: 'Y0', label: 'Samoa' },
  { value: 'S8', label: 'San Marino' },
  { value: 'S9', label: 'Sao Tome and Principe' },
  { value: 'T0', label: 'Saudi Arabia' },
  { value: 'T1', label: 'Senegal' },
  { value: 'Z2', label: 'Serbia' },
  { value: 'T2', label: 'Seychelles' },
  { value: 'T8', label: 'Sierra Leone' },
  { value: 'U0', label: 'Singapore' },
  { value: '2B', label: 'Slovakia' },
  { value: '2A', label: 'Slovenia' },
  { value: 'D7', label: 'Solomon Islands' },
  { value: 'U1', label: 'Somalia' },
  { value: 'T3', label: 'South Africa' },
  { value: '1L', label: 'South Georgia and the South Sandwich Islands' },
  { value: 'U3', label: 'Spain' },
  { value: 'F1', label: 'Sri Lanka' },
  { value: 'V2', label: 'Sudan' },
  { value: 'V3', label: 'Suriname' },
  { value: 'L9', label: 'Svalbard and Jan Mayen' },
  { value: 'V6', label: 'Swaziland' },
  { value: 'V7', label: 'Sweden' },
  { value: 'V8', label: 'Switzerland' },
  { value: 'V9', label: 'Syrian Arab Republic' },
  { value: 'F5', label: 'Taiwan, Province of China' },
  { value: '2D', label: 'Tajikistan' },
  { value: 'W0', label: 'Tanzania, United Republic of' },
  { value: 'W1', label: 'Thailand' },
  { value: 'Z3', label: 'Timor-leste' },
  { value: 'W2', label: 'Togo' },
  { value: 'W3', label: 'Tokelau' },
  { value: 'W4', label: 'Tonga' },
  { value: 'W5', label: 'Trinidad and Tobago' },
  { value: 'W6', label: 'Tunisia' },
  { value: 'W8', label: 'Turkey' },
  { value: '2E', label: 'Turkmenistan' },
  { value: 'W7', label: 'Turks and Caicos Islands' },
  { value: '2G', label: 'Tuvalu' },
  { value: 'W9', label: 'Uganda' },
  { value: '2H', label: 'Ukraine' },
  { value: 'C0', label: 'United Arab Emirates' },
  { value: 'X0', label: 'United Kingdom' },
  { value: 'X3', label: 'Uruguay' },
  { value: '2K', label: 'Uzbekistan' },
  { value: '2L', label: 'Vanuatu' },
  { value: 'X5', label: 'Venezuela' },
  { value: 'Q1', label: 'Viet Nam' },
  { value: 'D8', label: 'Virgin Islands, British' },
  { value: 'X8', label: 'Wallis and Futuna' },
  { value: 'U5', label: 'Western Sahara' },
  { value: 'T7', label: 'Yemen' },
  { value: 'Y4', label: 'Zambia' },
  { value: 'Y5', label: 'Zimbabwe' },
  { value: 'XX', label: 'Unknown' },
];

const SECSearchPage: React.FC = () => {
  // Get user for WebSocket streaming
  const { user } = useAuth();
  // Session persistence key
  const SESSION_STORAGE_KEY = 'sec-search-page-state';

  // Helper function to load state from sessionStorage
  const loadStateFromStorage = () => {
    try {
      const savedState = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (savedState) {
        return JSON.parse(savedState);
      }
    } catch (error) {
      console.error('❌ Error loading state from sessionStorage:', error);
    }
    return null;
  };

  // Initialize state from sessionStorage immediately (using function initializer)
  const savedState = loadStateFromStorage();
  
  const [searchParams, setSearchParams] = useState<SECSearchParams>(
    savedState?.searchParams || {
      dateFrom: '2001-01-01',
      dateTo: new Date().toISOString().split('T')[0],
    }
  );
  const [companyInput, setCompanyInput] = useState<string>(savedState?.companyInput || '');
  const [companySuggestions, setCompanySuggestions] = useState<SECAutocompleteSuggestion[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<SECAutocompleteSuggestion | null>(
    savedState?.selectedCompany || null
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    savedState?.selectedColumns || DEFAULT_COLUMNS
  );
  const [showAdvanced, setShowAdvanced] = useState<boolean>(savedState?.showAdvanced || false);
  const [currentPage, setCurrentPage] = useState<number>(savedState?.currentPage || 1);
  const [currentResults, setCurrentResults] = useState<SECSearchResult[]>([]);
  const [totalFound, setTotalFound] = useState<number>(savedState?.totalFound || 0);
  const [formTypesModalOpen, setFormTypesModalOpen] = useState(false);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>(
    savedState?.selectedCategoryFilter || 'all'
  );
  
  // Store all results from current search for client-side filtering
  const [allSearchResults, setAllSearchResults] = useState<SECSearchResult[]>(
    savedState?.allSearchResults || []
  );
  const [isFiltered, setIsFiltered] = useState<boolean>(savedState?.isFiltered || false);
  
  // Store filter metadata for sidebar
  const [availableFilters, setAvailableFilters] = useState<{
    form_filters?: Array<{ form: string; count: number }>;
    entity_filters?: Array<{ entity: string; count: number }>;
    location_filters?: Array<{ location: string; count: number }>;
    incorporation_filters?: Array<{ state: string; count: number }>;
  }>(savedState?.availableFilters || {});
  
  
  // Filter sidebar state
  const [expandedFilters, setExpandedFilters] = useState(
    savedState?.expandedFilters || {
      entity: false,
      form: false,
      location: false,
      incorporation: false,
    }
  );
  
  // Selected filters (not yet applied to search)
  const [selectedFilters, setSelectedFilters] = useState<{
    entities: Array<{ entity: string; cik?: string }>;
    forms: string[];
    locations: string[];
    incorporationStates: string[];
  }>(
    savedState?.selectedFilters || {
      entities: [],
      forms: [],
      locations: [],
      incorporationStates: [],
    }
  );
  
  const RESULTS_PER_PAGE = 10;

  const { execute: executeSearch, data: searchResults, loading: searchLoading, error: searchError } = useSECSearch();
  const { execute: executeAutocomplete, loading: autocompleteLoading } = useSECAutocomplete();
  
  // Search state type: boolean (is searching), current page, total pages, job_id for async searches
  type SearchState = {
    isSearching: boolean;
    currentPage: number;
    totalPages: number | null;
    jobId: string | null;  // For async searches - used to cancel
  };

  // Initialize search state from sessionStorage
  const initializeSearchState = (): SearchState => {
    if (!savedState) {
      return { isSearching: false, currentPage: 0, totalPages: null, jobId: null };
    }
    
    // If isFetchingAll was true when saved, check if search likely still running
    if (savedState.isFetchingAll) {
      const savedSearchStartTime = savedState.searchStartTime;
      const now = Date.now();
      const SEARCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout
      
      // If we have a start time, check if search timed out
      if (savedSearchStartTime && (now - savedSearchStartTime) >= SEARCH_TIMEOUT_MS) {
        // Search timed out - clear state
        return { isSearching: false, currentPage: 0, totalPages: null, jobId: null };
      }
      
      // Otherwise, restore the searching state with saved progress
      const progress = savedState.fetchProgress || { currentPage: 1, totalPages: null };
      return {
        isSearching: true,
        currentPage: progress.currentPage || 1,
        totalPages: progress.totalPages || null,
        jobId: savedState.jobId || null,  // Restore job_id if exists
      };
    }
    
    return { isSearching: false, currentPage: 0, totalPages: null, jobId: null };
  };
  
  const initialSearchState = initializeSearchState();
  const [searchState, setSearchState] = useState<SearchState>(initialSearchState);
  const [searchStartTime, setSearchStartTime] = useState<number | null>(
    savedState?.searchStartTime || null
  );
  
  // Legacy state for backward compatibility (will be removed after migration)
  const isFetchingAll = searchState.isSearching;
  const fetchProgress = searchState.isSearching 
    ? { currentPage: searchState.currentPage, totalPages: searchState.totalPages }
    : null;
  const [selectedFiling, setSelectedFiling] = useState<SECSearchResult | null>(null);
  const [isRestoringState] = useState<boolean>(false); // Set to false since we initialize from storage

  // Log state restoration (state is already initialized from sessionStorage above)
  useEffect(() => {
    if (savedState) {
      console.log('✅ SEC search page state initialized from sessionStorage');
      console.log('🔄 Loading state:', {
        isFetchingAll,
        hasProgress: !!fetchProgress,
        searchStartTime,
        hasResults: allSearchResults.length > 0,
      });
    }
  }, []); // Only log once on mount

  // Immediately save searchState to sessionStorage when it changes
  // This ensures the button state persists even if user navigates away
  useEffect(() => {
    if (isRestoringState) {
      return; // Don't save during initial restoration
    }

    try {
      const currentState = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (currentState) {
        const parsed = JSON.parse(currentState);
        // Update the loading-related fields atomically
        parsed.isFetchingAll = searchState.isSearching;
        parsed.fetchProgress = searchState.isSearching 
          ? { currentPage: searchState.currentPage, totalPages: searchState.totalPages }
          : null;
        parsed.searchStartTime = searchStartTime;
        parsed.jobId = searchState.jobId;  // Save job_id for cancellation
        parsed.jobId = searchState.jobId;  // Save job_id for cancellation
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(parsed));
        if (searchState.isSearching) {
          console.log('💾 Updated search state in sessionStorage:', {
            isSearching: searchState.isSearching,
            currentPage: searchState.currentPage,
            totalPages: searchState.totalPages,
          });
        }
      } else {
        // If no state exists yet, create it with just the loading fields
        const newState = {
          isFetchingAll: searchState.isSearching,
          fetchProgress: searchState.isSearching 
            ? { currentPage: searchState.currentPage, totalPages: searchState.totalPages }
            : null,
          searchStartTime,
        };
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newState));
      }
    } catch (error) {
      console.error('❌ Error updating search state in sessionStorage:', error);
    }
  }, [searchState, searchStartTime, isRestoringState]);

  // Save state to sessionStorage whenever relevant state changes
  useEffect(() => {
    // Don't save during initial restoration
    if (isRestoringState) {
      return;
    }

    try {
      const stateToSave = {
        searchParams,
        selectedCompany,
        companyInput,
        allSearchResults,
        totalFound,
        currentPage,
        selectedFilters,
        availableFilters,
        expandedFilters,
        selectedCategoryFilter,
        selectedColumns,
        showAdvanced,
        isFiltered,
        // Save search state in legacy format for compatibility
        isFetchingAll: searchState.isSearching,
        fetchProgress: searchState.isSearching 
          ? { currentPage: searchState.currentPage, totalPages: searchState.totalPages }
          : null,
        searchStartTime, // Save when search started to determine if still in progress
        jobId: searchState.jobId,  // Save job_id for cancellation
      };
      
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('❌ Error saving SEC search page state:', error);
    }
  }, [
    searchParams,
    selectedCompany,
    companyInput,
    allSearchResults,
    totalFound,
    currentPage,
    selectedFilters,
    availableFilters,
    expandedFilters,
    selectedCategoryFilter,
    selectedColumns,
    showAdvanced,
    isFiltered,
    searchState,
    searchStartTime,
    isRestoringState,
  ]);

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

  // Fetch all results when a new search is performed (for client-side filtering)
  // Limit to first 1000 results to avoid performance issues
  const MAX_RESULTS_TO_FETCH = 1000;
  
  // Compute filters from results
  const computeFiltersFromResults = (results: SECSearchResult[]) => {
    const formCounts = new Map<string, number>();
    const entityCounts = new Map<string, number>();
    const locationCounts = new Map<string, number>();
    const incorporationCounts = new Map<string, number>();
    
    results.forEach(result => {
      // Count forms
      if (result.form) {
        formCounts.set(result.form, (formCounts.get(result.form) || 0) + 1);
      }
      
      // Count entities (from reportingFor and filingEntity)
      // Format as "Name (CIK 0000000000)" if CIK is available
      const entities = [
        { name: result.reportingFor, cik: result.cik },
        { name: result.filingEntity, cik: result.cik }
      ].filter(e => e.name);
      
      entities.forEach(({ name, cik }) => {
        if (name) {
          // Format entity as "Name (CIK 0000000000)" if CIK available, otherwise just "Name"
          const entityKey = cik ? `${name} (CIK ${cik.padStart(10, '0')})` : name;
          entityCounts.set(entityKey, (entityCounts.get(entityKey) || 0) + 1);
        }
      });
      
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
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
    };
  };
  
  const fetchAllResults = async (params: SECSearchParams) => {
    const startTimestamp = Date.now();
    setSearchStartTime(startTimestamp);
    
    console.log('🔍 Starting async search:', { params, timestamp: new Date().toISOString() });
    
    try {
      // Note: user_id is NOT sent in request body for security
      // Backend extracts user_id from Cognito JWT token (authenticated request)
      // This prevents user_id spoofing and ensures proper user isolation
      
      // Call search API - now returns 200 immediately with job_id, processes async
      // API Gateway will pass Cognito JWT to Lambda, which extracts user_id securely
      const result = await secSearchAPI.search(params);
      
      if (!result.success || !result.job_id) {
        console.error('❌ Failed to start search:', result.error || 'No job_id returned');
        setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
        return;
      }
      
      const jobId = result.job_id;
      console.log('✅ Search started, job_id:', jobId);
      
      // Store job_id and set initial state - progress will stream via WebSocket
      setSearchState({ 
        isSearching: true, 
        currentPage: 0, 
        totalPages: null, 
        jobId: jobId 
      });
      
      // Poll for job completion (WebSocket handles progress updates)
      const pollInterval = setInterval(async () => {
        try {
          const jobStatus = await secSearchAPI.getJobStatus(jobId);
          
          if (!jobStatus) {
            console.warn('⚠️ Job status not found, stopping poll');
            clearInterval(pollInterval);
            setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
            return;
          }
          
          const status = jobStatus.status;
          console.log(`📊 Job ${jobId} status: ${status}`);
          
          if (status === 'COMPLETED') {
            clearInterval(pollInterval);
            console.log('✅ Search completed, fetching results');
            
            // Fetch final results from job
            const finalResults = jobStatus.results || jobStatus.job_results;
            
            if (finalResults && finalResults.success && !finalResults.cancelled) {
              const allResults = finalResults.results || [];
              
              // Set filter metadata
              if (finalResults.form_filters || finalResults.entity_filters) {
                setAvailableFilters({
                  form_filters: finalResults.form_filters || [],
                  entity_filters: finalResults.entity_filters || [],
                  location_filters: finalResults.location_filters || [],
                  incorporation_filters: finalResults.incorporation_filters || [],
                });
              }
              
              // Set all results
              setAllSearchResults(allResults);
              setTotalFound(finalResults.total_found || allResults.length);
              
              // Clear search state
              setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
              setSearchStartTime(null);
              
              console.log(`✅ Search completed: ${allResults.length} results`);
            } else if (finalResults?.cancelled) {
              console.log('🛑 Search was cancelled');
              setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
              setSearchStartTime(null);
            } else {
              console.warn('⚠️ Search completed but no results available');
              setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
              setSearchStartTime(null);
            }
          } else if (status === 'FAILED' || status === 'CANCELLED') {
            clearInterval(pollInterval);
            console.log(`❌ Search ${status.toLowerCase()}:`, jobStatus.error || 'Unknown error');
            setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
            setSearchStartTime(null);
          }
          // IN_PROGRESS or PENDING - continue polling, progress updates come via WebSocket
        } catch (error) {
          console.error('❌ Error polling job status:', error);
        }
      }, 2000); // Poll every 2 seconds
      
      // Cleanup interval after 10 minutes (safety timeout)
      setTimeout(() => {
        clearInterval(pollInterval);
        if (searchState.jobId === jobId) {
          console.warn('⏱️ Poll timeout reached, stopping');
          setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
        }
      }, 10 * 60 * 1000);
      
      // Store interval reference for cleanup if component unmounts
      return () => clearInterval(pollInterval);
    } catch (error) {
      console.error('❌ Error starting search:', error);
      setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
      setSearchStartTime(null);
    }
  };
  
  // Store results when search completes
  useEffect(() => {
    if (searchResults?.results) {
      // If this is a filtered search (API call with filters), use results directly
      if (isFiltered) {
        setCurrentResults(searchResults.results);
        setTotalFound(searchResults.total_found || 0);
      }
      // Otherwise, results are being accumulated by fetchAllResults
      
      // Form types are dynamically updated from searchResults.form_filters in the sidebar
    } else if (searchResults && !searchResults.results && searchResults.total_found === 0) {
      // Only clear if this is a new search with no results (not a filter application)
      // Don't clear if we already have stored results
      if (allSearchResults.length === 0) {
        setCurrentResults([]);
        setAllSearchResults([]);
        setTotalFound(0);
      }
    }
  }, [searchResults, isFiltered, allSearchResults.length]);
  
  // Client-side filtering function
  // Logic: OR within each filter type, AND between filter types
  // Example: (Entity A OR Entity B) AND (Form 4 OR Form 5) AND (Location X OR Location Y)
  const filterResults = (results: SECSearchResult[]): SECSearchResult[] => {
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
    // A result matches if its form is ANY of the selected forms
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
  };
  
  // Apply filters to stored results (client-side) and paginate
  useEffect(() => {
    console.log('🔄 Filter useEffect triggered:', {
      allSearchResultsLength: allSearchResults.length,
      selectedFilters: {
        entities: selectedFilters.entities.length,
        forms: selectedFilters.forms.length,
        locations: selectedFilters.locations.length,
        incorporationStates: selectedFilters.incorporationStates.length,
      },
      currentPage,
    });
    
    // Only process if we have stored results
    if (allSearchResults.length > 0) {
      let filtered = allSearchResults;
      
      // Check if any filters are selected
      const hasFilters = selectedFilters.entities.length > 0 ||
                         selectedFilters.forms.length > 0 ||
                         selectedFilters.locations.length > 0 ||
                         selectedFilters.incorporationStates.length > 0;
      
      // Apply filters if any are selected
      if (hasFilters) {
        console.log('🔍 Applying filters to results...');
        filtered = filterResults(allSearchResults);
        console.log(`📊 Filtered results: ${filtered.length} of ${allSearchResults.length} match filters`);
        setIsFiltered(true);
        
        // Log if filters return nothing - but keep allSearchResults intact
        if (filtered.length === 0) {
          console.warn('⚠️ Filters returned 0 results, but keeping original search results intact:', {
            originalCount: allSearchResults.length,
            filters: selectedFilters,
            message: 'User can remove filters to see results again',
          });
          // Set display to empty but keep allSearchResults
          setTotalFound(0);
          setCurrentResults([]);
          // Don't clear allSearchResults - it stays intact for when filters are removed
          return; // Exit early - don't paginate empty results
        }
      } else {
        // No filters - show all results
        console.log('✅ No filters applied, showing all results');
        setIsFiltered(false);
      }
      
      // Update total and paginate (only if we have filtered results)
      const filteredTotal = filtered.length;
      setTotalFound(filteredTotal);
      const startIdx = (currentPage - 1) * RESULTS_PER_PAGE;
      const endIdx = startIdx + RESULTS_PER_PAGE;
      const paginatedResults = filtered.slice(startIdx, endIdx);
      setCurrentResults(paginatedResults);
      
      console.log(`📄 Paginated: showing ${paginatedResults.length} results (page ${currentPage}, total: ${filteredTotal})`);
    } else if (allSearchResults.length === 0) {
      // Only clear if allSearchResults is actually empty (not just filtered out)
      // This should only happen on initial load or after a new search clears results
      console.log('⚠️ allSearchResults is empty, clearing current results');
      setCurrentResults([]);
      setTotalFound(0);
    }
  }, [selectedFilters, allSearchResults, currentPage]);

  const handleCancelSearch = async () => {
    try {
      // If we have a job_id, cancel the async job
      if (searchState.jobId) {
        console.log(`🛑 Cancelling async search job ${searchState.jobId}`);
        const result = await secSearchAPI.cancelJob(searchState.jobId);
        
        if (result.success) {
          console.log('✅ Async search cancelled successfully');
        } else {
          console.error('❌ Failed to cancel async search:', result.error);
        }
      } else {
        console.log('🛑 Cancelling sync search');
      }
      
      // Always clear search state (works for both sync and async searches)
      setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
      setSearchStartTime(null);
      setAllSearchResults([]);
      setCurrentResults([]);
      setTotalFound(0);
      console.log('✅ Search state cleared');
    } catch (error) {
      console.error('❌ Error cancelling search:', error);
      // Still clear state even if API call fails
      setSearchState({ isSearching: false, currentPage: 0, totalPages: null, jobId: null });
      setSearchStartTime(null);
    }
  };

  const handleSearch = async (page: number = 1, applyFilters: boolean = false) => {
    // If applying filters and we have stored results, just update pagination
    if (applyFilters && allSearchResults.length > 0) {
      setCurrentPage(page);
      // Filtering and pagination is handled by useEffect
      return;
    }
    
    const params: SECSearchParams = {
      ...searchParams,
      page: 1, // Always start from page 1 for new searches
      columns: selectedColumns.length === DEFAULT_COLUMNS.length ? [] : selectedColumns,
    };

    // Remove empty strings
    Object.keys(params).forEach(key => {
      const value = params[key as keyof SECSearchParams];
      if (value === '' || (Array.isArray(value) && value.length === 0)) {
        delete params[key as keyof SECSearchParams];
      }
    });

    // Reset filters and fetch all results for client-side filtering
    setSelectedFilters({
      entities: [],
      forms: [],
      locations: [],
      incorporationStates: [],
    });
    setAvailableFilters({}); // Clear filters until new ones are loaded
    setCurrentPage(1);
    setIsFiltered(false);
    
    // Start search - now returns 200 immediately with job_id, progress streams via WebSocket
    await fetchAllResults(params);
  };

  // Subscribe to WebSocket progress updates for SEC search
  useEffect(() => {
    if (!searchState.jobId) {
      return;
    }

    console.log('📡 SECSearchPage: Subscribing to WebSocket progress updates for job:', searchState.jobId);
    
    const unsubscribe = unifiedMessageHandler.onSecSearchProgressUpdate((jobId, progress) => {
      if (jobId === searchState.jobId && progress) {
        console.log('📊 SECSearchPage: Received progress update:', progress);
        // Update search state with progress from WebSocket
        setSearchState(prev => ({
          ...prev,
          currentPage: progress.current_page || prev.currentPage,
          totalPages: progress.total_pages || prev.totalPages,
          isSearching: progress.status === 'IN_PROGRESS' || progress.status === 'PENDING',
        }));
      }
    });

    // Also listen for custom events (fallback)
    const handleProgressEvent = (event: CustomEvent) => {
      if (event.detail.jobId === searchState.jobId) {
        const progress = event.detail.progress;
        console.log('📊 SECSearchPage: Received progress event:', progress);
        setSearchState(prev => ({
          ...prev,
          currentPage: progress.current_page || prev.currentPage,
          totalPages: progress.total_pages || prev.totalPages,
          isSearching: progress.status === 'IN_PROGRESS' || progress.status === 'PENDING',
        }));
      }
    };

    window.addEventListener('sec-search-progress-updated', handleProgressEvent as EventListener);

    return () => {
      unsubscribe();
      window.removeEventListener('sec-search-progress-updated', handleProgressEvent as EventListener);
    };
  }, [searchState.jobId]);

  const handleApplyFilters = () => {
    // Filtering is handled by useEffect - just reset to page 1
    setCurrentPage(1);
  };

  const handlePageChange = async (newPage: number) => {
    if (newPage < 1) return;
    if (!totalFound || totalFound === 0) return; // Don't paginate if no results
    const maxPage = Math.ceil(totalFound / RESULTS_PER_PAGE);
    if (maxPage === 0 || newPage > maxPage) return;
    
    // Client-side pagination - just update page, useEffect will handle slicing
    setCurrentPage(newPage);
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

  // Filter form types based on selected category
  const filteredFormTypes = useMemo(() => {
    if (selectedCategoryFilter === 'all') {
      return ALL_FORM_TYPES;
    }
    const category = SEC_FORM_CATEGORIES.find(cat => cat.id === selectedCategoryFilter);
    if (!category) return ALL_FORM_TYPES;
    
    return ALL_FORM_TYPES.filter(form => category.formTypes.includes(form.id));
  }, [selectedCategoryFilter]);

  // Handle form type selection in modal
  const handleFormTypeToggle = (formId: string) => {
    setSearchParams(prev => {
      const current = prev.formTypes || [];
      if (current.includes(formId)) {
        const newTypes = current.filter(t => t !== formId);
        return { ...prev, formTypes: newTypes.length > 0 ? newTypes : undefined };
      } else {
        return { ...prev, formTypes: [...current, formId] };
      }
    });
  };

  // Handle select all/none
  const handleSelectAllForms = (selectAll: boolean) => {
    if (selectAll) {
      const allIds = filteredFormTypes.map(f => f.id);
      setSearchParams(prev => ({ ...prev, formTypes: allIds }));
    } else {
      setSearchParams(prev => ({ ...prev, formTypes: undefined }));
    }
  };

  // Check if all filtered forms are selected
  const areAllFilteredFormsSelected = useMemo(() => {
    const selected = searchParams.formTypes || [];
    return filteredFormTypes.length > 0 && filteredFormTypes.every(form => selected.includes(form.id));
  }, [filteredFormTypes, searchParams.formTypes]);

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
          {/* Top Bar - Common Search Parameters */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mb: 3 }}>
            {/* Row 1: Company Name and Keywords */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
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
            </Box>

            {/* Row 2: Filing Category and Date Range */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              {/* Form Types - Button to open modal */}
              <Box>
                <TextField
                  label="Filing category"
                  value={
                    searchParams.formTypes && searchParams.formTypes.length > 0
                      ? `${searchParams.formTypes.length} form${searchParams.formTypes.length > 1 ? 's' : ''} selected`
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
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': { borderColor: '#374151' },
                      '&:hover fieldset': { borderColor: '#3b82f6' },
                      '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                    },
                    '& .MuiInputLabel-root': { color: '#9ca3af' },
                    '& .MuiInputBase-input': { color: '#ffffff', cursor: 'pointer' },
                  }}
                />
                {searchParams.formTypes && searchParams.formTypes.length > 0 && (
                  <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {searchParams.formTypes.slice(0, 3).map((formType) => (
                      <Chip
                        key={formType}
                        label={formType}
                        size="small"
                        onDelete={() => handleFormTypeToggle(formType)}
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                          '& .MuiChip-deleteIcon': { color: '#93c5fd' },
                        }}
                      />
                    ))}
                    {searchParams.formTypes.length > 3 && (
                      <Chip
                        label={`+${searchParams.formTypes.length - 3} more`}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          color: '#93c5fd',
                          border: '1px solid #3b82f6',
                        }}
                      />
                    )}
                  </Box>
                )}
              </Box>

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
            </Box>
          </Box>

          {/* Advanced Filters Toggle */}
          <Button
            onClick={() => setShowAdvanced(!showAdvanced)}
            startIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{
              color: '#9ca3af',
              textTransform: 'none',
              mb: showAdvanced ? 2 : 0,
              '&:hover': { 
                color: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
              },
            }}
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Filters
          </Button>

          {/* Advanced Filters */}
          <Collapse in={showAdvanced}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', border: '1px solid #374151', borderRadius: '4px', mt: 2 }}>
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
              
              {/* Located - Dropdown */}
              <FormControl 
                variant="outlined" 
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#374151' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
                  },
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiSelect-select': { color: '#ffffff' },
                }}
              >
                <InputLabel id="located-label">Located</InputLabel>
                <Select
                  labelId="located-label"
                  value={searchParams.located || 'all'}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchParams(prev => ({ 
                      ...prev, 
                      located: value === 'all' ? undefined : value 
                    }));
                  }}
                  label="Located"
                >
                  {LOCATION_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

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
          </Collapse>

          {/* Search Button and Stop Button */}
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              onClick={() => handleSearch()}
              disabled={searchLoading || searchState.isSearching}
              startIcon={(searchLoading || searchState.isSearching) ? <CircularProgress size={20} /> : <SearchIcon />}
              sx={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                py: 1.5,
                px: 4,
                minWidth: 200,
                '&:hover': {
                  background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                },
                '&:disabled': {
                  background: 'rgba(59, 130, 246, 0.3)',
                },
              }}
            >
              {searchState.isSearching
                ? searchState.totalPages 
                  ? `Fetching page ${searchState.currentPage} of ${searchState.totalPages}...`
                  : `Fetching page ${searchState.currentPage}...`
                : (searchLoading || searchState.isSearching)
                  ? 'Searching...'
                  : 'Search SEC Filings'}
            </Button>
            
            {/* Stop Button - red border, clear background, red square icon, only show when search is in progress */}
            {searchState.isSearching && (
              <Button
                variant="outlined"
                onClick={handleCancelSearch}
                sx={{
                  borderColor: '#ef4444',
                  backgroundColor: 'transparent',
                  color: '#ef4444',
                  minWidth: 48,
                  width: 48,
                  height: 48,
                  borderRadius: '4px', // Match search button border radius
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  '&:hover': {
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  },
                }}
              >
                <Box
                  sx={{
                    width: 16,
                    height: 16,
                    backgroundColor: '#ef4444',
                    borderRadius: '2px',
                  }}
                />
              </Button>
            )}
          </Box>

          {/* Column Selection - Move to Advanced or keep separate */}
          <Box sx={{ mt: 3, p: 2, backgroundColor: 'rgba(15, 23, 42, 0.5)', border: '1px solid #374151', borderRadius: '4px' }}>
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
        </GlassCard>

        {/* Form Types Selection Modal */}
        <Dialog
          open={formTypesModalOpen}
          onClose={() => setFormTypesModalOpen(false)}
          maxWidth="md"
          fullWidth
          PaperProps={{
            sx: {
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              border: '2px solid #374151',
              borderRadius: '0px',
              color: '#ffffff',
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
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                Use the category select to narrow the choices.
              </Typography>
            </Box>
            <IconButton
              onClick={() => setFormTypesModalOpen(false)}
              sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}
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
                  '& .MuiInputLabel-root': { color: '#9ca3af' },
                  '& .MuiSelect-select': { color: '#ffffff' },
                }}
              >
                <InputLabel id="category-filter-label">Category Filter</InputLabel>
                <Select
                  labelId="category-filter-label"
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
                      filteredFormTypes.some(form => (searchParams.formTypes || []).includes(form.id))
                    }
                    onChange={(e) => handleSelectAllForms(e.target.checked)}
                    sx={{
                      color: '#9ca3af',
                      '&.Mui-checked': { color: '#3b82f6' },
                    }}
                  />
                }
                label="Check/uncheck all forms"
                sx={{ color: '#9ca3af' }}
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
              <Grid container spacing={1}>
                {filteredFormTypes.map((formType) => {
                  const isSelected = (searchParams.formTypes || []).includes(formType.id);
                  return (
                    <Grid item xs={6} sm={4} md={3} key={formType.id}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={isSelected}
                            onChange={() => handleFormTypeToggle(formType.id)}
                            sx={{
                              color: '#9ca3af',
                              '&.Mui-checked': { color: '#3b82f6' },
                            }}
                          />
                        }
                        label={formType.label}
                        sx={{ 
                          color: '#9ca3af',
                          '& .MuiFormControlLabel-label': { fontSize: '0.875rem' },
                        }}
                      />
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          </DialogContent>

          <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
            <Button
              onClick={() => setFormTypesModalOpen(false)}
              sx={{
                color: '#9ca3af',
                textTransform: 'none',
                '&:hover': { color: '#ffffff', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => setFormTypesModalOpen(false)}
              variant="contained"
              sx={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                textTransform: 'none',
                '&:hover': {
                  background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                },
              }}
            >
              Filter
            </Button>
          </DialogActions>
        </Dialog>

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

        {/* Results with Sidebar */}
        {allSearchResults.length > 0 && (
          <Box sx={{ display: 'flex', gap: 3 }}>
            {/* Sidebar Filters */}
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
                Document counts shown in <Chip label="#" size="small" sx={{ 
                  height: 18, 
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(107, 114, 128, 0.3)',
                  color: '#9ca3af',
                  border: '1px solid #6b7280',
                }} />
              </Typography>

              {/* Selected Filters Box */}
              {(selectedFilters.entities.length > 0 || 
                selectedFilters.forms.length > 0 || 
                selectedFilters.locations.length > 0 || 
                selectedFilters.incorporationStates.length > 0) && (
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
                    {/* Entity chips */}
                    {selectedFilters.entities.map((entity, idx) => (
                      <Chip
                        key={`entity-${idx}`}
                        label={entity.entity}
                        onDelete={() => {
                          setSelectedFilters((prev: typeof selectedFilters) => ({
                            ...prev,
                            entities: prev.entities.filter((_, i) => i !== idx),
                          }));
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
                    {/* Form chips */}
                    {selectedFilters.forms.map((form, idx) => (
                      <Chip
                        key={`form-${idx}`}
                        label={form}
                        onDelete={() => {
                          setSelectedFilters((prev: typeof selectedFilters) => ({
                            ...prev,
                            forms: prev.forms.filter((_, i) => i !== idx),
                          }));
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
                    {/* Location chips */}
                    {selectedFilters.locations.map((location, idx) => (
                      <Chip
                        key={`location-${idx}`}
                        label={location}
                        onDelete={() => {
                          setSelectedFilters((prev: typeof selectedFilters) => ({
                            ...prev,
                            locations: prev.locations.filter((_, i) => i !== idx),
                          }));
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
                    {/* Incorporation state chips */}
                    {selectedFilters.incorporationStates.map((state, idx) => (
                      <Chip
                        key={`inc-${idx}`}
                        label={state}
                        onDelete={() => {
                          setSelectedFilters((prev: typeof selectedFilters) => ({
                            ...prev,
                            incorporationStates: prev.incorporationStates.filter((_, i) => i !== idx),
                          }));
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
                    variant="contained"
                    onClick={handleApplyFilters}
                    disabled={searchLoading}
                    startIcon={searchLoading ? <CircularProgress size={16} /> : <SearchIcon />}
                    sx={{
                      background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                      color: '#ffffff',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      py: 0.75,
                      px: 2,
                      fontSize: '0.75rem',
                      width: '100%',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                      },
                      '&:disabled': {
                        background: 'rgba(59, 130, 246, 0.3)',
                      },
                    }}
                  >
                    {searchLoading ? 'Applying...' : 'Apply Filters'}
                  </Button>
                </Box>
              )}

              {/* Entity Filter */}
              {availableFilters.entity_filters && availableFilters.entity_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, entity: !prev.entity }))}
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
                      Entity
                    </Typography>
                    {expandedFilters.entity ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.entity}>
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
                      {availableFilters.entity_filters.map((filter, idx) => {
                        // Check if this entity is selected
                        const match = filter.entity.match(/^(.+?)\s*\(CIK\s+(\d+)\)$/);
                        let entityObj;
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
                              {filter.entity}
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

              {/* Form Filter */}
              {availableFilters.form_filters && availableFilters.form_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, form: !prev.form }))}
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
                      Form
                    </Typography>
                    {expandedFilters.form ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.form}>
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
                      {availableFilters.form_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.forms.includes(filter.form);
                        
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters((prev: typeof selectedFilters) => {
                                const exists = prev.forms.includes(filter.form);
                                if (exists) {
                                  // Remove if already selected
                                  return {
                                    ...prev,
                                    forms: prev.forms.filter(f => f !== filter.form),
                                  };
                                } else {
                                  // Add if not selected
                                  return {
                                    ...prev,
                                    forms: [...prev.forms, filter.form],
                                  };
                                }
                              });
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
                              {filter.form}
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

              {/* Location Filter */}
              {availableFilters.location_filters && availableFilters.location_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, location: !prev.location }))}
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
                      Principal executive offices located in
                    </Typography>
                    {expandedFilters.location ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.location}>
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
                      {availableFilters.location_filters.map((filter, idx) => {
                        // Extract state code from location string (e.g., "Austin, TX" -> "TX", "California" -> "CA")
                        const getStateCode = (location: string): string => {
                          // If it's already a 2-letter code, return it
                          if (/^[A-Z]{2}$/.test(location.trim())) {
                            return location.trim();
                          }
                          // If it contains a comma, extract the state code after the comma
                          const commaMatch = location.match(/,\s*([A-Z]{2})$/);
                          if (commaMatch) {
                            return commaMatch[1];
                          }
                          // Try to map full state name to code (basic mapping)
                          const stateNameToCode: { [key: string]: string } = {
                            'California': 'CA', 'Texas': 'TX', 'New York': 'NY', 'Florida': 'FL',
                            'Illinois': 'IL', 'Pennsylvania': 'PA', 'Ohio': 'OH', 'Georgia': 'GA',
                            'North Carolina': 'NC', 'Michigan': 'MI', 'New Jersey': 'NJ', 'Virginia': 'VA',
                            'Washington': 'WA', 'Arizona': 'AZ', 'Massachusetts': 'MA', 'Tennessee': 'TN',
                            'Indiana': 'IN', 'Missouri': 'MO', 'Maryland': 'MD', 'Wisconsin': 'WI',
                            'Colorado': 'CO', 'Minnesota': 'MN', 'South Carolina': 'SC', 'Alabama': 'AL',
                            'Louisiana': 'LA', 'Kentucky': 'KY', 'Oregon': 'OR', 'Oklahoma': 'OK',
                            'Connecticut': 'CT', 'Utah': 'UT', 'Iowa': 'IA', 'Nevada': 'NV',
                            'Arkansas': 'AR', 'Mississippi': 'MS', 'Kansas': 'KS', 'New Mexico': 'NM',
                            'Nebraska': 'NE', 'West Virginia': 'WV', 'Idaho': 'ID', 'Hawaii': 'HI',
                            'New Hampshire': 'NH', 'Maine': 'ME', 'Montana': 'MT', 'Rhode Island': 'RI',
                            'Delaware': 'DE', 'South Dakota': 'SD', 'North Dakota': 'ND', 'Alaska': 'AK',
                            'Vermont': 'VT', 'Wyoming': 'WY', 'District of Columbia': 'DC',
                          };
                          return stateNameToCode[location] || location; // Return original if no match
                        };
                        
                        const stateCode = getStateCode(filter.location);
                        const isSelected = selectedFilters.locations.includes(stateCode);
                        
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters((prev: typeof selectedFilters) => {
                                const exists = prev.locations.includes(stateCode);
                                if (exists) {
                                  // Remove if already selected
                                  return {
                                    ...prev,
                                    locations: prev.locations.filter(l => l !== stateCode),
                                  };
                                } else {
                                  // Add if not selected
                                  return {
                                    ...prev,
                                    locations: [...prev.locations, stateCode],
                                  };
                                }
                              });
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
                              {filter.location}
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

              {/* Incorporation Filter */}
              {availableFilters.incorporation_filters && availableFilters.incorporation_filters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Box
                    onClick={() => setExpandedFilters(prev => ({ ...prev, incorporation: !prev.incorporation }))}
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
                      Incorporated in
                    </Typography>
                    {expandedFilters.incorporation ? <KeyboardArrowUpIcon sx={{ color: '#9ca3af' }} /> : <KeyboardArrowDownIcon sx={{ color: '#9ca3af' }} />}
                  </Box>
                  <Collapse in={expandedFilters.incorporation}>
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
                      {availableFilters.incorporation_filters.map((filter, idx) => {
                        const isSelected = selectedFilters.incorporationStates.includes(filter.state);
                        
                        return (
                          <Box
                            key={idx}
                            onClick={() => {
                              setSelectedFilters((prev: typeof selectedFilters) => {
                                const exists = prev.incorporationStates.includes(filter.state);
                                if (exists) {
                                  // Remove if already selected
                                  return {
                                    ...prev,
                                    incorporationStates: prev.incorporationStates.filter(s => s !== filter.state),
                                  };
                                } else {
                                  // Add if not selected
                                  return {
                                    ...prev,
                                    incorporationStates: [...prev.incorporationStates, filter.state],
                                  };
                                }
                              });
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
            </GlassCard>

            {/* Results Table */}
            <Box sx={{ flex: 1 }}>
              <GlassCard sx={{ p: 4 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                  <Typography
                    variant="h6"
                    sx={{
                      color: '#ffffff',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Search Results
                  </Typography>
                  
                  {/* Status Indicator */}
                  {allSearchResults.length > 0 || searchState.isSearching ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      {totalFound > 0 ? (
                        <Chip
                          label={`${totalFound} filing${totalFound !== 1 ? 's' : ''} found`}
                          sx={{
                            backgroundColor: 'rgba(34, 197, 94, 0.2)',
                            color: '#86efac',
                            border: '1px solid #22c55e',
                            fontWeight: 600,
                          }}
                        />
                      ) : isFiltered && allSearchResults.length > 0 ? (
                        <Chip
                          label={`0 of ${allSearchResults.length} forms match filters`}
                          sx={{
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                            border: '1px solid #ef4444',
                            fontWeight: 600,
                          }}
                        />
                      ) : allSearchResults.length === 0 && !searchState.isSearching ? (
                        <Chip
                          label="No forms found"
                          sx={{
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                            border: '1px solid #ef4444',
                            fontWeight: 600,
                          }}
                        />
                      ) : null}
                    </Box>
                  ) : null}
                </Box>
                
                {totalFound > 0 ? (
                  <Typography
                    variant="body2"
                    sx={{
                      color: '#9ca3af',
                      mb: 2,
                    }}
                  >
                    Showing {((currentPage - 1) * RESULTS_PER_PAGE) + 1}-{Math.min(currentPage * RESULTS_PER_PAGE, totalFound)} of {totalFound} results
                  </Typography>
                ) : isFiltered && allSearchResults.length > 0 ? (
                  <Typography
                    variant="body2"
                    sx={{
                      color: '#9ca3af',
                      mb: 2,
                    }}
                  >
                    No results match the selected filters. Your original search found {allSearchResults.length} form{allSearchResults.length !== 1 ? 's' : ''}.
                  </Typography>
                ) : null}

                {currentResults.length > 0 ? (
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
                      <TableCell sx={{ color: '#9ca3af', fontWeight: 600, borderColor: '#374151' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {currentResults.map((result, index) => (
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
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => setSelectedFiling(result)}
                            sx={{
                              color: '#3b82f6',
                              borderColor: '#3b82f6',
                              '&:hover': {
                                borderColor: '#60a5fa',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              },
                            }}
                          >
                            View Filing
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : allSearchResults.length === 0 && !isFetchingAll ? (
              <Alert severity="info" sx={{
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid #3b82f6',
                color: '#93c5fd',
                '& .MuiAlert-icon': { color: '#93c5fd' },
              }}>
                No forms found. Try adjusting your search parameters.
              </Alert>
            ) : currentResults.length === 0 && allSearchResults.length > 0 && isFiltered ? (
              <Alert 
                severity="info" 
                sx={{
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid #3b82f6',
                  color: '#93c5fd',
                  '& .MuiAlert-icon': { color: '#93c5fd' },
                }}
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      console.log('🔄 Clearing all filters to restore results');
                      setSelectedFilters({
                        entities: [],
                        forms: [],
                        locations: [],
                        incorporationStates: [],
                      });
                      setCurrentPage(1);
                    }}
                    sx={{
                      color: '#93c5fd',
                      '&:hover': {
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      },
                    }}
                  >
                    Clear Filters
                  </Button>
                }
              >
                No forms match the selected filters. Your original search found {allSearchResults.length} form{allSearchResults.length !== 1 ? 's' : ''}. 
                Remove filters to see them again.
              </Alert>
            ) : null}

            {/* Pagination Controls */}
            {totalFound > RESULTS_PER_PAGE && totalFound > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, pt: 3, borderTop: '1px solid #374151' }}>
                <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                  Page {currentPage} of {Math.ceil(totalFound / RESULTS_PER_PAGE)}
                  {' '}(Showing {((currentPage - 1) * RESULTS_PER_PAGE) + 1}-{Math.min(currentPage * RESULTS_PER_PAGE, totalFound)} of {totalFound} results)
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
                    disabled={!totalFound || currentPage >= Math.ceil(totalFound / RESULTS_PER_PAGE) || searchLoading}
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
            </Box>
          </Box>
        )}
      </Container>

      {/* Filing Details Dialog */}
      <Dialog
        open={selectedFiling !== null}
        onClose={() => setSelectedFiling(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            borderRadius: '8px',
            color: '#ffffff',
          },
        }}
      >
        {selectedFiling && (
          <>
            <DialogTitle sx={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              borderBottom: '1px solid #374151',
              pb: 2,
              color: '#ffffff',
              fontWeight: 600,
            }}>
              Filing Details: {selectedFiling.form} - {selectedFiling.filingEntity}
              <IconButton
                onClick={() => setSelectedFiling(null)}
                sx={{ color: '#9ca3af', '&:hover': { color: '#ffffff' } }}
              >
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
                    Filing Information
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>Form</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.form}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>Filing Date</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.filingDate}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#6b7280' }}>Reporting For</Typography>
                      <Typography variant="body2" sx={{ color: '#ffffff' }}>{selectedFiling.reportingFor}</Typography>
                    </Box>
                  </Box>
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                    Filing Page
                  </Typography>
                  {selectedFiling.filingPageUrl ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Link
                        href={selectedFiling.filingPageUrl}
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
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: '#9ca3af' }}>Not available</Typography>
                  )}
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                    Document Format Files ({selectedFiling.documentUrls?.length || 0})
                  </Typography>
                  {selectedFiling.documentUrls && selectedFiling.documentUrls.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: '400px', overflowY: 'auto' }}>
                      {selectedFiling.documentUrls.map((url, index) => {
                        const filename = url.split('/').pop() || `Document ${index + 1}`;
                        const s3Key = selectedFiling.documentS3Keys?.[url];
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
                              <DocumentIcon sx={{ fontSize: 18, color: '#3b82f6' }} />
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
                              {s3Key && (
                                <IconButton
                                  size="small"
                                  onClick={async () => {
                                    try {
                                      console.log('📥 Downloading SEC filing document:', filename);
                                      
                                      const apiUrl = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';
                                      const response = await fetch(`${apiUrl}/file-download`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          bucket: 'SEC_FILINGS',
                                          s3_key: s3Key,
                                          filename: filename
                                        })
                                      });
                                      
                                      if (!response.ok) {
                                        throw new Error(`Download request failed: ${response.status}`);
                                      }
                                      
                                      const { download_url } = await response.json();
                                      
                                      // Create download link and trigger download
                                      const link = document.createElement('a');
                                      link.href = download_url;
                                      link.download = filename;
                                      link.target = '_blank';
                                      document.body.appendChild(link);
                                      link.click();
                                      document.body.removeChild(link);
                                      
                                      console.log('✅ File download started');
                                    } catch (error) {
                                      console.error('❌ Download failed:', error);
                                    }
                                  }}
                                  sx={{
                                    color: '#3b82f6',
                                    ml: 'auto',
                                    '&:hover': { color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.1)' }
                                  }}
                                >
                                  <DownloadIcon fontSize="small" />
                                </IconButton>
                              )}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: '#9ca3af' }}>No document format files available</Typography>
                  )}
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1, mt: 2 }}>
                    Data Files ({selectedFiling.dataFileUrls?.length || 0})
                  </Typography>
                  {selectedFiling.dataFileUrls && selectedFiling.dataFileUrls.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: '400px', overflowY: 'auto' }}>
                      {selectedFiling.dataFileUrls.map((url, index) => {
                        const filename = url.split('/').pop() || `Data File ${index + 1}`;
                        const s3Key = selectedFiling.dataFileS3Keys?.[url];
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
                              <DocumentIcon sx={{ fontSize: 18, color: '#3b82f6' }} />
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
                              {s3Key && (
                                <IconButton
                                  size="small"
                                  onClick={async () => {
                                    try {
                                      console.log('📥 Downloading SEC filing data file:', filename);
                                      
                                      const apiUrl = process.env.REACT_APP_API_GATEWAY_URL || 'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';
                                      const response = await fetch(`${apiUrl}/file-download`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          bucket: 'SEC_FILINGS',
                                          s3_key: s3Key,
                                          filename: filename
                                        })
                                      });
                                      
                                      if (!response.ok) {
                                        throw new Error(`Download request failed: ${response.status}`);
                                      }
                                      
                                      const { download_url } = await response.json();
                                      
                                      // Create download link and trigger download
                                      const link = document.createElement('a');
                                      link.href = download_url;
                                      link.download = filename;
                                      link.target = '_blank';
                                      document.body.appendChild(link);
                                      link.click();
                                      document.body.removeChild(link);
                                      
                                      console.log('✅ File download started');
                                    } catch (error) {
                                      console.error('❌ Download failed:', error);
                                    }
                                  }}
                                  sx={{
                                    color: '#3b82f6',
                                    ml: 'auto',
                                    '&:hover': { color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.1)' }
                                  }}
                                >
                                  <DownloadIcon fontSize="small" />
                                </IconButton>
                              )}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: '#9ca3af' }}>No data files available</Typography>
                  )}
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions sx={{ borderTop: '1px solid #374151', p: 2 }}>
              <Button
                onClick={() => setSelectedFiling(null)}
                sx={{
                  color: '#9ca3af',
                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' },
                }}
              >
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

export default SECSearchPage;

