/**
 * Tour target registry + callout placement.
 *
 * Targets can be registered by real views (TourTarget) or resolved from
 * named zones (tab slots, header strip, For You action rail).
 */

const targets = new Map();
const listeners = new Set();

function notify() {
  const snapshot = Object.fromEntries(targets.entries());
  for (const fn of Array.from(listeners)) {
    try {
      fn(snapshot);
    } catch {
      /* ignore */
    }
  }
}

/** @param {string} id */
/** @param {{ x: number, y: number, width: number, height: number } | null} rect */
export function setTourTarget(id, rect) {
  if (!id) return;
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 1 ||
    rect.height < 1
  ) {
    if (targets.has(id)) {
      targets.delete(id);
      notify();
    }
    return;
  }
  const next = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
  const prev = targets.get(id);
  if (
    prev &&
    Math.abs(prev.x - next.x) < 0.5 &&
    Math.abs(prev.y - next.y) < 0.5 &&
    Math.abs(prev.width - next.width) < 0.5 &&
    Math.abs(prev.height - next.height) < 0.5
  ) {
    return;
  }
  targets.set(id, next);
  notify();
}

export function clearTourTarget(id) {
  if (!id || !targets.has(id)) return;
  targets.delete(id);
  notify();
}

export function getTourTarget(id) {
  return id ? targets.get(id) || null : null;
}

export function subscribeTourTargets(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  try {
    fn(Object.fromEntries(targets.entries()));
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(fn);
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function inflate(rect, pad) {
  if (!rect) return null;
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

function intersects(a, b) {
  if (!a || !b) return false;
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * Named zones used when a live measure is missing.
 * @param {string} zone
 * @param {{ width: number, height: number, insets: { top: number, bottom: number, left: number, right: number } }} metrics
 */
export function resolveZoneRect(zone, metrics) {
  if (!zone || !metrics?.width || !metrics?.height) return null;
  const { width, height, insets = { top: 0, bottom: 0, left: 0, right: 0 } } = metrics;
  const tabBarH = 68 + Math.max((insets.bottom || 0) - 4, 0);
  const tabY = height - tabBarH;
  const slotW = width / 5;
  const tabSlots = { home: 0, chat: 1, create: 2, messenger: 3, profile: 4 };

  if (zone.startsWith('tab.')) {
    const key = zone.slice(4);
    const i = tabSlots[key];
    if (i == null) return null;
    return {
      x: i * slotW + slotW * 0.12,
      y: tabY + 6,
      width: slotW * 0.76,
      height: Math.max(44, tabBarH - 14),
    };
  }

  if (zone === 'header.tabs') {
    return {
      x: 10,
      y: (insets.top || 0) + 6,
      width: width - 20,
      height: 46,
    };
  }

  if (zone === 'header.forYou' || zone === 'header.home') {
    const idx = zone === 'header.forYou' ? 0 : 1;
    return {
      x: 10 + idx * 88,
      y: (insets.top || 0) + 8,
      width: 84,
      height: 42,
    };
  }

  if (zone === 'foryou.actions') {
    return {
      x: width - 72,
      y: height * 0.32,
      width: 58,
      height: Math.min(260, height * 0.38),
    };
  }

  if (zone === 'center.soft') {
    return {
      x: width * 0.2,
      y: height * 0.28,
      width: width * 0.6,
      height: height * 0.22,
    };
  }

  return null;
}

/**
 * Pick a callout position that does not cover the spotlight target.
 * @returns {{ x: number, y: number, placement: string }}
 */
export function placeCallout({
  screenW,
  screenH,
  insets = { top: 0, bottom: 0, left: 0, right: 0 },
  target,
  cardW,
  cardH,
  gap = 14,
  preferred,
} = {}) {
  const padX = 12;
  const minY = (insets.top || 0) + 8;
  const maxY = screenH - (insets.bottom || 0) - cardH - 8;
  const minX = padX;
  const maxX = Math.max(minX, screenW - padX - cardW);

  const centerX = () => clamp((screenW - cardW) / 2, minX, maxX);

  if (!target) {
    // No spotlight — float mid-upper so the bottom tab bar stays visible.
    return {
      x: centerX(),
      y: clamp(screenH * 0.22, minY, Math.max(minY, maxY)),
      placement: 'floating',
    };
  }

  const hole = inflate(target, 8);
  const alignXToTarget = () =>
    clamp(target.x + target.width / 2 - cardW / 2, minX, maxX);

  /** @type {Array<{ x: number, y: number, placement: string, score: number }>} */
  const candidates = [];

  const belowY = hole.y + hole.height + gap;
  if (belowY + cardH <= screenH - (insets.bottom || 0) - 4) {
    candidates.push({
      x: alignXToTarget(),
      y: belowY,
      placement: 'below',
      score: screenH - (belowY + cardH) + (preferred === 'below' ? 80 : 0),
    });
  }

  const aboveY = hole.y - gap - cardH;
  if (aboveY >= minY) {
    candidates.push({
      x: alignXToTarget(),
      y: aboveY,
      placement: 'above',
      score: aboveY - minY + (preferred === 'above' ? 80 : 0),
    });
  }

  const rightX = hole.x + hole.width + gap;
  if (rightX + cardW <= screenW - padX) {
    const y = clamp(hole.y + hole.height / 2 - cardH / 2, minY, maxY);
    candidates.push({
      x: rightX,
      y,
      placement: 'right',
      score: screenW - (rightX + cardW) + (preferred === 'right' ? 60 : 0),
    });
  }

  const leftX = hole.x - gap - cardW;
  if (leftX >= padX) {
    const y = clamp(hole.y + hole.height / 2 - cardH / 2, minY, maxY);
    candidates.push({
      x: leftX,
      y,
      placement: 'left',
      score: leftX + (preferred === 'left' ? 60 : 0),
    });
  }

  // Prefer non-overlapping; drop any that still collide (side placements with tall cards).
  const safe = candidates.filter((c) => {
    const cardRect = { x: c.x, y: c.y, width: cardW, height: cardH };
    return !intersects(cardRect, hole);
  });

  const pool = safe.length ? safe : candidates;
  if (pool.length) {
    pool.sort((a, b) => b.score - a.score);
    return { x: pool[0].x, y: pool[0].y, placement: pool[0].placement };
  }

  // Last resort: opposite half of the screen from the target.
  const targetMidY = target.y + target.height / 2;
  const y =
    targetMidY > screenH / 2
      ? clamp(minY + 12, minY, maxY)
      : clamp(maxY - 12, minY, maxY);
  return { x: centerX(), y, placement: 'fallback' };
}

/**
 * Resolve the best rect for a step: live target → zone heuristic.
 */
export function resolveStepTarget(step, metrics) {
  if (!step) return null;
  if (step.targetId) {
    const live = getTourTarget(step.targetId);
    if (live) return live;
  }
  if (step.targetZone) {
    return resolveZoneRect(step.targetZone, metrics);
  }
  return null;
}
