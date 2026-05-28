import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  IconButton,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { formatFECMoney } from '../../utils/fecEntityUtils';
import { fileReturnAPI } from '../../services/api';

const scrollbarStyles = {
  '&::-webkit-scrollbar': { width: '8px' },
  '&::-webkit-scrollbar-track': { background: 'rgba(15, 23, 42, 0.5)' },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(100, 116, 139, 0.5)',
    borderRadius: '4px',
  },
};

interface FECEntityDetailsContentProps {
  itemData: Record<string, unknown>;
  title?: string;
  userId?: string;
}

function labelize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000) return formatFECMoney(value);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? `[${value.length} items]` : '—';
  if (typeof value === 'object') return '[object]';
  return String(value);
}

const FECFinancialChart: React.FC<{ totals: Record<string, unknown> }> = ({ totals }) => {
  const receipts = Number(totals.receipts) || 0;
  const disbursements = Number(totals.disbursements) || 0;
  const cash = Number(totals.last_cash_on_hand_end_period) || 0;
  const maxVal = Math.max(receipts, disbursements, cash, 1);
  const chartWidth = 640;
  const barHeight = 32;
  const chartHeight = 56;
  const labelRowHeight = 52;

  const segments = [
    { key: 'receipts', label: 'Receipts', value: receipts, color: '#3b82f6' },
    { key: 'disbursements', label: 'Disbursements', value: disbursements, color: '#f59e0b' },
    { key: 'cash', label: 'Cash on hand', value: cash, color: '#10b981' },
  ].filter((s) => s.value > 0);

  if (segments.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: '#64748b', textAlign: 'center', py: 2 }}>
        No financial totals available for this cycle.
      </Typography>
    );
  }

  const pct = (v: number) => (v / maxVal) * chartWidth;
  let x = 0;

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ position: 'relative', minHeight: labelRowHeight, mb: 0.5 }}>
        {segments.map((seg) => {
          const w = pct(seg.value);
          const leftPct = (x / chartWidth) * 100;
          const bubble = (
            <Box
              key={`${seg.key}-label`}
              sx={{
                position: 'absolute',
                left: `max(${leftPct + (w / chartWidth) * 100}%, 4%)`,
                top: 0,
                transform: 'translateX(-100%)',
                px: 1.5,
                py: 0.75,
                borderRadius: 1.5,
                bgcolor: seg.color,
                color: '#fff',
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              <Box component="span" sx={{ display: 'block', fontSize: '0.8rem', opacity: 0.95 }}>
                {seg.label}:
              </Box>
              <Box component="span" sx={{ display: 'block', fontSize: '0.95rem', fontWeight: 700 }}>
                {formatFECMoney(seg.value)}
              </Box>
            </Box>
          );
          x += w;
          return bubble;
        })}
      </Box>
      <Box sx={{ width: '100%', minHeight: chartHeight }}>
        <svg
          width="100%"
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="none"
          style={{ display: 'block' }}
        >
          <rect
            x={0}
            y={(chartHeight - barHeight) / 2}
            width={chartWidth}
            height={barHeight}
            fill="rgba(30, 41, 59, 0.5)"
          />
          {(() => {
            let offset = 0;
            return segments.map((seg) => {
              const w = pct(seg.value);
              const el = (
                <rect
                  key={seg.key}
                  x={offset}
                  y={(chartHeight - barHeight) / 2}
                  width={w}
                  height={barHeight}
                  fill={seg.color}
                />
              );
              offset += w;
              return el;
            });
          })()}
        </svg>
      </Box>
    </Box>
  );
};

