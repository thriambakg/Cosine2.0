/**
 * Centralized logging utility
 * Reads logging configuration from public/logging.json
 * Allows toggling all console logs on/off for production
 * 
 * This module overrides console methods globally, so all existing console.log
 * statements throughout the app will be controlled by the logging.json config.
 */

let loggingEnabled = true;
let configLoaded = false;
let originalConsole: {
  log: typeof console.log;
  error: typeof console.error;
  warn: typeof console.warn;
  info: typeof console.info;
  debug: typeof console.debug;
} | null = null;

// Store original console methods IMMEDIATELY before any other code runs
if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };
}

// Override console methods globally
const overrideConsoleMethods = () => {
  if (typeof window === 'undefined' || typeof console === 'undefined' || !originalConsole) return;
  
  if (loggingEnabled) {
    // Restore original console methods
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  } else {
    // Override with no-op functions that do nothing
    // Use function() {} instead of arrow functions to preserve context
    console.log = function() {};
    console.error = function() {};
    console.warn = function() {};
    console.info = function() {};
    console.debug = function() {};
  }
};

// Load logging configuration from public folder (async)
const loadLoggingConfig = async (): Promise<boolean> => {
  if (configLoaded) {
    return loggingEnabled;
  }

  try {
    const response = await fetch('/logging.json?t=' + Date.now()); // Cache bust
    if (response.ok) {
      const config = await response.json();
      loggingEnabled = config.enabled === true;
      configLoaded = true;
      
      // Override console methods based on config
      overrideConsoleMethods();
      
      return loggingEnabled;
    } else {
      // If file doesn't exist, default to enabled for development
      loggingEnabled = true;
      configLoaded = true;
      overrideConsoleMethods();
      return loggingEnabled;
    }
  } catch (error) {
    // If file doesn't exist or can't be loaded, default to enabled for development
    loggingEnabled = true;
    configLoaded = true;
    overrideConsoleMethods();
    return loggingEnabled;
  }
};

// Initialize logging config IMMEDIATELY on module load
// Check if logging.js script already set window.LOGGING_ENABLED
if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  // Check if logging.js script already ran and set window.LOGGING_ENABLED
  if (typeof (window as any).LOGGING_ENABLED === 'boolean') {
    loggingEnabled = (window as any).LOGGING_ENABLED;
    configLoaded = true;
    
    // Use original console from window if available (set by logging.js)
    if ((window as any)._ORIGINAL_CONSOLE) {
      originalConsole = (window as any)._ORIGINAL_CONSOLE;
    }
    
    // Override console methods based on config
    overrideConsoleMethods();
  } else {
    // Fallback: logging.js didn't run, try to load config synchronously
    // First, immediately disable all logs (safety first - assume disabled)
    // This prevents any logs from appearing before config loads
    console.log = function() {};
    console.error = function() {};
    console.warn = function() {};
    console.info = function() {};
    console.debug = function() {};
    
    // Then try to load config synchronously
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/logging.json?t=' + Date.now(), false); // false = synchronous (blocking)
      xhr.send(null);
      
      if (xhr.status === 200) {
        const config = JSON.parse(xhr.responseText);
        loggingEnabled = config.enabled === true;
        configLoaded = true;
      } else {
        // Default to enabled if file doesn't exist (for development)
        loggingEnabled = true;
        configLoaded = true;
      }
    } catch (error) {
      // Default to enabled if synchronous load fails (for development)
      loggingEnabled = true;
      configLoaded = true;
    }
    
    // Override console methods based on loaded config
    overrideConsoleMethods();
    
    // Also reload asynchronously to allow runtime updates (non-blocking)
    loadLoggingConfig().catch(() => {
      // Silently fail - we already have a value from sync load
    });
  }
}

/**
 * Logger utility that wraps console methods
 * Only logs if logging is enabled in the config
 * Note: Console methods are already overridden globally, but this provides
 * a programmatic way to check and use logging
 */
export const logger = {
  log: (...args: any[]) => {
    if (loggingEnabled && originalConsole) {
      originalConsole.log(...args);
    }
  },
  
  error: (...args: any[]) => {
    if (loggingEnabled && originalConsole) {
      originalConsole.error(...args);
    }
  },
  
  warn: (...args: any[]) => {
    if (loggingEnabled && originalConsole) {
      originalConsole.warn(...args);
    }
  },
  
  info: (...args: any[]) => {
    if (loggingEnabled && originalConsole) {
      originalConsole.info(...args);
    }
  },
  
  debug: (...args: any[]) => {
    if (loggingEnabled && originalConsole) {
      originalConsole.debug(...args);
    }
  },
  
  // Force reload config (useful for development)
  reloadConfig: async () => {
    configLoaded = false;
    await loadLoggingConfig();
  },
  
  // Get current enabled state
  isEnabled: () => loggingEnabled,
  
  // Test if logging is working (for debugging)
  test: () => {
    console.log('🧪 Logger test - if you see this, logging is enabled');
    console.error('🧪 Logger test error - if you see this, logging is enabled');
  }
};

// Export default for convenience
export default logger;

