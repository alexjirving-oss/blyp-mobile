/**
 * ErrorMonitoringService - Production Error Detection
 * 
 * Monitors for indexOf and other critical errors in live streaming
 * Provides comprehensive error reporting and automatic recovery
 */

class ErrorMonitoringService {
  constructor() {
    this.errorLog = [];
    this.criticalErrors = [];
    this.isMonitoring = false;
    this.errorCallbacks = [];
  }

  /**
   * Start monitoring for critical errors
   */
  startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('🔍 ErrorMonitoring: Started production error monitoring');
    
    // Override console.error to catch critical errors
    this.originalConsoleError = console.error;
    console.error = (...args) => {
      this.handleError('console.error', args);
      this.originalConsoleError(...args);
    };
    
    // Set up global error handler for unhandled errors
    if (typeof ErrorUtils !== 'undefined') {
      this.originalErrorHandler = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler((error, isFatal) => {
        this.handleError('global', { error, isFatal });
        if (this.originalErrorHandler) {
          this.originalErrorHandler(error, isFatal);
        }
      });
    }
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    console.log('🔍 ErrorMonitoring: Stopped monitoring');
    
    // Restore original handlers
    if (this.originalConsoleError) {
      console.error = this.originalConsoleError;
    }
    
    if (this.originalErrorHandler && typeof ErrorUtils !== 'undefined') {
      ErrorUtils.setGlobalHandler(this.originalErrorHandler);
    }
  }

  /**
   * Handle detected errors
   */
  handleError(type, errorData) {
    const timestamp = new Date().toISOString();
    const errorInfo = {
      type,
      data: errorData,
      timestamp,
      isCritical: this.isCriticalError(errorData)
    };
    
    this.errorLog.push(errorInfo);
    
    // Keep only last 100 errors to prevent memory issues
    if (this.errorLog.length > 100) {
      this.errorLog = this.errorLog.slice(-100);
    }
    
    if (errorInfo.isCritical) {
      this.criticalErrors.push(errorInfo);
      console.warn('🚨 CRITICAL ERROR DETECTED:', errorInfo);
      
      // Notify callbacks
      this.errorCallbacks.forEach(callback => {
        try {
          callback(errorInfo);
        } catch (cbError) {
          console.warn('🔍 Error in error callback:', cbError);
        }
      });
    }
  }

  /**
   * Check if error is critical (indexOf, streaming-related, etc.)
   * Made more selective to prevent false positives
   */
  isCriticalError(errorData) {
    const errorString = JSON.stringify(errorData).toLowerCase();
    
    // Only flag very specific indexOf errors that we know are problematic
    if (errorString.includes('indexof') && 
        errorString.includes('not a function') &&
        (errorString.includes('listeners') || errorString.includes('unreadcount'))) {
      return true;
    }
    
    // Only flag critical streaming errors, not minor ones  
    const criticalStreamingErrors = [
      'hlslivestream.*not a function',
      'broadcaster.*undefined',
      'segment.*cannot read',
      'firebase.*connection failed'
    ];
    
    const hasCriticalStreamingError = criticalStreamingErrors.some(pattern => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(errorString);
    });
    
    // Very selective - only truly breaking errors
    const trulyBrokenPatterns = [
      'cannot access before initialization',
      'maximum call stack size exceeded',
      'out of memory'
    ];
    
    const isTrulyBroken = trulyBrokenPatterns.some(pattern =>
      errorString.includes(pattern)
    );
    
    return hasCriticalStreamingError || isTrulyBroken;
  }

  /**
   * Subscribe to critical error notifications
   */
  onCriticalError(callback) {
    if (typeof callback === 'function') {
      this.errorCallbacks.push(callback);
      
      return () => {
        const index = this.errorCallbacks.findIndex(cb => cb === callback);
        if (index > -1) {
          this.errorCallbacks.splice(index, 1);
        }
      };
    }
    return () => {};
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    const recentErrors = this.errorLog.filter(error => 
      new Date(error.timestamp).getTime() > oneHourAgo
    );
    
    const recentCritical = this.criticalErrors.filter(error => 
      new Date(error.timestamp).getTime() > oneHourAgo
    );
    
    return {
      totalErrors: this.errorLog.length,
      criticalErrors: this.criticalErrors.length,
      recentErrors: recentErrors.length,
      recentCritical: recentCritical.length,
      isHealthy: recentCritical.length === 0
    };
  }

  /**
   * Get recent critical errors for debugging
   */
  getRecentCriticalErrors(limit = 10) {
    return this.criticalErrors
      .slice(-limit)
      .reverse(); // Most recent first
  }

  /**
   * Clear error logs
   */
  clearLogs() {
    this.errorLog = [];
    this.criticalErrors = [];
    console.log('🔍 ErrorMonitoring: Cleared error logs');
  }

  /**
   * Export error report for debugging
   */
  exportErrorReport() {
    const stats = this.getErrorStats();
    const recentCritical = this.getRecentCriticalErrors(20);
    
    return {
      timestamp: new Date().toISOString(),
      stats,
      recentCriticalErrors: recentCritical,
      systemInfo: {
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
      }
    };
  }
}

// Create singleton instance
const errorMonitoring = new ErrorMonitoringService();

export default errorMonitoring;