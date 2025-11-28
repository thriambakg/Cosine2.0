import { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Collapse,
  Tooltip,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Divider,
  Chip,
  Link as MuiLink,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { ContextItem } from '../tiles/common/contextManager';

interface ContextItemRowProps {
  item: ContextItem;
  onRemove?: () => void;
  sessionId?: string | null;
  userId?: string | null;
}

const API_BASE_URL =
  process.env.REACT_APP_API_GATEWAY_URL ||
  'https://033vd3eo96.execute-api.us-east-1.amazonaws.com/production';

const formatLabel = (key: string) =>
  key
    ?.replace(/_/g, ' ')
    ?.replace(/\b\w/g, (char) => char.toUpperCase()) || '';

const deriveDocumentName = (url: string) => {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split('/').pop() || url);
  } catch {
    return url;
  }
};

const ContextItemRow = ({ item, onRemove, sessionId, userId }: ContextItemRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const data = item.data || {};
  const isSecFiling =
    item.type === 'sec_filing' ||
    Boolean(data?.filingId || data?.form || data?.documentUrls || data?.documentS3Keys);

  const secDocuments = useMemo(() => {
    const urls: string[] = data.documentUrls || [];
    const s3Keys: Record<string, string> = data.documentS3Keys || {};
    return urls.map((url: string) => ({
      url,
      label: deriveDocumentName(url),
      s3Key: s3Keys?.[url],
    }));
  }, [data]);

  const secDataFiles = useMemo(() => {
    const urls: string[] = data.dataFileUrls || [];
    const s3Keys: Record<string, string> = data.dataFileS3Keys || {};
    return urls.map((url: string) => ({
      url,
      label: deriveDocumentName(url),
      s3Key: s3Keys?.[url],
    }));
  }, [data]);

  const handleDownload = async (s3Key?: string, filename?: string) => {
    if (!s3Key || !sessionId || !userId) return;
    try {
      setDownloadingKey(s3Key);
      const response = await fetch(`${API_BASE_URL}/file-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          bucket: 'SEC_FILINGS',
          s3_key: s3Key,
          filename: filename || deriveDocumentName(s3Key),
        }),
      });
      if (!response.ok) throw new Error(`Download request failed: ${response.status}`);
      const { download_url } = await response.json();
      const link = document.createElement('a');
      link.href = download_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    } catch (error) {
      console.error('SEC filing download failed:', error);
    } finally {
      setDownloadingKey(null);
    }
  };

  const renderGenericDetails = (value: any, depth = 0) => {
    if (value === null || value === undefined) {
      return (
        <Typography variant="body2" color="#9ca3af">
          —
        </Typography>
      );
    }

    if (typeof value !== 'object') {
      return (
        <Typography variant="body2" color="white">
          {String(value)}
        </Typography>
      );
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <Typography variant="body2" color="#9ca3af">
            Empty list
          </Typography>
        );
      }
      return (
        <Box sx={{ pl: depth ? 2 : 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {value.slice(0, 5).map((item, idx) => (
            <Box key={idx} sx={{ borderLeft: depth ? '1px solid rgba(148, 163, 184, 0.4)' : 'none', pl: depth ? 1 : 0 }}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                Item {idx + 1}
              </Typography>
              {renderGenericDetails(item, depth + 1)}
            </Box>
          ))}
          {value.length > 5 && (
            <Typography variant="caption" color="#9ca3af">
              +{value.length - 5} more…
            </Typography>
          )}
        </Box>
      );
    }

    return (
      <Box sx={{ pl: depth ? 2 : 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {Object.entries(value).map(([key, val]) => (
          <Box key={key}>
            <Typography variant="caption" sx={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {formatLabel(key)}
            </Typography>
            {renderGenericDetails(val, depth + 1)}
          </Box>
        ))}
      </Box>
    );
  };

  const renderSecDetails = () => {
    const infoFields = [
      { label: 'Form', value: data.form },
      { label: 'Filing ID', value: data.filingId || data.accession || data.adsh },
      { label: 'Entity', value: data.filingEntity || data.reportingFor },
      { label: 'CIK', value: data.cik },
      { label: 'File Number', value: data.fileNumber },
      { label: 'Film Number', value: data.filmNumber },
      { label: 'Filed', value: data.filingDate },
      { label: 'Location', value: data.located },
      { label: 'Incorporated', value: data.incorporated },
    ];

    return (
      <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 1 }}>
          {infoFields
            .filter((field) => field.value)
            .map((field) => (
              <Box key={field.label} sx={{ backgroundColor: 'rgba(59, 130, 246, 0.08)', borderRadius: 1, p: 1 }}>
                <Typography variant="caption" sx={{ color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {field.label}
                </Typography>
                <Typography variant="body2" sx={{ color: 'white', wordBreak: 'break-word' }}>
                  {field.value}
                </Typography>
              </Box>
            ))}
        </Box>

        {data.filingPageUrl && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label="SEC Index Page"
              size="small"
              sx={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: 600 }}
              icon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
              component={MuiLink}
              href={data.filingPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              clickable
            />
          </Box>
        )}

        {secDocuments.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ color: '#f8fafc', mb: 0.5 }}>
              Filing Documents
            </Typography>
            <Table size="small" sx={{ backgroundColor: 'rgba(15, 23, 42, 0.6)', borderRadius: 1 }}>
              <TableBody>
                {secDocuments.map((doc) => (
                  <TableRow key={doc.url}>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Filing URL
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <MuiLink
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ color: '#60a5fa', fontSize: '0.8rem', wordBreak: 'break-all' }}
                        >
                          {doc.label}
                        </MuiLink>
                        <Tooltip title="Open in new tab">
                          <IconButton size="small" href={doc.url} target="_blank" rel="noopener noreferrer" sx={{ color: '#9ca3af' }}>
                            <OpenInNewIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ width: 80 }}>
                      <Tooltip title={doc.s3Key ? 'Download via Cosine (presigned link)' : 'Download unavailable'}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!doc.s3Key || !sessionId || !userId || downloadingKey === doc.s3Key}
                            onClick={() => handleDownload(doc.s3Key, doc.label)}
                            sx={{ color: doc.s3Key ? '#fbbf24' : '#475569' }}
                          >
                            <DownloadIcon fontSize="inherit" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {secDataFiles.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ color: '#f8fafc', mb: 0.5 }}>
              Data Files
            </Typography>
            <Table size="small" sx={{ backgroundColor: 'rgba(15, 23, 42, 0.6)', borderRadius: 1 }}>
              <TableBody>
                {secDataFiles.map((doc) => (
                  <TableRow key={doc.url}>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Data File
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <MuiLink
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ color: '#60a5fa', fontSize: '0.8rem', wordBreak: 'break-all' }}
                        >
                          {doc.label}
                        </MuiLink>
                        <Tooltip title="Open in new tab">
                          <IconButton size="small" href={doc.url} target="_blank" rel="noopener noreferrer" sx={{ color: '#9ca3af' }}>
                            <OpenInNewIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ width: 80 }}>
                      <Tooltip title={doc.s3Key ? 'Download via Cosine (presigned link)' : 'Download unavailable'}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!doc.s3Key || !sessionId || !userId || downloadingKey === doc.s3Key}
                            onClick={() => handleDownload(doc.s3Key, doc.label)}
                            sx={{ color: doc.s3Key ? '#fbbf24' : '#475569' }}
                          >
                            <DownloadIcon fontSize="inherit" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        borderRadius: 1,
        p: 1,
        mb: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 600, wordBreak: 'break-word' }}>
            {item.title || 'Context Item'}
          </Typography>
          {item.subtitle && (
            <Typography variant="caption" sx={{ color: '#94a3b8', wordBreak: 'break-word' }}>
              {item.subtitle}
            </Typography>
          )}
          <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={item.type || 'custom'}
              sx={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', height: 20 }}
            />
            <Chip
              size="small"
              label={new Date(item.timestamp).toLocaleString()}
              sx={{ backgroundColor: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8', height: 20 }}
            />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title={expanded ? 'Collapse details' : 'Expand details'}>
            <IconButton size="small" onClick={() => setExpanded((prev) => !prev)} sx={{ color: '#9ca3af' }}>
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          {onRemove && (
            <Tooltip title="Remove from context">
              <IconButton size="small" onClick={onRemove} sx={{ color: '#dc2626', '&:hover': { color: '#ef4444' } }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Divider sx={{ my: 1, borderColor: 'rgba(148, 163, 184, 0.2)' }} />
        {isSecFiling ? renderSecDetails() : renderGenericDetails(item.data || {})}
      </Collapse>
    </Box>
  );
};

export default ContextItemRow;

