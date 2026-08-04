/** Profile feed category helpers (owner-defined shelves, not hashtags). */

export const MAX_PROFILE_CATEGORIES = 12;
export const MAX_CATEGORY_LABEL_LEN = 24;

export function normalizeCategoryLabel(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_CATEGORY_LABEL_LEN);
}

export function makeCategoryId(label) {
  const base = normalizeCategoryLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `cat_${base || 'topic'}_${suffix}`;
}

export function normalizeProfileCategories(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    if (!item) return;
    const id = String(item.id || '').trim();
    const label = normalizeCategoryLabel(item.label || item.name || item.title);
    if (!id || !label || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      label,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    });
  });
  return out.sort((a, b) => a.order - b.order).slice(0, MAX_PROFILE_CATEGORIES);
}

export function filterPostsByCategory(posts, categoryId) {
  const list = Array.isArray(posts) ? posts : [];
  if (!categoryId || categoryId === 'all') return list;
  if (categoryId === 'uncategorized') {
    return list.filter((p) => !String(p?.categoryId || '').trim());
  }
  return list.filter((p) => String(p?.categoryId || '').trim() === String(categoryId));
}

/**
 * Build chip list for a profile: All + configured categories (with counts)
 * + Uncategorized when any posts lack a category.
 */
export function buildProfileCategoryChips(categories, posts) {
  const cats = normalizeProfileCategories(categories);
  const list = Array.isArray(posts) ? posts : [];
  const counts = new Map();
  let uncategorized = 0;
  list.forEach((p) => {
    const id = String(p?.categoryId || '').trim();
    if (!id) {
      uncategorized += 1;
      return;
    }
    counts.set(id, (counts.get(id) || 0) + 1);
  });

  const chips = [{ id: 'all', label: 'All', count: list.length }];
  cats.forEach((c) => {
    chips.push({ id: c.id, label: c.label, count: counts.get(c.id) || 0 });
  });
  if (uncategorized > 0) {
    chips.push({ id: 'uncategorized', label: 'Other', count: uncategorized });
  }
  return chips;
}
