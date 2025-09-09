import React, { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Divider,
  Select,
  FormControl
} from '@mui/material';
import {
  Add as AddIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Group as GroupIcon,
  GroupRemove as UngroupIcon,
  PushPin as PinIcon,
  PushPinOutlined as UnpinIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon
} from '@mui/icons-material';
import { DashboardTab, DashboardGroup } from '../types/dashboardTypes';
import EditTabDialog from './EditTabDialog';
import EditGroupDialog from './EditGroupDialog';

interface DashboardTabBarProps {
  tabs: DashboardTab[];
  tabGroups: DashboardGroup[];
  activeTabId: string | null;
  onTabCreate: () => void;
  onTabClose: (tabId: string) => void;
  onTabActivate: (tabId: string) => void;
  onTabEdit: (tabId: string, newName: string, newColor?: string) => void;
  onTabGroup: (tabId: string, groupId: string) => void;
  onTabUngroup: (tabId: string) => void;
  onTabPin: (tabId: string) => void;
  onTabUnpin: (tabId: string) => void;
  onGroupCreate: () => void;
  onGroupEdit: (groupId: string, name: string, color: string) => void;
  onGroupDissolve: (groupId: string, deleteDashboards: boolean) => void;
  onTabReorder: (tabId: string, newPosition: number) => void;
  onGroupReorder: (groupId: string, newPosition: number) => void;
  getTabsByGroup: () => { groupedTabs: { [groupId: string]: DashboardTab[] }; ungroupedTabs: DashboardTab[] };
}

