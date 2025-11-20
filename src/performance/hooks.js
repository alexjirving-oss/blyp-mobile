import { useEffect, useRef } from 'react';
import { usePerformance } from './PerformanceStore';

// Measure initial render/mount duration for a component/screen
export function useRenderTimer(name) {
  const startRef = useRef(Date.now());
  const { addRender } = usePerformance();
  useEffect(() => {
    const duration = Math.max(0, Date.now() - startRef.current);
    addRender(name, duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Wrap an async function to measure its duration
export function useTrackAsync() {
  const { trackAsync } = usePerformance();
  return trackAsync;
}

// Convenience mark helpers
export function usePerfMarks() {
  const { mark, measure, beginSpan, endSpan } = usePerformance();
  return { mark, measure, beginSpan, endSpan };
}
