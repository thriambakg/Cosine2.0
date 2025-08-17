import React, { useState } from 'react';
import {
  Popover,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Typography,
  Box,
  Chip,
  Divider,
  IconButton,
  useTheme,
} from '@mui/material';
import {
  Notifications as NotificationIcon,
  Info as InfoIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  CheckCircle as SuccessIcon,
  Close as CloseIcon,
} from '@mui/icons-material';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: Date;
  read: boolean;
}

interface NotificationCenterProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const mockNotifications: Notification[] = [
  {
    id: '1',
    title: 'Portfolio Update',
    message: 'Your portfolio value has increased by 2.5% today',
    type: 'success',
    timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    read: false,
  },
  {
    id: '2',
    title: 'Stock Alert',
    message: 'AAPL has reached your target price of $150',
    type: 'info',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    read: false,
  },
  {
    id: '3',
    title: 'Market Warning',
    message: 'High volatility detected in crypto markets',
    type: 'warning',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4), // 4 hours ago
    read: true,
  },
  {
    id: '4',
    title: 'System Maintenance',
    message: 'Scheduled maintenance in 2 hours',
    type: 'info',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6), // 6 hours ago
    read: true,
  },
];

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'success':
      return <SuccessIcon color="success" />;
    case 'warning':
      return <WarningIcon color="warning" />;
    case 'error':
      return <ErrorIcon color="error" />;
    case 'info':
    default:
      return <InfoIcon color="info" />;
  }
};

const getNotificationColor = (type: Notification['type']) => {
  switch (type) {
    case 'success':
      return 'success.main';
    case 'warning':
      return 'warning.main';
    case 'error':
      return 'error.main';
    case 'info':
    default:
      return 'info.main';
  }
};

const formatTimestamp = (timestamp: Date) => {
  const now = new Date();
  const diff = now.getTime() - timestamp.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

export default function NotificationCenter({ anchorEl, onClose }: NotificationCenterProps) {
  const theme = useTheme();
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAsRead = (id: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const handleMarkAllAsRead = () => {
    setNotifications(prev => 
      prev.map(n => ({ ...n, read: true }))
    );
  };

  const handleDeleteNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'right',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
             PaperProps={{
         sx: {
           width: 400,
           maxHeight: 500,
           backgroundColor: 'rgba(15, 15, 20, 0.95)',
           backdropFilter: 'blur(20px)',
           border: '1px solid rgba(255, 255, 255, 0.1)',
           borderRadius: '8px',
           boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
         },
       }}
    >
             {/* Header */}
       <Box sx={{ p: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
         <Box display="flex" justifyContent="space-between" alignItems="center">
           <Typography variant="h6" fontWeight={700} sx={{ color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1px' }}>
             Notifications
           </Typography>
          <Box display="flex" gap={1}>
                         {unreadCount > 0 && (
               <Chip
                 label={`${unreadCount} unread`}
                 size="small"
                 sx={{ 
                   fontSize: '0.75rem',
                   backgroundColor: '#ff4757',
                   color: '#ffffff',
                   fontWeight: 600,
                   border: 'none',
                   '& .MuiChip-label': {
                     color: '#ffffff',
                   }
                 }}
               />
             )}
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        
                 {unreadCount > 0 && (
           <Typography
             variant="body2"
             sx={{ 
               cursor: 'pointer', 
               mt: 1, 
               color: '#3742fa',
               fontWeight: 500,
               '&:hover': { 
                 textDecoration: 'underline',
                 color: '#2ed573',
               } 
             }}
             onClick={handleMarkAllAsRead}
           >
             Mark all as read
           </Typography>
         )}
      </Box>

      {/* Notifications List */}
      <List sx={{ p: 0, maxHeight: 400, overflow: 'auto' }}>
        {notifications.length === 0 ? (
          <ListItem>
            <ListItemText
              primary={
                                 <Typography variant="body2" sx={{ color: '#8b8b8b', textAlign: 'center' }}>
                   No notifications
                 </Typography>
              }
            />
          </ListItem>
        ) : (
          notifications.map((notification, index) => (
            <React.Fragment key={notification.id}>
              <ListItem
                                 sx={{
                   backgroundColor: notification.read ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
                   '&:hover': {
                     backgroundColor: 'rgba(255, 255, 255, 0.1)',
                   },
                   position: 'relative',
                   borderRadius: '6px',
                   margin: '2px 8px',
                   transition: 'all 0.2s ease',
                 }}
                onClick={() => handleMarkAsRead(notification.id)}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {getNotificationIcon(notification.type)}
                </ListItemIcon>
                
                <ListItemText
                  primary={
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                                             <Typography
                         variant="body2"
                         fontWeight={notification.read ? 500 : 700}
                         sx={{ 
                           flex: 1,
                           color: notification.read ? '#8b8b8b' : '#ffffff',
                         }}
                       >
                         {notification.title}
                       </Typography>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNotification(notification.id);
                        }}
                        sx={{ ml: 1, opacity: 0.6, '&:hover': { opacity: 1 } }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  }
                  secondary={
                                         <Box>
                       <Typography variant="body2" sx={{ mt: 0.5, color: '#8b8b8b' }}>
                         {notification.message}
                       </Typography>
                       <Typography variant="caption" sx={{ mt: 0.5, display: 'block', color: '#666666' }}>
                         {formatTimestamp(notification.timestamp)}
                       </Typography>
                     </Box>
                  }
                />
                
                {!notification.read && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: getNotificationColor(notification.type),
                    }}
                  />
                )}
              </ListItem>
              
                             {index < notifications.length - 1 && (
                 <Divider sx={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', margin: '4px 16px' }} />
               )}
            </React.Fragment>
          ))
        )}
      </List>

      {/* Footer */}
      {notifications.length > 0 && (
                 <Box sx={{ p: 2, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
           <Typography
             variant="body2"
             textAlign="center"
             sx={{ 
               cursor: 'pointer', 
               color: '#3742fa',
               fontWeight: 500,
               '&:hover': { 
                 textDecoration: 'underline',
                 color: '#2ed573',
               } 
             }}
           >
             View all notifications
           </Typography>
         </Box>
      )}
    </Popover>
  );
}
