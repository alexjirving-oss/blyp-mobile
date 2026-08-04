import type * as functions from 'firebase-functions';

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  const s = String(raw || '').trim();
  if (!s) return set;

  for (const part of s.split(',')) {
    const origin = part.trim();
    if (!origin) continue;
    if (origin === '*') continue; // explicit deny: no wildcard for authenticated endpoints
    set.add(origin);
  }

  return set;
}

export function applyCors(req: functions.https.Request, res: functions.Response<any>, opts: {
  methods: string;
  allowHeaders?: string;
}) {
  const origin = String(req.headers.origin || '').trim();
  const allowed = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

  // Only set Access-Control-Allow-Origin when Origin is explicitly allowlisted.
  if (origin && allowed.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }

  res.set('Access-Control-Allow-Methods', opts.methods);
  res.set('Access-Control-Allow-Headers', opts.allowHeaders || 'Content-Type, Authorization');
}
