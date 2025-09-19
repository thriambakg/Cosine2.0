import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  FormControlLabel,
  Switch,
  Tooltip,
  Chip,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  AccessTime as ClockIcon,
  DragIndicator as DragIcon,
} from '@mui/icons-material';

interface FloatingClockProps {
  className?: string;
  isVisible?: boolean;
}

const FloatingClock: React.FC<FloatingClockProps> = ({ 
  className, 
  isVisible: externalIsVisible
}) => {
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [selectedTimezone, setSelectedTimezone] = useState<string>(() => {
    const saved = sessionStorage.getItem('floating-clock-timezone');
    return saved || 'local';
  });
  const [useMilitaryTime, setUseMilitaryTime] = useState<boolean>(() => {
    const saved = sessionStorage.getItem('floating-clock-military-time');
    return saved ? JSON.parse(saved) : false;
  });
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  
  // Use external visibility control if provided, otherwise use internal state
  const [internalIsVisible, setInternalIsVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem('floating-clock-visible');
    return saved ? JSON.parse(saved) : false; // Default to hidden
  });
  
  const isVisible = externalIsVisible !== undefined ? externalIsVisible : internalIsVisible;
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    // Use sessionStorage for session-based persistence (resets on logout/browser close)
    const saved = sessionStorage.getItem('floating-clock-position');
    return saved ? JSON.parse(saved) : { x: 24, y: 24 };
  });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isForeground, setIsForeground] = useState<boolean>(false);
  const clockRef = useRef<HTMLDivElement>(null);

  // Common timezones
  const timezones = [
    { value: 'local', label: 'Local Time' },
    { value: 'UTC', label: 'UTC' },
    { value: 'America/New_York', label: 'Eastern Time' },
    { value: 'America/Chicago', label: 'Central Time' },
    { value: 'America/Denver', label: 'Mountain Time' },
    { value: 'America/Los_Angeles', label: 'Pacific Time' },
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Paris' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Asia/Shanghai', label: 'Shanghai' },
    { value: 'Australia/Sydney', label: 'Sydney' },
  ];

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleSettingsClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleSettingsClose = () => {
    setAnchorEl(null);
  };

  const handleTimezoneChange = (timezone: string) => {
    setSelectedTimezone(timezone);
    sessionStorage.setItem('floating-clock-timezone', timezone);
    
    // Dispatch event for other components to listen to
    window.dispatchEvent(new CustomEvent('clock-timezone-changed', {
      detail: { timezone }
    }));
    
    handleSettingsClose();
  };



  const handleClockClick = () => {
    // Bring clock to foreground when clicked
    setIsForeground(true);
    
    // Reset foreground state after a short delay
    setTimeout(() => {
      setIsForeground(false);
    }, 2000);
  };

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget || (event.target as HTMLElement).closest('[data-drag-handle]')) {
      setIsDragging(true);
      const rect = clockRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (isDragging) {
      const newX = event.clientX - dragOffset.x;
      const newY = event.clientY - dragOffset.y;
      
      // Convert from top-left coordinates to bottom-left coordinates
      const bottomY = window.innerHeight - newY - 150; // 150 is approximate clock height
      
      // Keep clock within viewport bounds
      const maxX = window.innerWidth - 200; // Clock width
      const maxY = window.innerHeight - 150; // Clock height
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(bottomY, maxY)),
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Add global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  // Listen for visibility changes from toolbar
  useEffect(() => {
    const handleVisibilityChange = (event: any) => {
      if (externalIsVisible === undefined) {
        setInternalIsVisible(event.detail.isVisible);
      }
    };

    window.addEventListener('clock-visibility-changed', handleVisibilityChange);
    return () => {
      window.removeEventListener('clock-visibility-changed', handleVisibilityChange);
    };
  }, [externalIsVisible]);

  // Save position to sessionStorage whenever position changes
  useEffect(() => {
    sessionStorage.setItem('floating-clock-position', JSON.stringify(position));
  }, [position]);

  const formatTime = (date: Date, timezone: string, military: boolean): string => {
    try {
      let timeString: string;
      
      if (timezone === 'local') {
        timeString = date.toLocaleTimeString('en-US', {
          hour12: !military,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      } else {
        timeString = date.toLocaleTimeString('en-US', {
          hour12: !military,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: timezone,
        });
      }

      return timeString;
    } catch (error) {
      // Fallback to local time if timezone is invalid
      return date.toLocaleTimeString('en-US', {
        hour12: !military,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
  };

  const formatDate = (date: Date, timezone: string): string => {
    try {
      if (timezone === 'local') {
        return date.toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
        });
      } else {
        return date.toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          timeZone: timezone,
        });
      }
    } catch (error) {
      // Fallback to local date if timezone is invalid
      return date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      });
    }
  };

  const getTimezoneLabel = (): string => {
    const timezone = timezones.find(tz => tz.value === selectedTimezone);
    return timezone ? timezone.label : 'Local Time';
  };

  const timeString = formatTime(currentTime, selectedTimezone, useMilitaryTime);
  const dateString = formatDate(currentTime, selectedTimezone);

  // Don't render if hidden (visibility controlled by toolbar)
  if (!isVisible) {
    return null;
  }

  return (
    <Box
      ref={clockRef}
      className={className}
      onClick={handleClockClick}
      onMouseDown={handleMouseDown}
      sx={{
        position: 'fixed',
        left: position.x,
        bottom: position.y,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '2px solid #374151',
        borderRadius: '8px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        padding: 2,
        zIndex: isForeground ? 1300 : 1000, // Higher z-index when in foreground
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transform: isDragging ? 'scale(1.02)' : isForeground ? 'scale(1.05)' : 'scale(1)',
        transition: isDragging ? 'none' : 'all 0.2s ease',
        borderColor: isForeground ? '#f59e0b' : '#374151', // Highlight when in foreground
      }}
    >
             {/* Timezone Display */}
       <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
         <Chip
           icon={<ClockIcon />}
           label={getTimezoneLabel()}
           size="small"
           sx={{
             backgroundColor: 'rgba(245, 158, 11, 0.2)',
             color: '#f59e0b',
             border: '1px solid #f59e0b',
             fontSize: '0.75rem',
           }}
         />
                   <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Drag to Move">
              <IconButton
                size="small"
                data-drag-handle
                sx={{
                  color: '#9ca3af',
                  cursor: 'grab',
                  '&:hover': {
                    color: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  },
                }}
              >
                <DragIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Clock Settings">
              <IconButton
                size="small"
                onClick={handleSettingsClick}
                sx={{
                  color: '#9ca3af',
                  '&:hover': {
                    color: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  },
                }}
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
       </Box>

      {/* Time Display */}
      <Typography
        variant="h5"
        sx={{
          color: '#ffffff',
          fontWeight: 700,
          fontFamily: 'monospace',
          textAlign: 'center',
          letterSpacing: '1px',
        }}
      >
        {timeString}
      </Typography>

      {/* Date Display */}
      <Typography
        variant="body2"
        sx={{
          color: '#9ca3af',
          textAlign: 'center',
          fontWeight: 500,
        }}
      >
        {dateString}
      </Typography>

      {/* Settings Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleSettingsClose}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid #374151',
            backdropFilter: 'blur(10px)',
            color: '#ffffff',
            minWidth: 250,
          },
        }}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid #374151' }}>
          <Typography variant="subtitle2" sx={{ color: '#f59e0b', mb: 1 }}>
            Timezone
          </Typography>
          {timezones.map((timezone) => (
            <MenuItem
              key={timezone.value}
              onClick={() => handleTimezoneChange(timezone.value)}
              selected={selectedTimezone === timezone.value}
              sx={{
                color: selectedTimezone === timezone.value ? '#f59e0b' : '#9ca3af',
                '&:hover': {
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                },
                '&.Mui-selected': {
                  backgroundColor: 'rgba(245, 158, 11, 0.2)',
                  '&:hover': {
                    backgroundColor: 'rgba(245, 158, 11, 0.3)',
                  },
                },
              }}
            >
              {timezone.label}
            </MenuItem>
          ))}
        </Box>
        
        <Box sx={{ p: 2 }}>
          <FormControlLabel
                         control={
               <Switch
                 checked={useMilitaryTime}
                 onChange={(e) => {
                   const newValue = e.target.checked;
                   setUseMilitaryTime(newValue);
                   sessionStorage.setItem('floating-clock-military-time', JSON.stringify(newValue));
                   
                   // Dispatch event for other components to listen to
                   window.dispatchEvent(new CustomEvent('clock-military-time-changed', {
                     detail: { militaryTime: newValue }
                   }));
                 }}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: '#f59e0b',
                    '&:hover': {
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    },
                  },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                    backgroundColor: '#f59e0b',
                  },
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>
                Military Time (24-hour)
              </Typography>
            }
          />
        </Box>
      </Menu>
    </Box>
  );
};

export default FloatingClock;
