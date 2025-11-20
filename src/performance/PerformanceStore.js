// Lightweight app performance store for React Native (no dependencies)
// Collects marks, spans, render times, and network timings; exposes a context API.

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Sentry } from '../monitoring/sentry';

const now = () => Date.now();

// Event shapes kept intentionally simple for low overhead
// { type: 'mark'|'span'|'render'|'network', name, ts, duration?, meta? }

const PerformanceContext = createContext(null);

export function PerformanceProvider({ children, enableDevLogs = __DEV__ }) {
  const eventsRef = useRef([]);
  const spansRef = useRef(new Map()); // id -> { name, start, meta }
  const idCounterRef = useRef(1);
  const [version, setVersion] = useState(0); // bump to notify listeners when needed

  const pushEvent = useCallback((evt) => {
    eventsRef.current.push(evt);
    // Keep memory bounded
    if (eventsRef.current.length > 2000) {
      eventsRef.current.splice(0, eventsRef.current.length - 2000);
    }
    if (enableDevLogs) {
      // eslint-disable-next-line no-console
      console.debug('[perf]', evt);
    }
  }, [enableDevLogs]);

  const mark = useCallback((name, meta) => {
    const evt = { type: 'mark', name, ts: now(), meta };
    pushEvent(evt);
    try { Sentry?.addBreadcrumb?.({ category: 'perf', message: `mark:${name}`, data: meta, level: 'info' }); } catch {}
  }, [pushEvent]);

  const beginSpan = useCallback((name, meta) => {
    const id = idCounterRef.current++;
    spansRef.current.set(id, { name, start: now(), meta });
    return id;
  }, []);

  const endSpan = useCallback((id, meta) => {
    const span = spansRef.current.get(id);
    if (!span) return null;
    spansRef.current.delete(id);
    const duration = Math.max(0, now() - span.start);
    const evt = { type: 'span', name: span.name, ts: span.start, duration, meta: { ...span.meta, ...meta } };
    pushEvent(evt);
    try { Sentry?.addBreadcrumb?.({ category: 'perf', message: `span:${span.name}`, data: { duration }, level: 'info' }); } catch {}
    return evt;
  }, [pushEvent]);

  const measure = useCallback((name, startTsOrMarkName, endTs, meta) => {
    let startTs = startTsOrMarkName;
    if (typeof startTsOrMarkName === 'string') {
      // Find last mark with this name
      for (let i = eventsRef.current.length - 1; i >= 0; i--) {
        const e = eventsRef.current[i];
        if (e.type === 'mark' && e.name === startTsOrMarkName) { startTs = e.ts; break; }
      }
    }
    const s = typeof startTs === 'number' ? startTs : now();
    const e = typeof endTs === 'number' ? endTs : now();
    const evt = { type: 'span', name, ts: s, duration: Math.max(0, e - s), meta };
    pushEvent(evt);
    return evt;
  }, [pushEvent]);

  const addRender = useCallback((name, duration, meta) => {
    const evt = { type: 'render', name, ts: now(), duration, meta };
    pushEvent(evt);
  }, [pushEvent]);

  const addNetwork = useCallback((info) => {
    const { name, method, url, status, duration, bytes, meta } = info || {};
    const evt = { type: 'network', name: name || method || 'request', ts: now(), duration, meta: { method, url, status, bytes, ...meta } };
    pushEvent(evt);
  }, [pushEvent]);

  const trackAsync = useCallback(async (name, fn, meta) => {
    const id = beginSpan(name, meta);
    try {
      const result = await fn();
      endSpan(id, { ok: true });
      return result;
    } catch (e) {
      endSpan(id, { ok: false, error: String(e?.message || e) });
      throw e;
    }
  }, [beginSpan, endSpan]);

  const getSnapshot = useCallback(() => ({
    events: eventsRef.current.slice(-500),
    stats: summarize(eventsRef.current),
  }), []);

  const getScore = useCallback(() => computeScore(eventsRef.current), []);

  const clear = useCallback(() => {
    eventsRef.current = [];
    spansRef.current.clear();
    setVersion(v => v + 1);
  }, []);

  const value = useMemo(() => ({
    mark, beginSpan, endSpan, measure, addRender, addNetwork, trackAsync, getSnapshot, getScore, clear,
  }), [mark, beginSpan, endSpan, measure, addRender, addNetwork, trackAsync, getSnapshot, getScore, clear]);

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  );
}

