/**
 * StreamingConfig - Simple Configuration for Streaming Features
 * 
 * Allows quick toggles for development and debugging
 */

const StreamingConfig = {
  // Error monitoring - can be disabled if causing issues
  ERROR_MONITORING_ENABLED: false, // DISABLED to prevent alert loops
  
  // Debug mode - shows extra logging
  DEBUG_MODE: true,
  
  // Alert settings
  SHOW_ERROR_ALERTS: false, // DISABLED to prevent user interruption
  ALERT_COOLDOWN_MS: 30000, // 30 seconds between alerts
  
  // Performance settings
  MAX_RETRY_ATTEMPTS: 3,
  SEGMENT_TIMEOUT_MS: 10000,
  CONNECTION_TIMEOUT_MS: 15000,
  
  // Production settings
  PRODUCTION_MODE: true,
  LOG_ERRORS_TO_CONSOLE: true,
  AUTO_RECOVERY_ENABLED: true
};

export default StreamingConfig;