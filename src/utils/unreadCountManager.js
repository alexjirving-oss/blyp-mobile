/**
 * UnreadCountManager - Production Grade
 * 
 * Fixed indexOf error that was causing live streaming crashes.
 * Now includes comprehensive null safety and error handling.
 */
class UnreadCountManager {
  constructor() {
    this.unreadCount = 0;
    this.listeners = [];
    this.isDestroyed = false;
  }

  /**
   * Set unread count with error boundary
   */
  setUnreadCount(count) {
    try {
      if (this.isDestroyed) return;
      
      // Validate input
      const validCount = typeof count === 'number' && !isNaN(count) ? Math.max(0, count) : 0;
      this.unreadCount = validCount;
      
      // Safely notify listeners
      if (Array.isArray(this.listeners) && this.listeners.length > 0) {
        this.listeners.forEach(callback => {
          try {
            if (typeof callback === 'function') {
              callback(validCount);
            }
          } catch (error) {
            console.warn('🔔 UnreadCountManager: Listener callback error:', error);
          }
        });
      }
    } catch (error) {
      console.error('🔔 UnreadCountManager: setUnreadCount error:', error);
    }
  }

  /**
   * Get current unread count
   */
  getUnreadCount() {
    return this.isDestroyed ? 0 : this.unreadCount;
  }

  /**
   * Subscribe to count changes with bulletproof error handling
   */
  subscribe(callback) {
    try {
      if (this.isDestroyed) {
        console.warn('🔔 Cannot subscribe to destroyed UnreadCountManager');
        return () => {}; // Return no-op function
      }
      
      // Validate callback
      if (typeof callback !== 'function') {
        console.warn('🔔 UnreadCountManager: Invalid callback provided to subscribe');
        return () => {};
      }
      
      // Ensure listeners array exists
      if (!Array.isArray(this.listeners)) {
        this.listeners = [];
      }
      
      // Add callback
      this.listeners.push(callback);
      
      // Return unsubscribe function with bulletproof error handling
      return () => {
        try {
          if (this.isDestroyed || !Array.isArray(this.listeners)) {
            return;
          }
          
          // FIXED: The critical indexOf error - now with null safety
          const index = this.listeners.findIndex(listener => listener === callback);
          if (index > -1) {
            this.listeners.splice(index, 1);
          }
        } catch (error) {
          console.error('🔔 UnreadCountManager: Unsubscribe error:', error);
          // Try to rebuild listeners array if corrupted
          try {
            this.listeners = this.listeners.filter(listener => 
              listener && typeof listener === 'function' && listener !== callback
            );
          } catch (rebuildError) {
            console.error('🔔 UnreadCountManager: Failed to rebuild listeners:', rebuildError);
            this.listeners = [];
          }
        }
      };
    } catch (error) {
      console.error('🔔 UnreadCountManager: Subscribe error:', error);
      return () => {}; // Return safe no-op function
    }
  }
  
  /**
   * Cleanup all resources - production safety
   */
  destroy() {
    try {
      this.isDestroyed = true;
      this.listeners = [];
      this.unreadCount = 0;
    } catch (error) {
      console.error('🔔 UnreadCountManager: Destroy error:', error);
    }
  }
}

export default new UnreadCountManager();