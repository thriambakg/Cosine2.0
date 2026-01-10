// Logging Configuration
// This file is loaded before the React app initializes
// Set window.LOGGING_ENABLED to false to disable all console logs

(function() {
  'use strict';
  
  // Try to load from JSON file synchronously
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/logging.json?t=' + Date.now(), false); // Synchronous
    xhr.send(null);
    
    if (xhr.status === 200) {
      var config = JSON.parse(xhr.responseText);
      window.LOGGING_ENABLED = config.enabled === true;
    } else {
      // Default to enabled if file doesn't exist
      window.LOGGING_ENABLED = true;
    }
  } catch (error) {
    // Default to enabled if load fails
    window.LOGGING_ENABLED = true;
  }
  
  // Store original console methods
  if (typeof console !== 'undefined') {
    window._ORIGINAL_CONSOLE = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };
    
    // Override console methods immediately
    if (!window.LOGGING_ENABLED) {
      console.log = function() {};
      console.error = function() {};
      console.warn = function() {};
      console.info = function() {};
      console.debug = function() {};
    }
  }
})();



