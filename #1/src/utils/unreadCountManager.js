class UnreadCountManager {
  constructor() {
    this.unreadCount = 0;
    this.listeners = [];
  }

  setUnreadCount(count) {
    this.unreadCount = count;
    this.listeners.forEach(callback => callback(count));
  }

  getUnreadCount() {
    return this.unreadCount;
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }
}

export default new UnreadCountManager();