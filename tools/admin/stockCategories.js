'use strict';

/**
 * Stock pack → Stage/profile shelf taxonomy (Alex stock account).
 * Shared by upload_local_stock_posts_v2.js and backfill_stock_framing_meta.js.
 * Local-disk only — no Etsy dependency.
 */

const FOOTWORK_ID = 'cat_football_6lr0f';

/** @type {{ id: string, label: string, order: number }[]} */
const STOCK_PROFILE_CATEGORIES = [
  { id: FOOTWORK_ID, label: 'Footwork', order: 0 },
  { id: 'cat_kids-stories_stock', label: 'Kids stories', order: 1 },
  { id: 'cat_baby-podcast_stock', label: 'Baby podcast', order: 2 },
  { id: 'cat_horror_stock', label: 'Horror', order: 3 },
  { id: 'cat_art-cinema_stock', label: 'Art & cinema', order: 4 },
  { id: 'cat_animals_stock', label: 'Animals', order: 5 },
  { id: 'cat_biohacking_stock', label: 'Biohacking', order: 6 },
  { id: 'cat_talking-objects_stock', label: 'Talking objects', order: 7 },
  { id: 'cat_viral-shorts_stock', label: 'Viral shorts', order: 8 },
  { id: 'cat_life-hacks_stock', label: 'Life hacks', order: 9 },
];

/** Etsy: "300 AI Baby Comedy Reels | Pre-subtitled Podcast Bundle" → local andr/f4 */
const BABY_PODCAST_ID = 'cat_baby-podcast_stock';

const CREATOR_LABELS = {
  biohackingmegaboss: 'Biohacking',
  explainingyourbody: 'Body explainers',
  saucyexplains: 'Saucy explains',
  saucyexplain: 'Saucy explains',
  lifehack: 'Life hack',
  makehealthgreat: 'Make health great',
  recepthydei: 'Recepthydei',
  talkingobject: 'Talking Object',
  'talking object': 'Talking Object',
  studionayra: 'Studio Nayra',
  'studio nayra': 'Studio Nayra',
};

function pathNorm(p) {
  return String(p || '').replace(/\\/g, '/');
}

function basenameNoExt(filePath) {
  const base = pathNorm(filePath).split('/').pop() || '';
  return base.replace(/\.[^.]+$/, '');
}

