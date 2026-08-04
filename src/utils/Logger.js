// Debug utility for development logging
const isDev = __DEV__;

// Log levels
const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

function normalizeLogLevel(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (['0', 'error'].includes(v)) return LogLevel.ERROR;
  if (['1', 'warn', 'warning'].includes(v)) return LogLevel.WARN;
  if (['2', 'info'].includes(v)) return LogLevel.INFO;
  if (['3', 'debug'].includes(v)) return LogLevel.DEBUG;
  return null;
}

// Current log level (dev default is WARN to avoid lag from excessive console output)
const configured = normalizeLogLevel(process?.env?.EXPO_PUBLIC_LOG_LEVEL);
const currentLogLevel = isDev ? (configured ?? LogLevel.WARN) : LogLevel.ERROR;

const traceEnabled =
  isDev && ['1', 'true', 'yes'].includes(String(process?.env?.EXPO_PUBLIC_LOG_TRACE || '').toLowerCase());

// Colored emojis for different log types
const LogEmojis = {
  error: '❌',
  warn: '⚠️',
  info: 'ℹ️',
  debug: '🔍',
  firebase: '🔥',
  navigation: '📱',
  user: '👤',
  api: '📡',
  cache: '💾',
  performance: '⚡',
  ui: '🎨',
};

class Logger {
  static log(level, category, message, ...args) {
    if (!isDev || level > currentLogLevel) return;
    
    const emoji = LogEmojis[category] || LogEmojis.debug;
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`${emoji} [${timestamp}] ${message}`, ...args);
  }

  static error(category, message, ...args) {
    this.log(LogLevel.ERROR, category, message, ...args);
    if (traceEnabled) console.trace();
  }

  static warn(category, message, ...args) {
    this.log(LogLevel.WARN, category, message, ...args);
  }

  static info(category, message, ...args) {
    this.log(LogLevel.INFO, category, message, ...args);
  }

  static debug(category, message, ...args) {
    this.log(LogLevel.DEBUG, category, message, ...args);
  }

  // Convenience methods for common categories
  static firebase(message, ...args) {
    this.debug('firebase', message, ...args);
  }

  static navigation(message, ...args) {
    this.debug('navigation', message, ...args);
  }

  static user(message, ...args) {
    this.debug('user', message, ...args);
  }

  static api(message, ...args) {
    this.debug('api', message, ...args);
  }

  static performance(message, ...args) {
    this.debug('performance', message, ...args);
  }

  static ui(message, ...args) {
    this.debug('ui', message, ...args);
  }
}

export default Logger;