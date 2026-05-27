import React, { useState, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Chip,
  TableContainer,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import {
  fecSearchAPI,
  FECSearchHit,
  FECSearchFilters,
} from '../services/api';

const DEFAULT_CYCLE = new Date().getFullYear() % 2 === 0
  ? new Date().getFullYear()
  : new Date().getFullYear() + 1;

function formatMoney(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

const FECSearchPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [cycle, setCycle] = useState<number>(DEFAULT_CYCLE);
  const [results, setResults] = useState<FECSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [selectedHit, setSelectedHit] = useState<FECSearchHit | null>(null);
  const [schedulePreview, setSchedulePreview] = useState<Record<string, unknown>[]>([]);
  const [scheduleMeta, setScheduleMeta] = useState<string>('');

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    try {
      const filters: FECSearchFilters = { q: query.trim(), cycle };
      const resp = await fecSearchAPI.search({ filters, limit: 25 });
      if (!resp.success) {
        setError(resp.error || 'Search failed');
        setResults([]);
        return;
      }
      setResults(resp.results || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, cycle]);

  const openProfile = async (hit: FECSearchHit) => {
    setSelectedHit(hit);
    setProfileOpen(true);
    setProfileLoading(true);
    setProfile(null);
    setSchedulePreview([]);
    setScheduleMeta('');
    try {
      const resp = await fecSearchAPI.getProfile({
        entity_type: hit.entity_type,
        entity_id: hit.entity_id,
        cycle,
      });
      if (!resp.success || !resp.result) {
        setError(resp.error || 'Profile not indexed yet — run Glue indexing for this entity');
        setProfile(null);
        return;
      }
      setProfile(resp.result);

      const principalId =
        (resp.result.principal_committee_id as string) ||
        ((resp.result.committees as { committee_id?: string; designation?: string }[] | undefined)?.find(
          (c) => c.designation === 'P'
        )?.committee_id);
      const committeeId =
        hit.entity_type === 'committee' ? hit.entity_id : principalId;
      if (committeeId) {
        const sched = await fecSearchAPI.getSchedules({
          entity_id: committeeId,
          cycle,
          schedule: 'schedule_a',
          page: 1,
          per_page: 10,
        });
        if (sched.success && sched.results?.length) {
          setSchedulePreview(sched.results);
          setScheduleMeta(
            `Schedule A: ${sched.count} of ${sched.total_rows} rows (page 1) — ${sched.s3_key || ''}`
          );
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setProfileLoading(false);
    }
  };

  const totals = profile?.authorized_totals as Record<string, unknown> | undefined;
  const detail = profile?.detail as Record<string, unknown> | undefined;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Typography variant="h4" sx={{ color: '#f8fafc', mb: 1, fontWeight: 600 }}>
        FEC Campaign Finance
      </Typography>
      <Typography variant="body2" sx={{ color: '#94a3b8', mb: 3 }}>
        Search politicians and committees via openFEC. Profiles come from indexed DynamoDB data; full
        Schedule A/B line items are stored in S3 (index the principal committee to populate).
      </Typography>

      <Card sx={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid #374151', mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
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
              onChange={(e) => setCycle(parseInt(e.target.value, 10) || DEFAULT_CYCLE)}
              sx={{ width: 120 }}
              size="small"
            />
            <Button
              variant="contained"
              startIcon={isSearching ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
              onClick={runSearch}
              disabled={isSearching || !query.trim()}
            >
              Search
            </Button>
          </Box>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Card} sx={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid #374151' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ color: '#94a3b8' }}>Type</TableCell>
              <TableCell sx={{ color: '#94a3b8' }}>ID</TableCell>
              <TableCell sx={{ color: '#94a3b8' }}>Name</TableCell>
              <TableCell sx={{ color: '#94a3b8' }}>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {results.map((hit) => (
              <TableRow
                key={`${hit.entity_type}-${hit.entity_id}`}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => openProfile(hit)}
              >
                <TableCell>
                  <Chip
                    size="small"
                    label={hit.entity_type}
                    color={hit.entity_type === 'candidate' ? 'primary' : 'secondary'}
                  />
                </TableCell>
                <TableCell sx={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{hit.entity_id}</TableCell>
                <TableCell sx={{ color: '#f8fafc' }}>{hit.name}</TableCell>
                <TableCell sx={{ color: '#94a3b8' }}>{hit.subtitle}</TableCell>
              </TableRow>
            ))}
            {!isSearching && results.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} sx={{ color: '#64748b', textAlign: 'center', py: 4 }}>
                  Search for a candidate or committee to begin
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ background: '#0f172a', color: '#f8fafc' }}>
          {selectedHit?.name || 'Profile'}
          {selectedHit && (
            <Typography variant="caption" display="block" sx={{ color: '#94a3b8' }}>
              {selectedHit.entity_type} · {selectedHit.entity_id} · cycle {cycle}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent sx={{ background: '#0f172a', color: '#e2e8f0' }}>
          {profileLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {!profileLoading && profile && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8' }}>
                  Receipts / disbursements (authorized committee totals)
                </Typography>
                <Typography>
                  Receipts {formatMoney(totals?.receipts)} · Disbursements{' '}
                  {formatMoney(totals?.disbursements)} · Cash on hand{' '}
                  {formatMoney(totals?.last_cash_on_hand_end_period)}
                </Typography>
              </Box>
              {detail && (
                <Box>
                  <Typography variant="subtitle2" sx={{ color: '#94a3b8' }}>
                    Candidate / committee
                  </Typography>
                  <Typography>
                    {(detail.name as string) || '—'} · {(detail.party_full as string) || detail.party || '—'} ·{' '}
                    {(detail.state as string) || '—'}
                  </Typography>
                </Box>
              )}
              {scheduleMeta && (
                <Box>
                  <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1 }}>
                    {scheduleMeta}
                  </Typography>
                  {schedulePreview.slice(0, 5).map((row, i) => (
                    <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {formatMoney(row.contribution_receipt_amount)} —{' '}
                      {(row.contributor_name as string) || '—'}
                    </Typography>
                  ))}
                </Box>
              )}
              {!scheduleMeta && selectedHit?.entity_type === 'candidate' && (
                <Alert severity="info">
                  Schedule line items live on the principal committee profile in S3. Index committee{' '}
                  {(profile.principal_committee_id as string) || 'C00…'} with Glue to populate.
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Container>
  );
};

export default FECSearchPage;