function cleanSpaces(s) {
  return String(s || '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fine pack key from local path + filename (not just top folder).
 * @returns {'footwork'|'kids'|'baby_podcast'|'horror'|'animals'|'biohacking'|'talking_objects'|'cinema'|'life_hacks'|'viral'|'stock'}
 */
function detectStockKind(filePath) {
  const p = pathNorm(filePath).toLowerCase();
  const name = basenameNoExt(filePath).toLowerCase();
  const hay = `${p} ${name}`;

  if (/(^|\/)(footwork|football|soccer)(\/|$)/.test(p) || /footwork|football|soccer|dribbl/.test(hay)) {
    return 'footwork';
  }
  // 300 AI Baby Podcast / Baby Comedy Reels pack (Drive → andr/f4)
  if (
    /(^|\/)andr\/f4(\/|$)/.test(p) ||
    /(^|\/)(baby-podcast|babypodcast|baby_podcast)(\/|$)/.test(p) ||
    /baby\s*podcast|baby\s*comedy|ai\s*baby/.test(hay)
  ) {
    return 'baby_podcast';
  }
  if (/(^|\/)kids(\/|$)/.test(p) || /kids|storytime|nursery|bedtime/.test(p)) return 'kids';
  if (/(^|\/)horror(\/|$)/.test(p)) return 'horror';
  if (
    /(^|\/)(ready|animals)(\/|$)/.test(p) ||
    /\b(babylion|lionlang|lion|tiger|leopard|wildlife|animal|puppy|kitten)\b/.test(hay)
  ) {
    return 'animals';
  }

  // andr / cinema / health packs on disk
  if (/studio\s*nayra|nayra-0101/.test(hay)) return 'cinema';
  if (/talking\s*object/.test(hay)) return 'talking_objects';
  if (/biohacking|explainingyourbody|saucyexplain|makehealthgreat|recepthydei/.test(hay)) return 'biohacking';
  if (/\blifehack\b|life\s*hack/.test(hay)) return 'life_hacks';
  if (/(^|\/)andr\/f1(\/|$)/.test(p) && /new\s*vids/.test(name)) return 'viral';
  if (/(^|\/)andr\/f2(\/|$)/.test(p) || /ssstik\.io|^\d{10,}/.test(name)) return 'viral';
  if (/(^|\/)andr\/f3(\/|$)/.test(p)) return 'cinema';
  if (/(^|\/)andr\/f1(\/|$)/.test(p)) return 'biohacking';
  if (/(^|\/)andr(\/|$)/.test(p) || /(^|\/)cinema(\/|$)/.test(p)) return 'cinema';
  if (/(^|\/)etsy(\/|$)/.test(p)) return 'viral'; // local only if present; not required
  return 'stock';
}

function categoryIdForKind(kind) {
  switch (kind) {
    case 'footwork':
      return FOOTWORK_ID;
    case 'kids':
      return 'cat_kids-stories_stock';
    case 'baby_podcast':
      return BABY_PODCAST_ID;
    case 'horror':
      return 'cat_horror_stock';
    case 'cinema':
      return 'cat_art-cinema_stock';
    case 'animals':
      return 'cat_animals_stock';
    case 'biohacking':
      return 'cat_biohacking_stock';
    case 'talking_objects':
      return 'cat_talking-objects_stock';
    case 'viral':
      return 'cat_viral-shorts_stock';
    case 'life_hacks':
      return 'cat_life-hacks_stock';
    default:
      return null;
  }
}

/** Coarse post.category / topic used by ranking. */
function rankingMetaForKind(kind) {
  switch (kind) {
    case 'footwork':
      return {
        category: 'sport',
        topic: 'football',
        hashtags: ['football', 'footwork', 'sport', 'stock', 'foryou'],
      };
    case 'kids':
      return {
        category: 'kids_stories',
        topic: 'kids_stories',
        hashtags: ['kids', 'stories', 'storytime', 'kids_stories', 'stock', 'foryou'],
      };
    case 'baby_podcast':
      return {
        category: 'entertainment',
        topic: 'baby_podcast',
        hashtags: ['babypodcast', 'babycomedy', 'podcast', 'reels', 'stock', 'foryou'],
      };
    case 'horror':
      return {
        category: 'entertainment',
        topic: 'horror',
        hashtags: ['horror', 'cinema', 'stock', 'foryou'],
      };
    case 'cinema':
      return {
        category: 'art',
        topic: 'art',
        hashtags: ['art', 'cinema', 'digitalart', 'stock', 'foryou'],
      };
    case 'animals':
      return {
        category: 'pets',
        topic: 'pets',
        hashtags: ['animals', 'pets', 'wildlife', 'stock', 'foryou'],
      };
    case 'biohacking':
      return {
        category: 'education',
        topic: 'biohacking',
        hashtags: ['biohacking', 'health', 'science', 'stock', 'foryou'],
      };
    case 'talking_objects':
      return {
        category: 'entertainment',
        topic: 'comedy',
        hashtags: ['talkingobjects', 'comedy', 'skit', 'stock', 'foryou'],
      };
    case 'viral':
      return {
        category: 'entertainment',
        topic: 'viral',
        hashtags: ['shorts', 'viral', 'clips', 'stock', 'foryou'],
      };
    case 'life_hacks':
      return {
        category: 'lifestyle',
        topic: 'lifehacks',
        hashtags: ['lifehacks', 'tips', 'stock', 'foryou'],
      };
    default:
      return {
        category: 'general',
        topic: 'stock',
        hashtags: ['stock', 'foryou'],
      };
  }
}

function extractCreatorHint(filePath) {
  const name = basenameNoExt(filePath);
  const lower = name.toLowerCase();
  if (/studio\s*nayra/i.test(name)) return 'Studio Nayra';
  if (/talking\s*object/i.test(name)) return 'Talking Object';
  if (/^new\s*vids/i.test(name)) return 'New vids';
  const m = name.match(/^([A-Za-z][A-Za-z0-9]+)/);
  if (m) {
    const key = m[1].toLowerCase();
    if (CREATOR_LABELS[key]) return CREATOR_LABELS[key];
    // IG-style creator_id_id_date
    if (/^[a-z]{4,}$/i.test(m[1]) && /_\d{10,}/.test(name)) {
      return m[1].replace(/([a-z])([A-Z])/g, '$1 $2');
    }
  }
  if (/ssstik/i.test(lower)) return 'Short clip';
  return null;
}

/**
 * Human title + description from local path (no raw hashes as primary title).
 */
function buildStockCopy(filePath, kind) {
  const raw = basenameNoExt(filePath);
  const creator = extractCreatorHint(filePath);
  let title;
  let description;

  if (kind === 'kids') {
    title = cleanSpaces(raw.replace(/\(\d+\)$/g, '').replace(/\(1\)$/g, '')).slice(0, 80);
    description = `${title} — kids storytime clip.`;
  } else if (kind === 'baby_podcast') {
    const num = raw.match(/(\d{4,})/)?.[1];
    title = num ? `Baby podcast #${String(num).slice(-4)}` : 'Baby podcast reel';
    description = 'AI baby comedy podcast reel.';
  } else if (kind === 'horror') {
    const num = raw.match(/\d+/)?.[0];
    title = num ? `Horror reel #${num}` : 'Horror reel';
    description = 'Short horror cinema reel.';
  } else if (kind === 'animals') {
    const pretty = cleanSpaces(raw)
      .replace(/babylion/i, 'Baby lion')
      .replace(/lionlang/i, 'Lion lang')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 80);
    title = pretty || 'Animal clip';
    description = `${title} — wildlife / pets stock.`;
  } else if (kind === 'cinema') {
    const num = raw.match(/\((\d+)\)/)?.[1] || raw.match(/(\d{2,4})\s*$/)?.[1];
    title = num ? `Studio Nayra cinema #${num}` : 'Studio Nayra cinema';
    if (!/nayra/i.test(raw) && creator) title = `${creator} cinema${num ? ` #${num}` : ''}`;
    description = 'Art & cinema stock short.';
  } else if (kind === 'talking_objects') {
    const num = raw.match(/\((\d+)\)/)?.[1];
    title = num ? `Talking Object skit #${num}` : 'Talking Object skit';
    description = 'Talking objects comedy skit.';
  } else if (kind === 'biohacking') {
    const label = creator || 'Biohacking';
    const num = raw.match(/\((\d+)\)/)?.[1];
    title = num ? `${label} #${num}` : `${label} tip`;
    description = `${label} — health & science short.`;
  } else if (kind === 'life_hacks') {
    const num = raw.match(/\((\d+)\)/)?.[1];
    title = num ? `Life hack #${num}` : 'Life hack';
    description = 'Quick life hack short.';
  } else if (kind === 'footwork') {
    title = 'Footwork skills';
    description = 'Football / footwork skills clip.';
  } else if (kind === 'viral') {
    const num = raw.match(/(\d{4,})/)?.[1];
    title = creator && creator !== 'Short clip' ? `${creator} short` : num ? `Viral short #${String(num).slice(-4)}` : 'Viral short';
    description = 'Short-form stock clip.';
  } else {
    const cleaned = cleanSpaces(raw.replace(/\d{10,}/g, '').replace(/_+/g, ' '));
    title = (cleaned.length >= 4 ? cleaned : creator || 'Stock clip').slice(0, 80);
    description = `${title} — stock upload.`;
  }

  title = String(title || 'Stock clip').slice(0, 80);
  description = String(description || title).slice(0, 240);
  return { title, caption: title, description, transcript: description, creator };
}

function topicMetaForPath(filePath) {
  const kind = detectStockKind(filePath);
  const categoryId = categoryIdForKind(kind);
  const ranking = rankingMetaForKind(kind);
  const copy = buildStockCopy(filePath, kind);
  return {
    kind,
    stockPack:
      kind === 'cinema' ||
      kind === 'biohacking' ||
      kind === 'talking_objects' ||
      kind === 'viral' ||
      kind === 'life_hacks' ||
      kind === 'baby_podcast'
        ? 'andr'
        : kind === 'animals'
          ? 'ready'
          : kind,
    categoryId,
    ...ranking,
    ...copy,
    hashtags: Array.from(new Set([...(ranking.hashtags || []), kind, 'stock', 'foryou'].filter(Boolean))),
  };
}

module.exports = {
  FOOTWORK_ID,
  BABY_PODCAST_ID,
  STOCK_PROFILE_CATEGORIES,
  detectStockKind,
  categoryIdForKind,
  rankingMetaForKind,
  buildStockCopy,
  topicMetaForPath,
};