const DashboardTabBar: React.FC<DashboardTabBarProps> = ({
  tabs,
  tabGroups,
  activeTabId,
  onTabCreate,
  onTabClose,
  onTabActivate,
  onTabEdit,
  onTabGroup,
  onTabUngroup,
  onTabPin,
  onTabUnpin,
  onGroupCreate,
  onGroupEdit,
  onGroupDissolve,
  onTabReorder,
  onGroupReorder,
  getTabsByGroup
}) => {
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    tab: DashboardTab | null;
  } | null>(null);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<DashboardTab | null>(null);
  const [editGroupDialogOpen, setEditGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DashboardGroup | null>(null);
  const [groupSubmenu, setGroupSubmenu] = useState<{
    mouseX: number;
    mouseY: number;
    tab: DashboardTab | null;
  } | null>(null);

  const [groupContextMenu, setGroupContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    group: DashboardGroup | null;
  } | null>(null);

  // Drag and drop state
  const [draggedTab, setDraggedTab] = useState<DashboardTab | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<DashboardGroup | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  
  // Group expand/collapse state
  const [expandedGroups, setExpandedGroups] = useState<{ [groupId: string]: boolean }>({});


  const { groupedTabs, ungroupedTabs } = getTabsByGroup();

  const handleContextMenu = (event: React.MouseEvent, tab: DashboardTab) => {
    event.preventDefault();
    setContextMenu({
      mouseX: event.clientX - 2,
      mouseY: event.clientY - 6,
      tab
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
    setGroupSubmenu(null);
    setGroupContextMenu(null);
  };

  const handleEditTab = (tab: DashboardTab) => {
    setEditingTab(tab);
    setEditDialogOpen(true);
    handleCloseContextMenu();
  };

  const handleEditTabSubmit = (tabId: string, newName: string, newColor?: string) => {
    onTabEdit(tabId, newName, newColor);
    setEditDialogOpen(false);
    setEditingTab(null);
  };

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setEditingTab(null);
  };

  const handleEditGroup = (group: DashboardGroup) => {
    setEditingGroup(group);
    setEditGroupDialogOpen(true);
    handleCloseContextMenu();
  };

  const handleEditGroupSubmit = (groupId: string, name: string, color: string) => {
    onGroupEdit(groupId, name, color);
    setEditGroupDialogOpen(false);
    setEditingGroup(null);
  };

  const handleCloseEditGroupDialog = () => {
    setEditGroupDialogOpen(false);
    setEditingGroup(null);
  };

  const handleToggleGroupExpand = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const handleOpenGroupSubmenu = (event: React.MouseEvent, tab: DashboardTab) => {
    event.stopPropagation();
    setGroupSubmenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      tab
    });
  };

  const handleCloseGroupSubmenu = () => {
    setGroupSubmenu(null);
  };

  const handleGroupContextMenu = (event: React.MouseEvent, group: DashboardGroup) => {
    event.preventDefault();
    setGroupContextMenu({
      mouseX: event.clientX - 2,
      mouseY: event.clientY - 6,
      group
    });
  };

  // Drag and drop handlers
  const handleTabDragStart = (event: React.DragEvent, tab: DashboardTab) => {
    setDraggedTab(tab);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleGroupDragStart = (event: React.DragEvent, group: DashboardGroup) => {
    setDraggedGroup(group);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleTabDragOver = (event: React.DragEvent, tabId: string) => {
    event.preventDefault();
    setDragOverTab(tabId);
  };

  const handleGroupDragOver = (event: React.DragEvent, groupId: string) => {
    event.preventDefault();
    setDragOverGroup(groupId);
  };

  const handleDragLeave = () => {
    setDragOverTab(null);
    setDragOverGroup(null);
  };

  const handleTabDrop = (event: React.DragEvent, targetTabId: string) => {
    event.preventDefault();
    
    if (draggedTab && draggedTab.id !== targetTabId) {
      const targetTab = tabs.find(tab => tab.id === targetTabId);
      if (targetTab) {
        // Only allow reordering within the same category (both ungrouped or both in same group)
        const draggedTabGroup = draggedTab.groupId;
        const targetTabGroup = targetTab.groupId;
        
        if (draggedTabGroup === targetTabGroup) {
          onTabReorder(draggedTab.id, targetTab.position);
        }
      }
    }
    
    setDraggedTab(null);
    setDragOverTab(null);
  };

  const handleGroupDrop = (event: React.DragEvent, targetGroupId: string) => {
    event.preventDefault();
    
    if (draggedGroup && draggedGroup.id !== targetGroupId) {
      const targetGroup = tabGroups.find(group => group.id === targetGroupId);
      if (targetGroup) {
        onGroupReorder(draggedGroup.id, targetGroup.position);
      }
    }
    
    setDraggedGroup(null);
    setDragOverGroup(null);
  };

  const handleDragEnd = () => {
    setDraggedTab(null);
    setDraggedGroup(null);
    setDragOverTab(null);
    setDragOverGroup(null);
  };

  // Group dropdown handlers
  const handleGroupTabSelect = (tabId: string) => {
    if (tabId) {
      onTabActivate(tabId);
    }
  };

  const renderTab = (tab: DashboardTab) => {
    const isActive = tab.id === activeTabId;

    return (
      <Box
        key={tab.id}
        draggable
        onDragStart={(e) => handleTabDragStart(e, tab)}
        onDragOver={(e) => handleTabDragOver(e, tab.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleTabDrop(e, tab.id)}
        onDragEnd={handleDragEnd}
        sx={{
          display: 'flex',
          alignItems: 'center',
          minWidth: '200px',
          maxWidth: '300px',
          height: '40px',
          backgroundColor: isActive ? '#1e293b' : 'transparent',
          borderBottom: isActive ? 'none' : '1px solid #374151',
          cursor: 'grab',
          position: 'relative',
          opacity: draggedTab?.id === tab.id ? 0.5 : 1,
          borderLeft: dragOverTab === tab.id ? '3px solid #f59e0b' : 'none',
          '&:hover': {
            backgroundColor: isActive ? '#1e293b' : 'rgba(30, 41, 59, 0.5)'
          },
          '&:active': {
            cursor: 'grabbing'
          },
          '&:focus': {
            outline: 'none'
          },
          outline: 'none'
        }}
        onClick={() => onTabActivate(tab.id)}
        onContextMenu={(e) => handleContextMenu(e, tab)}
      >
        {/* Color indicator - solid line */}
        {tab.color && (
          <Box
            sx={{
              width: 3,
              height: 20,
              backgroundColor: tab.color,
              ml: 1,
              mr: 0.5
            }}
          />
        )}

        {/* Pin indicator */}
        {tab.isPinned && (
          <PinIcon sx={{ 
            fontSize: 12, 
            color: '#f59e0b', 
            ml: tab.color ? 0.5 : 1,
            mr: 0.5 
          }} />
        )}

        {/* Tab content */}
        <Box sx={{ flex: 1, px: 2, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              color: isActive ? '#ffffff' : '#9ca3af',
              fontWeight: isActive ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.name}
          </Typography>
        </Box>

        {/* Close button */}
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onTabClose(tab.id);
          }}
          sx={{
            color: '#9ca3af',
            '&:hover': {
              color: '#ffffff',
              backgroundColor: 'rgba(239, 68, 68, 0.1)'
            }
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  };

  const renderGroup = (group: DashboardGroup) => {
    const groupTabs = groupedTabs[group.id] || [];
    const isExpanded = expandedGroups[group.id] || false;
    const activeTabInGroup = groupTabs.find(tab => tab.id === activeTabId);
    
    if (isExpanded) {
      // Show individual tabs when expanded
      return (
        <Box key={group.id} sx={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          {/* Group header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              minWidth: '200px',
              maxWidth: '300px',
              height: '40px',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '4px',
              color: group.color,
              fontWeight: 600,
              opacity: draggedGroup?.id === group.id ? 0.5 : 1,
              borderLeft: dragOverGroup === group.id ? '3px solid #3b82f6' : 'none',
              cursor: 'grab',
              px: 2,
              '&:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.2)'
              },
              '&:active': {
                cursor: 'grabbing'
              }
            }}
            draggable
            onDragStart={(e) => handleGroupDragStart(e, group)}
            onDragOver={(e) => handleGroupDragOver(e, group.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleGroupDrop(e, group.id)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => handleGroupContextMenu(e, group)}
            onClick={() => handleToggleGroupExpand(group.id)}
          >
            <Box
              sx={{
                width: 3,
                height: 20,
                backgroundColor: group.color,
                mr: 1
              }}
            />
            <Typography variant="body2" sx={{ color: group.color, fontWeight: 600, mr: 1 }}>
              {group.name}
            </Typography>
            <Chip
              label={groupTabs.length}
              size="small"
              sx={{
                height: 16,
                fontSize: '0.75rem',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: group.color
              }}
            />
          </Box>
          
          {/* Individual tabs */}
          {groupTabs.map(tab => renderTab(tab))}
        </Box>
      );
    }

    // Show dropdown when collapsed
    return (
      <Box key={group.id} sx={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
        {/* Group dropdown */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select
            value={activeTabInGroup?.id || ''}
            onChange={(e) => handleGroupTabSelect(e.target.value)}
            displayEmpty
            draggable
            onDragStart={(e) => handleGroupDragStart(e, group)}
            onDragOver={(e) => handleGroupDragOver(e, group.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleGroupDrop(e, group.id)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => handleGroupContextMenu(e, group)}
            sx={{
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '4px',
              color: group.color,
              fontWeight: 600,
              opacity: draggedGroup?.id === group.id ? 0.5 : 1,
              borderLeft: dragOverGroup === group.id ? '3px solid #3b82f6' : 'none',
              cursor: 'grab',
              '&:hover': {
                backgroundColor: 'rgba(59, 130, 246, 0.2)'
              },
              '&:active': {
                cursor: 'grabbing'
              },
              '& .MuiSelect-select': {
                display: 'flex',
                alignItems: 'center',
                py: 0.5,
                px: 1
              },
              '& .MuiOutlinedInput-notchedOutline': {
                border: 'none'
              },
              '& .MuiSvgIcon-root': {
                color: group.color
              }
            }}
            MenuProps={{
              PaperProps: {
                sx: {
                  backgroundColor: '#1e293b',
                  border: '1px solid #374151',
                  color: '#ffffff',
                  maxHeight: 300
                }
              }
            }}
          >
            {/* Group header option */}
            <MenuItem value="" disabled>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <Box
                  sx={{
                    width: 3,
                    height: 20,
                    backgroundColor: group.color,
                    mr: 1
                  }}
                />
                <Typography variant="body2" sx={{ color: group.color, fontWeight: 600, mr: 1 }}>
                  {group.name}
                </Typography>
                <Chip
                  label={groupTabs.length}
                  size="small"
                  sx={{
                    height: 16,
                    fontSize: '0.75rem',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    color: group.color
                  }}
                />
              </Box>
            </MenuItem>
            
            {/* Group tabs */}
            {groupTabs.map(tab => (
              <MenuItem 
                key={tab.id} 
                value={tab.id}
                sx={{
                  backgroundColor: tab.id === activeTabId ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                  '&:hover': {
                    backgroundColor: tab.id === activeTabId ? 'rgba(245, 158, 11, 0.3)' : 'rgba(59, 130, 246, 0.1)'
                  }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  {/* Pin indicator */}
                  {tab.isPinned && (
                    <PinIcon sx={{ 
                      fontSize: 12, 
                      color: '#f59e0b', 
                      mr: 0.5 
                    }} />
                  )}
                  
                  <Typography
                    variant="body2"
                    sx={{
                      color: tab.id === activeTabId ? '#f59e0b' : '#ffffff',
                      fontWeight: tab.id === activeTabId ? 600 : 400,
                      flex: 1
                    }}
                  >
                    {tab.name}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    );
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #374151',
        minHeight: '40px',
        overflowX: 'auto',
        overflowY: 'hidden',
        '&::-webkit-scrollbar': {
          height: '6px'
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: '#1e293b'
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: '#374151',
          borderRadius: '3px',
          '&:hover': {
            backgroundColor: '#4b5563'
          }
        }
      }}
    >
      {/* Tab groups */}
      {tabGroups.map(group => renderGroup(group))}

      {/* Divider between groups and ungrouped tabs */}
      {tabGroups.length > 0 && ungroupedTabs.length > 0 && (
        <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: '#374151' }} />
      )}

      {/* Ungrouped tabs */}
      {ungroupedTabs.map(tab => renderTab(tab))}

      {/* Add tab button */}
      <IconButton
        onClick={onTabCreate}
        sx={{
          color: '#9ca3af',
          '&:hover': {
            color: '#ffffff',
            backgroundColor: 'rgba(59, 130, 246, 0.1)'
          }
        }}
      >
        <AddIcon />
      </IconButton>

      {/* Add group button */}
      <IconButton
        onClick={onGroupCreate}
        sx={{
          color: '#9ca3af',
          '&:hover': {
            color: '#ffffff',
            backgroundColor: 'rgba(59, 130, 246, 0.1)'
          }
        }}
      >
        <GroupIcon />
      </IconButton>

      {/* Tab Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        PaperProps={{
          sx: {
            backgroundColor: '#1e293b',
            border: '1px solid #374151',
            color: '#ffffff'
          }
        }}
      >
        {contextMenu?.tab && (
          <>
            <MenuItem onClick={() => handleEditTab(contextMenu.tab!)}>
              <ListItemIcon>
                <EditIcon sx={{ color: '#9ca3af' }} />
              </ListItemIcon>
              <ListItemText>Edit Tab</ListItemText>
            </MenuItem>

            <MenuItem onClick={() => {
              if (contextMenu.tab!.isPinned) {
                onTabUnpin(contextMenu.tab!.id);
              } else {
                onTabPin(contextMenu.tab!.id);
              }
              handleCloseContextMenu();
            }}>
              <ListItemIcon>
                {contextMenu.tab!.isPinned ? (
                  <UnpinIcon sx={{ color: '#9ca3af' }} />
                ) : (
                  <PinIcon sx={{ color: '#9ca3af' }} />
                )}
              </ListItemIcon>
              <ListItemText>
                {contextMenu.tab!.isPinned ? 'Unpin Tab' : 'Pin Tab'}
              </ListItemText>
            </MenuItem>

            <MenuItem onClick={(e) => handleOpenGroupSubmenu(e, contextMenu.tab!)}>
              <ListItemIcon>
                <GroupIcon sx={{ color: '#9ca3af' }} />
              </ListItemIcon>
              <ListItemText>Add to Group</ListItemText>
            </MenuItem>

            {contextMenu.tab!.groupId && (
              <MenuItem onClick={() => {
                onTabUngroup(contextMenu.tab!.id);
                handleCloseContextMenu();
              }}>
                <ListItemIcon>
                  <UngroupIcon sx={{ color: '#9ca3af' }} />
                </ListItemIcon>
                <ListItemText>Remove from Group</ListItemText>
              </MenuItem>
            )}

            <Divider sx={{ borderColor: '#374151' }} />

            <MenuItem 
              onClick={() => onTabClose(contextMenu.tab!.id)}
              sx={{ color: '#ef4444' }}
            >
              <ListItemIcon>
                <CloseIcon sx={{ color: '#ef4444' }} />
              </ListItemIcon>
              <ListItemText>Close Tab</ListItemText>
            </MenuItem>
          </>
        )}
      </Menu>

      {/* Group Submenu */}
      <Menu
        open={groupSubmenu !== null}
        onClose={handleCloseGroupSubmenu}
        anchorReference="anchorPosition"
        anchorPosition={
          groupSubmenu !== null
            ? { top: groupSubmenu.mouseY, left: groupSubmenu.mouseX }
            : undefined
        }
        PaperProps={{
          sx: {
            backgroundColor: '#1e293b',
            border: '1px solid #374151',
            color: '#ffffff'
          }
        }}
      >
        {groupSubmenu?.tab && (
          <>
            <MenuItem onClick={() => {
              onTabUngroup(groupSubmenu.tab!.id);
              handleCloseContextMenu();
            }}>
              <ListItemIcon>
                <UngroupIcon sx={{ color: '#9ca3af' }} />
              </ListItemIcon>
              <ListItemText>No Group</ListItemText>
            </MenuItem>
            {tabGroups.map(group => (
              <MenuItem 
                key={group.id}
                onClick={() => {
                  onTabGroup(groupSubmenu.tab!.id, group.id);
                  handleCloseContextMenu();
                }}
              >
                <ListItemIcon>
                  <Box
                    sx={{
                      width: 3,
                      height: 20,
                      backgroundColor: group.color
                    }}
                  />
                </ListItemIcon>
                <ListItemText>
                  {group.name}
                  {groupSubmenu.tab!.groupId === group.id && (
                    <Typography variant="caption" sx={{ color: '#9ca3af', ml: 1 }}>
                      (Current)
                    </Typography>
                  )}
                </ListItemText>
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      {/* Group Context Menu */}
      <Menu
        open={groupContextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          groupContextMenu !== null
            ? { top: groupContextMenu.mouseY, left: groupContextMenu.mouseX }
            : undefined
        }
        PaperProps={{
          sx: {
            backgroundColor: '#1e293b',
            border: '1px solid #374151',
            color: '#ffffff'
          }
        }}
      >
        {groupContextMenu?.group && (
          <>
            <MenuItem onClick={() => handleEditGroup(groupContextMenu.group!)}>
              <ListItemIcon>
                <EditIcon sx={{ color: '#9ca3af' }} />
              </ListItemIcon>
              <ListItemText>Edit Group</ListItemText>
            </MenuItem>

            <MenuItem onClick={() => {
              handleToggleGroupExpand(groupContextMenu.group!.id);
              handleCloseContextMenu();
            }}>
              <ListItemIcon>
                {expandedGroups[groupContextMenu.group!.id] ? (
                  <FolderIcon sx={{ color: '#9ca3af' }} />
                ) : (
                  <FolderOpenIcon sx={{ color: '#9ca3af' }} />
                )}
              </ListItemIcon>
              <ListItemText>
                {expandedGroups[groupContextMenu.group!.id] ? 'Collapse Group' : 'Expand Group'}
              </ListItemText>
            </MenuItem>

            <MenuItem onClick={() => {
              onGroupDissolve(groupContextMenu.group!.id, false);
              handleCloseContextMenu();
            }}>
              <ListItemIcon>
                <UngroupIcon sx={{ color: '#9ca3af' }} />
              </ListItemIcon>
              <ListItemText>Ungroup All Tabs</ListItemText>
            </MenuItem>

            <MenuItem onClick={() => {
              onGroupDissolve(groupContextMenu.group!.id, true);
              handleCloseContextMenu();
            }} sx={{ color: '#ef4444' }}>
              <ListItemIcon>
                <CloseIcon sx={{ color: '#ef4444' }} />
              </ListItemIcon>
              <ListItemText>Delete Group & All Dashboards</ListItemText>
            </MenuItem>
          </>
        )}
      </Menu>

      {/* Edit Tab Dialog */}
      <EditTabDialog
        open={editDialogOpen}
        onClose={handleCloseEditDialog}
        onEditTab={handleEditTabSubmit}
        tab={editingTab}
      />

      {/* Edit Group Dialog */}
      <EditGroupDialog
        open={editGroupDialogOpen}
        onClose={handleCloseEditGroupDialog}
        onEditGroup={handleEditGroupSubmit}
        group={editingGroup}
      />
    </Box>
  );
};

export default DashboardTabBar;