export function usePerformance() {
  const ctx = useContext(PerformanceContext);
  if (!ctx) {
    throw new Error('usePerformance must be used within a PerformanceProvider');
  }
  return ctx;
}

function summarize(events) {
  const agg = { render: {}, network: {}, spans: {} };
  for (const e of events) {
    if ((e.type === 'render' || e.type === 'span') && typeof e.duration === 'number') {
      const bucket = e.type === 'render' ? agg.render : agg.spans;
      const cur = bucket[e.name] || (bucket[e.name] = { count: 0, total: 0, max: 0 });
      cur.count++; cur.total += e.duration; cur.max = Math.max(cur.max, e.duration);
    } else if (e.type === 'network') {
      const key = e.name;
      const cur = agg.network[key] || (agg.network[key] = { count: 0, total: 0, max: 0 });
      const d = Number(e.duration) || 0;
      cur.count++; cur.total += d; cur.max = Math.max(cur.max, d);
    }
  }
  const average = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, avg: v.count ? Math.round(v.total / v.count) : 0 }]));
  return {
    render: average(agg.render),
    spans: average(agg.spans),
    network: average(agg.network),
    totalEvents: events.length,
  };
}

// Compute a single 0-100 score with a simple weighted heuristic
// - Render avg (target <= 120ms) weight 0.4
// - Network avg (target <= 800ms) weight 0.2
// - Long spans ratio (>2000ms) weight 0.2
// - Error rate (spans with meta.ok === false) weight 0.2
function computeScore(events) {
  if (!events || events.length === 0) return { score: null, breakdown: { reason: 'no-events' } };
  let renderCount = 0, renderTotal = 0;
  let netCount = 0, netTotal = 0;
  let spanCount = 0, longSpanCount = 0, errorSpanCount = 0;

  for (const e of events) {
    if (e.type === 'render' && typeof e.duration === 'number') {
      renderCount++; renderTotal += e.duration;
    } else if (e.type === 'network') {
      netCount++; netTotal += (Number(e.duration) || 0);
    } else if (e.type === 'span') {
      spanCount++;
      const d = Number(e.duration) || 0;
      if (d > 2000) longSpanCount++;
      const ok = e?.meta?.ok;
      if (ok === false) errorSpanCount++;
    }
  }

  const renderAvg = renderCount ? renderTotal / renderCount : null;
  const netAvg = netCount ? netTotal / netCount : null;
  const longSpanRatio = spanCount ? longSpanCount / spanCount : 0;
  const errorRate = spanCount ? errorSpanCount / spanCount : 0;

  // Map to 0-100 (higher is better)
  const scoreFromAvg = (avg, good, bad) => {
    if (avg == null) return 70; // neutral when unknown
    if (avg <= good) return 100;
    if (avg >= bad) return 0;
    // Linear between good..bad
    return Math.max(0, Math.min(100, Math.round(100 - ((avg - good) * 100) / (bad - good))));
  };

  const renderScore = scoreFromAvg(renderAvg, 120, 400);
  const networkScore = scoreFromAvg(netAvg, 800, 3000);
  const longSpanScore = Math.max(0, Math.min(100, Math.round(100 - Math.min(1, longSpanRatio * 2) * 100)));
  const errorScore = Math.max(0, Math.min(100, Math.round(100 - Math.min(1, errorRate * 2) * 100)));

  const weights = { render: 0.4, network: 0.2, longSpans: 0.2, errors: 0.2 };
  const score = Math.round(
    renderScore * weights.render +
    networkScore * weights.network +
    longSpanScore * weights.longSpans +
    errorScore * weights.errors
  );

  return {
    score,
    breakdown: {
      render: { avg: renderAvg, score: renderScore },
      network: { avg: netAvg, score: networkScore },
      spans: { longSpanRatio, score: longSpanScore, errorRate, errorScore },
    }
  };
}

export default PerformanceProvider;
