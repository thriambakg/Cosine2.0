import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ClockContextType {
  clockTime: Date;
  clockTimezone: string;
  clockMilitaryTime: boolean;
  setClockTimezone: (timezone: string) => void;
  setClockMilitaryTime: (military: boolean) => void;
}

const ClockContext = createContext<ClockContextType | undefined>(undefined);

interface ClockProviderProps {
  children: ReactNode;
}

export const ClockProvider: React.FC<ClockProviderProps> = ({ children }) => {
  const [clockTime, setClockTime] = useState<Date>(new Date());
  const [clockTimezone, setClockTimezone] = useState<string>(() => {
    const saved = sessionStorage.getItem('floating-clock-timezone');
    return saved || 'local';
  });
  const [clockMilitaryTime, setClockMilitaryTime] = useState<boolean>(() => {
    const saved = sessionStorage.getItem('floating-clock-military-time');
    return saved ? JSON.parse(saved) : false;
  });

  // Update clock time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Listen for timezone changes from the floating clock
  useEffect(() => {
    const handleTimezoneChange = (event: CustomEvent) => {
      setClockTimezone(event.detail.timezone);
    };

    const handleMilitaryTimeChange = (event: CustomEvent) => {
      setClockMilitaryTime(event.detail.militaryTime);
    };

    window.addEventListener('clock-timezone-changed', handleTimezoneChange as EventListener);
    window.addEventListener('clock-military-time-changed', handleMilitaryTimeChange as EventListener);

    return () => {
      window.removeEventListener('clock-timezone-changed', handleTimezoneChange as EventListener);
      window.removeEventListener('clock-military-time-changed', handleMilitaryTimeChange as EventListener);
    };
  }, []);

  const value: ClockContextType = {
    clockTime,
    clockTimezone,
    clockMilitaryTime,
    setClockTimezone,
    setClockMilitaryTime,
  };

  return (
    <ClockContext.Provider value={value}>
      {children}
    </ClockContext.Provider>
  );
};

export const useClock = (): ClockContextType => {
  const context = useContext(ClockContext);
  if (context === undefined) {
    throw new Error('useClock must be used within a ClockProvider');
  }
  return context;
};
