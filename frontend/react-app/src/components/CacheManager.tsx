import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Alert,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { cacheUtils } from '../hooks/useDashboardCache';

interface CacheManagerProps {
  open: boolean;
  onClose: () => void;
}

interface CacheStats {
  memorySize: number;
  sessionStorageSize: number;
  entries: Array<{
    key: string;
    age: number;
    ttl: number;
    source: 'memory' | 'sessionStorage';
  }>;
}

const CacheManager: React.FC<CacheManagerProps> = ({ open, onClose }) => {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = () => {
    setLoading(true);
    try {
      const cacheStats = cacheUtils.getStats();
      setStats(cacheStats);
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadStats();
    }
  }, [open]);

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all cache? This will force all tiles to reload their data.')) {
      cacheUtils.clearAll();
      loadStats();
    }
  };

  const handleClearByPattern = (pattern: string) => {
    if (window.confirm(`Clear cache for pattern: ${pattern}?`)) {
      cacheUtils.clearByPattern(pattern);
      loadStats();
    }
  };

  const formatAge = (age: number) => {
    const seconds = Math.floor(age / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatTTL = (ttl: number) => {
    const minutes = Math.floor(ttl / 60000);
    const seconds = Math.floor((ttl % 60000) / 1000);
    
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const getSourceColor = (source: 'memory' | 'sessionStorage') => {
    return source === 'memory' ? 'primary' : 'secondary';
  };

  const getSourceIcon = (source: 'memory' | 'sessionStorage') => {
    return source === 'memory' ? '🧠' : '💾';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <StorageIcon />
          <Typography variant="h6">Cache Manager</Typography>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box mb={2}>
          <Alert severity="info" icon={<InfoIcon />}>
            Cache helps reduce API calls and improve performance. Data is stored in memory and sessionStorage 
            to persist across tab switches and navigation.
          </Alert>
        </Box>

        <Box display="flex" gap={2} mb={3}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadStats}
            disabled={loading}
          >
            Refresh Stats
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={handleClearAll}
          >
            Clear All Cache
          </Button>
        </Box>

        {stats && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Cache Statistics
            </Typography>
            
            <Box display="flex" gap={2} mb={2}>
              <Chip
                label={`Memory: ${stats.memorySize} entries`}
                color="primary"
                icon={<span>🧠</span>}
              />
              <Chip
                label={`SessionStorage: ${stats.sessionStorageSize} entries`}
                color="secondary"
                icon={<span>💾</span>}
              />
            </Box>

            <Divider sx={{ my: 2 }} />

            <Typography variant="h6" gutterBottom>
              Cache Entries
            </Typography>

            {stats.entries.length === 0 ? (
              <Typography color="text.secondary" fontStyle="italic">
                No cache entries found
              </Typography>
            ) : (
              <Box>
                {stats.entries.map((entry, index) => (
                  <Box
                    key={index}
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    p={1}
                    border={1}
                    borderColor="divider"
                    borderRadius={1}
                    mb={1}
                  >
                    <Box flex={1}>
                      <Typography variant="body2" fontFamily="monospace">
                        {entry.key}
                      </Typography>
                      <Box display="flex" gap={1} mt={0.5}>
                        <Chip
                          size="small"
                          label={`Age: ${formatAge(entry.age)}`}
                          color={entry.age > entry.ttl ? 'error' : 'default'}
                        />
                        <Chip
                          size="small"
                          label={`TTL: ${formatTTL(entry.ttl)}`}
                          color="default"
                        />
                        <Chip
                          size="small"
                          label={entry.source}
                          color={getSourceColor(entry.source)}
                          icon={<span>{getSourceIcon(entry.source)}</span>}
                        />
                      </Box>
                    </Box>
                    
                    <Tooltip title="Clear this cache entry">
                      <IconButton
                        size="small"
                        onClick={() => handleClearByPattern(entry.key)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default CacheManager;
