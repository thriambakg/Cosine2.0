import React, { useState } from 'react';
import {
  Box,
  Typography,
  Container,
  Button,
  TextField,
  Card,
  CardContent,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Collapse,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  KeyboardArrowUp as ArrowUpIcon,
  KeyboardArrowDown as ArrowDownIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { useDashboardAPI } from '../hooks/useDashboardAPI';

interface OverhauledTabManagerProps {
  userId: string;
}

export const OverhauledTabManager: React.FC<OverhauledTabManagerProps> = ({ userId }) => {
  const { 
    dashboard, 
    loading, 
    error, 
    tabs, 
    groups, 
    activeTabId, 
    createTab, 
    reorderTabs, 
    loadDashboard 
  } = useDashboardAPI({ userId });

  const [newTabName, setNewTabName] = useState('');
  const [newTabColor, setNewTabColor] = useState('#3b82f6');
  const [creating, setCreating] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const handleCreateTab = async () => {
    if (!newTabName.trim() || creating) return;
    
    try {
      setCreating(true);
      await createTab({
        name: newTabName.trim(),
        color: newTabColor
      });
      setNewTabName('');
      console.log('✅ Tab created successfully');
    } catch (err) {
      console.error('❌ Failed to create tab:', err);
      alert('Failed to create tab. Check console for details.');
    } finally {
      setCreating(false);
    }
  };

  const handleReorderTab = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || !dashboard) return;
    
    const newOrder = [...dashboard.tabOrder];
    const [movedTab] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, movedTab);
    
    try {
      await reorderTabs(newOrder);
      console.log('✅ Tab reordered successfully');
    } catch (err) {
      console.error('❌ Failed to reorder tab:', err);
      alert('Failed to reorder tab. Check console for details.');
    }
  };

  const handleRefresh = async () => {
    try {
      await loadDashboard();
      console.log('✅ Dashboard refreshed');
    } catch (err) {
      console.error('❌ Failed to refresh dashboard:', err);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="400px">
          <CircularProgress size={60} />
          <Typography variant="h6" color="text.secondary" sx={{ mt: 2 }}>
            Loading dashboard...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert 
          severity="error" 
          action={
            <Button color="inherit" size="small" onClick={handleRefresh}>
              Retry
            </Button>
          }
        >
          <Typography variant="h6">Error Loading Dashboard</Typography>
          <Typography variant="body2">{error}</Typography>
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom color="primary">
          Overhauled Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          User ID: {userId} | Last Updated: {dashboard?.last_updated ? new Date(dashboard.last_updated).toLocaleString() : 'Unknown'}
        </Typography>
        <Button 
          variant="outlined" 
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          size="small"
        >
          Refresh
        </Button>
      </Box>

      {/* Create New Tab */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h5" component="h2" gutterBottom>
            Create New Tab
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', mt: 2 }}>
            <TextField
              fullWidth
              label="Tab Name"
              value={newTabName}
              onChange={(e) => setNewTabName(e.target.value)}
              placeholder="Enter tab name..."
              disabled={creating}
              variant="outlined"
            />
            <FormControl sx={{ minWidth: 120 }}>
              <InputLabel>Color</InputLabel>
              <Select
                value={newTabColor}
                onChange={(e) => setNewTabColor(e.target.value)}
                label="Color"
                disabled={creating}
              >
                <MenuItem value="#3b82f6">Blue</MenuItem>
                <MenuItem value="#ef4444">Red</MenuItem>
                <MenuItem value="#10b981">Green</MenuItem>
                <MenuItem value="#f59e0b">Yellow</MenuItem>
                <MenuItem value="#8b5cf6">Purple</MenuItem>
                <MenuItem value="#f97316">Orange</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleCreateTab}
              disabled={!newTabName.trim() || creating}
              sx={{ minWidth: 140 }}
            >
              {creating ? 'Creating...' : 'Create Tab'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Tabs Display */}
      <Card>
        <CardContent>
          <Typography variant="h5" component="h2" gutterBottom>
            Tabs ({tabs.length})
          </Typography>
          
          {tabs.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="text.secondary">
                No tabs found. Create your first tab above.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ mt: 2 }}>
              {tabs.map((tab, index) => (
                <Card 
                  key={tab.id}
                  variant="outlined"
                  sx={{ 
                    mb: 2,
                    borderColor: tab.id === activeTabId ? 'primary.main' : 'divider',
                    bgcolor: tab.id === activeTabId ? 'action.hover' : 'background.paper'
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box 
                          sx={{ 
                            width: 16, 
                            height: 16, 
                            borderRadius: '50%',
                            border: 1,
                            borderColor: 'divider',
                            bgcolor: tab.color
                          }}
                        />
                        <Box>
                          <Typography variant="h6" component="h3">
                            {tab.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            ID: {tab.id} | Tiles: {tab.tiles.length} | Layout: {tab.layout}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Created: {new Date(tab.created_at).toLocaleString()}
                          </Typography>
                        </Box>
                      </Box>
                      
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {tab.id === activeTabId && (
                          <Chip 
                            icon={<CheckCircleIcon />}
                            label="Active" 
                            color="primary" 
                            size="small" 
                          />
                        )}
                        
                        {/* Reorder buttons */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <IconButton
                            size="small"
                            onClick={() => handleReorderTab(index, index - 1)}
                            disabled={index === 0}
                          >
                            <ArrowUpIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleReorderTab(index, index + 1)}
                            disabled={index === tabs.length - 1}
                          >
                            <ArrowDownIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Groups Display */}
      {groups.length > 0 && (
        <Card sx={{ mt: 4 }}>
          <CardContent>
            <Typography variant="h5" component="h2" gutterBottom>
              Groups ({groups.length})
            </Typography>
            <Box sx={{ mt: 2 }}>
              {groups.map((group, index) => (
                <Card key={group.id} variant="outlined" sx={{ mb: 2 }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box 
                        sx={{ 
                          width: 16, 
                          height: 16, 
                          borderRadius: '50%',
                          border: 1,
                          borderColor: 'divider',
                          bgcolor: group.color
                        }}
                      />
                      <Box>
                        <Typography variant="h6" component="h3">
                          {group.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          ID: {group.id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Created: {new Date(group.created_at).toLocaleString()}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Debug Info */}
      <Card sx={{ mt: 4 }}>
        <CardContent>
          <Button
            onClick={() => setDebugOpen(!debugOpen)}
            startIcon={debugOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            variant="outlined"
            size="small"
          >
            Debug: Raw Dashboard Data
          </Button>
          <Collapse in={debugOpen}>
            <Box 
              component="pre" 
              sx={{ 
                mt: 2, 
                p: 2, 
                bgcolor: 'grey.100', 
                borderRadius: 1,
                fontSize: '0.75rem',
                overflow: 'auto',
                maxHeight: 400
              }}
            >
              {JSON.stringify(dashboard, null, 2)}
            </Box>
          </Collapse>
        </CardContent>
      </Card>
    </Container>
  );
};
