// useModerationQueue: React hook wrapping ModerationQueueService subscription.
// Domain: Trust & Safety. Reads aggregated moderationQueue entries.

// useModerationQueue: React hook wrapping ModerationQueueService subscription.
import { useEffect, useState, useRef } from 'react';
import ModerationQueueService from '../services/ModerationQueueService';

export default function useModerationQueue({ auto = true, limit = 50 } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(auto);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    if (!auto) return;
    setLoading(true);
    unsubscribeRef.current = ModerationQueueService.subscribe(queueItems => {
      setItems(queueItems);
      setLoading(false);
    }, limit);
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [auto, limit]);

  const refresh = async () => {
    setLoading(true);
    const top = await ModerationQueueService.getTop(limit);
    setItems(top);
    setLoading(false);
  };

  const markUnderReview = async (id) => {
    await ModerationQueueService.markUnderReview(id);
    refresh();
  };

  const resolve = async (id, resolution) => {
    await ModerationQueueService.resolve(id, resolution);
    refresh();
  };

  return { items, loading, refresh, markUnderReview, resolve };
}
