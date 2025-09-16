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
  FolderOpen as FolderOpenIcon,
  DragIndicator as DragIcon
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
  onTabMoveToGroup: (tabId: string, groupId: string) => void;
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
  onTabMoveToGroup,
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
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{ index: number; type: 'before' | 'after' } | null>(null);

  
  // Group expand/collapse state
  const [expandedGroups, setExpandedGroups] = useState<{ [groupId: string]: boolean }>({});


  const { groupedTabs, ungroupedTabs } = getTabsByGroup();

  // Debug current drag state
  console.log('🔍 Current drag state:', { 
    draggedTab: draggedTab?.id, 
    draggedGroup: draggedGroup?.id,
    dragPreviewPosition,
    totalTabs: tabs.length,
    ungroupedTabsCount: ungroupedTabs.length
  });

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
    console.log('🔄 handleTabDragStart called for tab:', tab.id);
    setDraggedTab(tab);
    setDragPreviewPosition(null); // Clear any existing preview position
    event.dataTransfer.effectAllowed = 'move';
    // Set drag data for consistency
    event.dataTransfer.setData('text/plain', tab.id);
    event.dataTransfer.setData('application/tab', JSON.stringify(tab));
  };

  const handleGroupDragStart = (event: React.DragEvent, group: DashboardGroup) => {
    setDraggedGroup(group);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleTabDragOver = (event: React.DragEvent, tabId: string) => {
    event.preventDefault();
    setDragOverTab(tabId);
    
    if (draggedTab && draggedTab.id !== tabId) {
      // Calculate preview position based on mouse position relative to tab
      const tabElement = event.currentTarget as HTMLElement;
      const rect = tabElement.getBoundingClientRect();
      const mouseX = event.clientX;
      const tabCenterX = rect.left + rect.width / 2;
      
      // Determine if drop should be before or after the tab
      const shouldDropBefore = mouseX < tabCenterX;
      
      // Find the index of the target tab
      const targetTabIndex = tabs.findIndex(tab => tab.id === tabId);
      if (targetTabIndex !== -1) {
        const previewPos = {
          index: shouldDropBefore ? targetTabIndex : targetTabIndex + 1,
          type: (shouldDropBefore ? 'before' : 'after') as 'before' | 'after'
        };
        console.log('🎯 Tab drag over:', { 
          draggedTab: draggedTab.id, 
          targetTab: tabId, 
          targetIndex: targetTabIndex,
          mouseX, 
          tabCenterX, 
          shouldDropBefore, 
          previewPos 
        });
        setDragPreviewPosition(previewPos);
      }
    }
  };

  const handleGroupDragOver = (event: React.DragEvent, groupId: string) => {
    event.preventDefault();
    setDragOverGroup(groupId);
    
    if (draggedGroup && draggedGroup.id !== groupId) {
      // Calculate preview position based on mouse position relative to group
      const groupElement = event.currentTarget as HTMLElement;
      const rect = groupElement.getBoundingClientRect();
      const mouseX = event.clientX;
      const groupCenterX = rect.left + rect.width / 2;
      
      // Determine if drop should be before or after the group
      const shouldDropBefore = mouseX < groupCenterX;
      
      // Find the index of the target group
      const targetGroupIndex = tabGroups.findIndex(group => group.id === groupId);
      if (targetGroupIndex !== -1) {
        setDragPreviewPosition({
          index: shouldDropBefore ? targetGroupIndex : targetGroupIndex + 1,
          type: shouldDropBefore ? 'before' : 'after'
        });
      }
    }
  };

  const handleDragLeave = () => {
    setDragOverTab(null);
    setDragOverGroup(null);
    setDragPreviewPosition(null);
  };

  const handleTabDrop = (event: React.DragEvent, targetTabId: string) => {
    event.preventDefault();
    
    if (draggedTab && draggedTab.id !== targetTabId && dragPreviewPosition) {
      // Use the preview position for accurate drop placement
      onTabReorder(draggedTab.id, dragPreviewPosition.index);
    }
    
    setDraggedTab(null);
    setDragOverTab(null);
    setDragPreviewPosition(null);
  };

  const handleGroupDrop = (event: React.DragEvent, targetGroupId: string) => {
    event.preventDefault();
    
    console.log('🔄 handleGroupDrop called with:', { draggedTab: draggedTab?.id, draggedGroup: draggedGroup?.id, targetGroupId });
    
    if (draggedTab) {
      // Handle tab being dropped into a group
      console.log(`🔄 Adding tab ${draggedTab.id} to group ${targetGroupId}`);
      onTabGroup(draggedTab.id, targetGroupId);
    } else if (draggedGroup && draggedGroup.id !== targetGroupId && dragPreviewPosition) {
      // Handle group being dropped onto another group (reordering) using preview position
      onGroupReorder(draggedGroup.id, dragPreviewPosition.index);
    }
    
    setDraggedTab(null);
    setDraggedGroup(null);
    setDragOverTab(null);
    setDragOverGroup(null);
    setDragPreviewPosition(null);
  };

  const handleDragEnd = () => {
    setDraggedTab(null);
    setDraggedGroup(null);
    setDragOverTab(null);
    setDragOverGroup(null);
    setDragPreviewPosition(null);
  };

  // Group dropdown handlers
  const handleGroupTabSelect = (tabId: string) => {
    if (tabId) {
      onTabActivate(tabId);
    }
  };

  // Function to render drag preview line
  const renderDragPreviewLine = (index: number) => {
    if (!dragPreviewPosition || dragPreviewPosition.index !== index) return null;
    
    console.log('🎨 Rendering preview line:', { 
      index, 
      dragPreviewPosition, 
      shouldRender: dragPreviewPosition.index === index 
    });
    
    return (
      <Box
        key={`preview-${index}`}
        sx={{
          position: 'absolute',
          top: '50%',
          left: dragPreviewPosition.type === 'before' ? '-2px' : 'auto',
          right: dragPreviewPosition.type === 'after' ? '-2px' : 'auto',
          width: '4px',
          height: '24px',
          transform: 'translateY(-50%)',
          backgroundColor: '#f59e0b',
          zIndex: 1000,
          pointerEvents: 'none',
          borderRadius: '2px',
          boxShadow: '0 0 8px rgba(245, 158, 11, 0.6)'
        }}
      />
    );
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
              backgroundColor: dragOverGroup === group.id && draggedTab ? 
                'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '4px',
              color: group.color,
              fontWeight: 600,
              opacity: draggedGroup?.id === group.id ? 0.5 : 1,
              borderLeft: dragOverGroup === group.id ? 
                (draggedTab ? '3px solid #10b981' : '3px solid #3b82f6') : 'none',
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
          {groupTabs.map((tab, index) => (
            <React.Fragment key={tab.id}>
              {dragPreviewPosition?.index === index && dragPreviewPosition?.type === 'before' && renderDragPreviewLine(index)}
              {renderTab(tab)}
              {dragPreviewPosition?.index === index + 1 && dragPreviewPosition?.type === 'after' && renderDragPreviewLine(index + 1)}
            </React.Fragment>
          ))}
        </Box>
      );
    }

    // Show dropdown when collapsed
    return (
      <Box key={group.id} sx={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
        {/* Group dropdown */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select
            value={(() => {
              // Only use the active tab ID if it exists in the current group's tabs
              const validTabIds = groupTabs.map(tab => tab.id);
              return activeTabInGroup && validTabIds.includes(activeTabInGroup.id) ? activeTabInGroup.id : '';
            })()}
            onChange={(e) => handleGroupTabSelect(e.target.value)}
            displayEmpty
            renderValue={() => (
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {/* Color indicator - solid line */}
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
                    fontSize: '0.7rem',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    color: '#60a5fa',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    '& .MuiChip-label': {
                      px: 1
                    }
                  }}
                />
              </Box>
            )}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              handleGroupDragStart(e, group);
            }}
            onDragOver={(e) => handleGroupDragOver(e, group.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleGroupDrop(e, group.id)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => handleGroupContextMenu(e, group)}
            sx={{
              backgroundColor: dragOverGroup === group.id && draggedTab ? 
                'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '4px',
              color: group.color,
              fontWeight: 600,
              opacity: draggedGroup?.id === group.id ? 0.5 : 1,
              borderLeft: dragOverGroup === group.id ? 
                (draggedTab ? '3px solid #10b981' : '3px solid #3b82f6') : 'none',
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
                px: 1,
                cursor: 'grab',
                '&:active': {
                  cursor: 'grabbing'
                }
              },
              '& .MuiOutlinedInput-notchedOutline': {
                border: 'none'
              },
              '& .MuiSvgIcon-root': {
                color: group.color,
                cursor: 'grab',
                '&:active': {
                  cursor: 'grabbing'
                }
              }
            }}
            IconComponent={() => (
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <DragIcon 
                  sx={{ 
                    color: group.color, 
                    fontSize: 16, 
                    mr: 0.5,
                    cursor: 'grab',
                    '&:active': { cursor: 'grabbing' }
                  }} 
                />
                <Box sx={{ 
                  width: 0, 
                  height: 0, 
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderTop: `4px solid ${group.color}`,
                  ml: 0.5
                }} />
              </Box>
            )}
            MenuProps={{
              PaperProps: {
                sx: {
                  backgroundColor: '#1e293b',
                  border: '1px solid #374151',
                  color: '#ffffff',
                  maxHeight: 300
                },
                onDragOver: (e: React.DragEvent) => e.preventDefault(), // Allow drag over
                onDrop: (e: React.DragEvent) => e.preventDefault() // Prevent default drop behavior
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
            
            {/* Group tabs - render as MenuItems with proper values but tab-like styling */}
            {groupTabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              return (
                <React.Fragment key={tab.id}>
                  {dragPreviewPosition?.index === index && dragPreviewPosition?.type === 'before' && renderDragPreviewLine(index)}
                  <MenuItem 
                    value={tab.id}
                    draggable
                    onDragStart={(e) => {
                      console.log('🔄 Dropdown tab drag start:', tab.id);
                      e.stopPropagation(); // Prevent group context menu
                      // Set drag data to ensure it's available outside the Select component
                      e.dataTransfer.setData('text/plain', tab.id);
                      e.dataTransfer.setData('application/tab', JSON.stringify(tab));
                      handleTabDragStart(e, tab);
                    }}
                    onDragOver={(e) => {
                      e.stopPropagation(); // Prevent group context menu
                      handleTabDragOver(e, tab.id);
                    }}
                    onDrop={(e) => {
                      e.stopPropagation(); // Prevent group context menu
                      handleTabDrop(e, tab.id);
                    }}
                    onDragEnd={handleDragEnd}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      minWidth: '180px',
                      maxWidth: '220px',
                      height: '32px', // Scaled down from 40px
                      backgroundColor: isActive ? '#1e293b' : 'transparent',
                      borderBottom: isActive ? 'none' : '1px solid #374151',
                      cursor: 'grab',
                      position: 'relative',
                      opacity: draggedTab?.id === tab.id ? 0.5 : 1,
                      borderLeft: dragOverTab === tab.id ? '3px solid #f59e0b' : 'none',
                      margin: '1px 0',
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
                    onContextMenu={(e) => {
                      e.stopPropagation(); // Prevent group context menu
                      handleContextMenu(e, tab);
                    }}
                  >
                    {/* Color indicator - solid line (scaled down) */}
                    {tab.color && (
                      <Box
                        sx={{
                          width: 2, // Scaled down from 3px
                          height: 16, // Scaled down from 20px
                          backgroundColor: tab.color,
                          ml: 0.5, // Scaled down from 1
                          mr: 0.25 // Scaled down from 0.5
                        }}
                      />
                    )}

                    {/* Pin indicator */}
                    {tab.isPinned && (
                      <PinIcon sx={{ 
                        fontSize: 10, // Scaled down from 12
                        color: '#f59e0b', 
                        ml: tab.color ? 0.25 : 0.5, // Scaled down
                        mr: 0.25 // Scaled down from 0.5
                      }} />
                    )}

                    {/* Tab content */}
                    <Box sx={{ flex: 1, px: 1, minWidth: 0 }}> {/* Scaled down padding */}
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '0.75rem', // Scaled down font size
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
                        padding: '2px', // Scaled down padding
                        '&:hover': {
                          color: '#ffffff',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)'
                        }
                      }}
                    >
                      <CloseIcon sx={{ fontSize: 12 }} /> {/* Scaled down from small */}
                    </IconButton>
                  </MenuItem>
                  {dragPreviewPosition?.index === index + 1 && dragPreviewPosition?.type === 'after' && renderDragPreviewLine(index + 1)}
                </React.Fragment>
              );
            })}
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
      onDragOver={(e) => {
        // Allow drag over the entire tab bar area
        e.preventDefault();
      }}
      onDrop={(e) => {
        // Handle drops on the main tab bar area
        e.preventDefault();
        console.log('🔄 Drop on main tab bar area');
      }}
    >
      {/* Tab groups */}
      {tabGroups.map((group, index) => (
        <React.Fragment key={group.id}>
          {dragPreviewPosition?.index === index && dragPreviewPosition?.type === 'before' && renderDragPreviewLine(index)}
          {renderGroup(group)}
          {dragPreviewPosition?.index === index + 1 && dragPreviewPosition?.type === 'after' && renderDragPreviewLine(index + 1)}
        </React.Fragment>
      ))}

      {/* Divider between groups and ungrouped tabs */}
      {tabGroups.length > 0 && ungroupedTabs.length > 0 && (
        <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: '#374151' }} />
      )}

      {/* Ungrouped tabs with drop zone */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          minHeight: '40px',
          backgroundColor: dragOverTab === 'ungrouped-area' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
          borderLeft: dragOverTab === 'ungrouped-area' ? '3px solid #3b82f6' : 'none',
          px: dragOverTab === 'ungrouped-area' ? 1 : 0,
          transition: 'all 0.2s ease',
          position: 'relative'
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverTab('ungrouped-area');
        }}
        onDragLeave={() => {
          setDragOverTab(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (draggedTab) {
            console.log('🔄 Dropping tab in ungrouped area:', draggedTab.id);
            onTabUngroup(draggedTab.id);
          }
          setDragOverTab(null);
          setDraggedTab(null);
        }}
      >
        {ungroupedTabs.map((tab, index) => (
          <React.Fragment key={tab.id}>
            {dragPreviewPosition?.index === index && dragPreviewPosition?.type === 'before' && renderDragPreviewLine(index)}
            {renderTab(tab)}
            {dragPreviewPosition?.index === index + 1 && dragPreviewPosition?.type === 'after' && renderDragPreviewLine(index + 1)}
          </React.Fragment>
        ))}
      </Box>

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

            {/* Show "Remove from Group" if tab is in a group */}
            {(() => {
              const tabInGroup = tabGroups.find(group => 
                (group.tabs || group.tabIds || []).includes(contextMenu?.tab?.id || '')
              );
              return tabInGroup ? (
                <MenuItem onClick={() => {
                  onTabUngroup(contextMenu?.tab?.id || '');
                  handleCloseContextMenu();
                }}>
                  <ListItemIcon>
                    <UngroupIcon sx={{ color: '#9ca3af' }} />
                  </ListItemIcon>
                  <ListItemText>Remove from Group</ListItemText>
                </MenuItem>
              ) : null;
            })()}

            {/* Show "Add to Group" or "Switch Group" submenu */}
            {(() => {
              const currentGroup = tabGroups.find(group => 
                (group.tabs || group.tabIds || []).includes(contextMenu?.tab?.id || '')
              );
              const isInGroup = !!currentGroup;
              const hasOtherGroups = tabGroups.length > (isInGroup ? 1 : 0);
              
              return hasOtherGroups ? (
                <MenuItem onClick={(e) => handleOpenGroupSubmenu(e, contextMenu.tab!)}>
                  <ListItemIcon>
                    <GroupIcon sx={{ color: '#9ca3af' }} />
                  </ListItemIcon>
                  <ListItemText>{isInGroup ? 'Switch Group' : 'Add to Group'}</ListItemText>
                </MenuItem>
              ) : null;
            })()}

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
            {/* Show "Remove from Group" option if tab is currently in a group */}
            {(() => {
              const currentGroup = tabGroups.find(group => 
                (group.tabs || group.tabIds || []).includes(groupSubmenu.tab!.id)
              );
              return currentGroup ? (
                <MenuItem onClick={() => {
                  onTabUngroup(groupSubmenu.tab!.id);
                  handleCloseContextMenu();
                }}>
                  <ListItemIcon>
                    <UngroupIcon sx={{ color: '#9ca3af' }} />
                  </ListItemIcon>
                  <ListItemText>Remove from Group</ListItemText>
                </MenuItem>
              ) : null;
            })()}

            {/* Show all groups for adding/switching */}
            {tabGroups.map(group => {
              const currentGroup = tabGroups.find(g => 
                (g.tabs || g.tabIds || []).includes(groupSubmenu.tab!.id)
              );
              const isCurrentGroup = currentGroup?.id === group.id;
              
              return (
                <MenuItem 
                  key={group.id}
                  onClick={() => {
                    if (currentGroup && !isCurrentGroup) {
                      // Switch to different group
                      onTabMoveToGroup(groupSubmenu.tab!.id, group.id);
                    } else if (!currentGroup) {
                      // Add to group
                      onTabGroup(groupSubmenu.tab!.id, group.id);
                    }
                    handleCloseContextMenu();
                  }}
                  disabled={isCurrentGroup}
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
                    {isCurrentGroup && (
                      <Typography variant="caption" sx={{ color: '#9ca3af', ml: 1 }}>
                        (Current)
                      </Typography>
                    )}
                  </ListItemText>
                </MenuItem>
              );
            })}
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
