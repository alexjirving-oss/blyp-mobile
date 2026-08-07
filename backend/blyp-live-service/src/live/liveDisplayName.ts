export function safeLiveDisplayName(value: unknown, userId: string, fallback = 'Viewer'): string {
  const label = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
  if (!label || label === userId) return fallback;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label)) {
    return fallback;
  }
  if (/^\d{10,}$/.test(label)) return fallback;
  if (label.length > 20 && /^[A-Za-z0-9_-]+$/.test(label)) return fallback;
  if (/^user_/i.test(label)) return fallback;
  if (label.length >= 20 && /[0-9]/.test(label) && /[a-f]/i.test(label) && /[-_]/.test(label)) {
    return fallback;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label)) return fallback;
  return label.slice(0, 64);
}
