import { useState, useEffect } from 'react';
import unreadCountManager from '../utils/unreadCountManager';

export const useUnreadCount = () => {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Get initial count
    setUnreadCount(unreadCountManager.getUnreadCount());

    // Subscribe to changes
    const unsubscribe = unreadCountManager.subscribe((count) => {
      setUnreadCount(count);
    });

    return unsubscribe;
  }, []);

  return unreadCount;
};