const FECEntityDetailsContent: React.FC<FECEntityDetailsContentProps> = ({
  itemData,
  title,
  userId,
}) => {
  const profile = (itemData.profile as Record<string, unknown> | undefined) || itemData;
  const totals =
    (profile.authorized_totals as Record<string, unknown> | undefined) ||
    (itemData.authorized_totals as Record<string, unknown> | undefined);
  const detail = (profile.detail as Record<string, unknown> | undefined) || {};
  const committees = (profile.committees as Record<string, unknown>[] | undefined) || [];
  const schedulePreview =
    (itemData.schedule_preview as Record<string, unknown>[] | undefined) || [];
  const scheduleMeta = itemData.schedule_meta as string | undefined;
  const scheduleKeys =
    (itemData.schedule_keys as
      | { schedule_a: string; schedule_b: string; schedule_e: string }
      | undefined) || undefined;
  const entityType = (itemData.entity_type as string) || (profile.entity_type as string);
  const entityId = (itemData.entity_id as string) || (profile.candidate_id as string);
  const cycle = itemData.cycle as number | undefined;

  const skipKeys = new Set([
    'authorized_totals',
    'committees',
    'detail',
    'schedule_preview',
    'schedule_meta',
    'profile',
    'PK',
    'SK',
  ]);

  const scalarFields = Object.entries(profile).filter(
    ([k, v]) => !skipKeys.has(k) && v !== null && typeof v !== 'object'
  );
  const scheduleColumns = React.useMemo(() => {
    const keys = new Set<string>();
    schedulePreview.forEach((row) => {
      Object.keys(row).forEach((k) => keys.add(k));
    });
    return Array.from(keys);
  }, [schedulePreview]);
  const [downloadLoadingKey, setDownloadLoadingKey] = React.useState<string | null>(null);

  const handleScheduleDownload = React.useCallback(
    async (schedule: 'schedule_a' | 'schedule_b' | 'schedule_e') => {
      if (!userId || !scheduleKeys) return;
      const s3Key = scheduleKeys[schedule];
      const filename = s3Key.split('/').pop() || `${schedule}.json.gz`;
      setDownloadLoadingKey(schedule);
      try {
        const response = await fileReturnAPI.downloadFile({
          user_id: userId,
          session_id: '',
          bucket: 'FEC_DATA',
          s3_key: s3Key,
          filename,
        });
        if (!response.success || !response.data?.download_url) {
          throw new Error(response.error || 'Failed to generate download URL');
        }
        const link = document.createElement('a');
        link.href = response.data.download_url;
        link.download = filename;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error('Failed to download schedule file:', err);
      } finally {
        setDownloadLoadingKey(null);
      }
    },
    [userId, scheduleKeys]
  );

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
        {title || (itemData.name as string) || 'FEC Entity'}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {entityType && (
          <Chip size="small" label={entityType} color="primary" variant="outlined" />
        )}
        {entityId && (
          <Chip size="small" label={entityId} sx={{ fontFamily: 'monospace', color: '#94a3b8' }} />
        )}
        {cycle && <Chip size="small" label={`Cycle ${cycle}`} />}
        {(itemData.party as string) && <Chip size="small" label={itemData.party as string} />}
        {(itemData.state as string) && <Chip size="small" label={itemData.state as string} />}
        {(itemData.office as string) && <Chip size="small" label={itemData.office as string} />}
      </Box>

      {totals && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '4px',
            border: '1px solid #374151',
          }}
        >
          <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
            Campaign finance totals
          </Typography>
          <FECFinancialChart totals={totals} />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 1.5,
              mt: 2,
            }}
          >
            {Object.entries(totals)
              .filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && v !== ''))
              .slice(0, 24)
              .map(([k, v]) => (
                <Box
                  key={k}
                  sx={{
                    p: 1.5,
                    backgroundColor: 'rgba(15, 23, 42, 0.5)',
                    borderRadius: 1,
                    border: '1px solid #1e293b',
                  }}
                >
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block' }}>
                    {labelize(k)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {typeof v === 'number' ? formatFECMoney(v) : formatFieldValue(v)}
                  </Typography>
                </Box>
              ))}
          </Box>
        </Box>
      )}

      {Object.keys(detail).length > 0 && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '4px',
            border: '1px solid #374151',
          }}
        >
          <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
            {entityType === 'committee' ? 'Committee' : 'Candidate'} details
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {Object.entries(detail).map(([k, v]) => (
              <Typography key={k} variant="body2" sx={{ color: '#e2e8f0' }}>
                <strong>{labelize(k)}:</strong> {formatFieldValue(v)}
              </Typography>
            ))}
          </Box>
        </Box>
      )}

      {committees.length > 0 && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '4px',
            border: '1px solid #374151',
          }}
        >
          <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
            Committees ({committees.length})
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: '#94a3b8' }}>ID</TableCell>
                  <TableCell sx={{ color: '#94a3b8' }}>Name</TableCell>
                  <TableCell sx={{ color: '#94a3b8' }}>Designation</TableCell>
                  <TableCell sx={{ color: '#94a3b8' }}>Party</TableCell>
                  <TableCell sx={{ color: '#94a3b8' }}>State</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {committees.map((c, i) => (
                  <TableRow key={(c.committee_id as string) || i}>
                    <TableCell sx={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {(c.committee_id as string) || '—'}
                    </TableCell>
                    <TableCell sx={{ color: '#f8fafc' }}>{(c.name as string) || '—'}</TableCell>
                    <TableCell sx={{ color: '#94a3b8' }}>
                      {(c.designation_full as string) || (c.designation as string) || '—'}
                    </TableCell>
                    <TableCell sx={{ color: '#94a3b8' }}>
                      {(c.party_full as string) || (c.party as string) || '—'}
                    </TableCell>
                    <TableCell sx={{ color: '#94a3b8' }}>{(c.state as string) || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {scheduleMeta && schedulePreview.length > 0 && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '4px',
            border: '1px solid #374151',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6" sx={{ color: '#3b82f6', fontWeight: 600 }}>
              {scheduleMeta}
            </Typography>
            {scheduleKeys && (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {(['schedule_a', 'schedule_b', 'schedule_e'] as const).map((sched) => (
                  <Tooltip key={sched} title={`Download ${sched}.json.gz`}>
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => handleScheduleDownload(sched)}
                        disabled={!userId || downloadLoadingKey === sched}
                        sx={{ color: '#3b82f6' }}
                      >
                        {downloadLoadingKey === sched ? (
                          <CircularProgress size={14} sx={{ color: '#3b82f6' }} />
                        ) : (
                          <DownloadIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                ))}
              </Box>
            )}
          </Box>
          <TableContainer sx={{ maxHeight: 320 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {scheduleColumns.map((col) => (
                    <TableCell
                      key={col}
                      sx={{ color: '#94a3b8', bgcolor: '#1e293b', whiteSpace: 'nowrap' }}
                    >
                      {labelize(col)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {schedulePreview.map((row, i) => (
                  <TableRow key={i}>
                    {scheduleColumns.map((col) => (
                      <TableCell
                        key={`${i}-${col}`}
                        sx={{
                          color: '#e2e8f0',
                          maxWidth: 280,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontSize: '0.75rem',
                        }}
                        title={formatFieldValue(row[col])}
                      >
                        {formatFieldValue(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {scheduleKeys && (!scheduleMeta || schedulePreview.length === 0) && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '4px',
            border: '1px solid #374151',
          }}
        >
          <Typography variant="h6" sx={{ color: '#3b82f6', mb: 1, fontWeight: 600 }}>
            Schedule files
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {(['schedule_a', 'schedule_b', 'schedule_e'] as const).map((sched) => (
              <Tooltip key={`fallback-${sched}`} title={`Download ${sched}.json.gz`}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => handleScheduleDownload(sched)}
                    disabled={!userId || downloadLoadingKey === sched}
                    sx={{ color: '#3b82f6' }}
                  >
                    {downloadLoadingKey === sched ? (
                      <CircularProgress size={14} sx={{ color: '#3b82f6' }} />
                    ) : (
                      <DownloadIcon fontSize="small" />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            ))}
          </Box>
        </Box>
      )}

      {!scheduleMeta && entityType === 'candidate' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Full Schedule A/B/E line items are stored in S3 on the principal committee. Index that
          committee with Glue to enable schedule previews.
        </Alert>
      )}

      {scalarFields.length > 0 && (
        <Box
          sx={{
            mb: 2,
            p: 2,
            backgroundColor: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '4px',
            border: '1px solid #374151',
          }}
        >
          <Typography variant="h6" sx={{ color: '#3b82f6', mb: 2, fontWeight: 600 }}>
            Profile fields
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {scalarFields.map(([k, v]) => (
              <Typography key={k} variant="body2" sx={{ color: '#e2e8f0', fontSize: '0.8rem' }}>
                <strong>{labelize(k)}:</strong> {formatFieldValue(v)}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default FECEntityDetailsContent;
