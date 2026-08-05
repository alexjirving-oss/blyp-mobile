"use strict";
/**
 * On-platform results: Blyp posts/videos and creators. Server-side relevance over
 * a bounded recent window (cached, so repeat queries are cheap). Phase 5 replaces
 * this with the merit/Blyp-Score-backed index; this is the honest interim.
 *
 * Charter rule: if nothing is genuinely relevant we return NOTHING - we never pad
 * the results to fill space.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchPosts = searchPosts;
exports.searchCreators = searchCreators;
const firebaseAdmin_1 = require("../firebaseAdmin");
const GENERIC = new Set([
    'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'with', 'best', 'top',
    'near', 'me', 'video', 'videos', 'post', 'posts', 'show', 'find', 'latest', 'news', 'how', 'what', 'is',
]);
function coreTerms(query) {
    return query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !GENERIC.has(t));
}
function scoreText(haystack, terms) {
    const h = haystack.toLowerCase();
    let score = 0;
    for (const t of terms)
        if (h.includes(t))
            score += 1;
    return score;
}
async function searchPosts(query, limit = 8) {
    const terms = coreTerms(query);
    if (!terms.length)
        return [];
    try {
        (0, firebaseAdmin_1.initFirebaseAdmin)();
        const snap = await firebaseAdmin_1.admin.firestore().collection('posts').orderBy('createdAt', 'desc').limit(200).get();
        const scored = [];
        snap.docs.forEach((d) => {
            const data = d.data();
            const hay = [data.caption, data.title, data.description, (data.tags || []).join(' '), (data.hashtags || []).join(' ')]
                .filter(Boolean)
                .join(' ');
            const score = scoreText(hay, terms);
            if (score <= 0)
                return;
            scored.push({
                score,
                r: {
                    kind: 'post',
                    title: data.caption || data.title || 'Untitled',
                    snippet: data.description || '',
                    entityId: d.id,
                    entity: Object.assign({ id: d.id }, data),
                    provenance: { provider: 'blypPosts', providerVersion: '1', fetchedAt: Date.now(), ownerType: 'creator', ownerId: data.userId },
                },
            });
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map((s) => s.r);
    }
    catch (_a) {
        return [];
    }
}
async function searchCreators(query, limit = 6) {
    const terms = coreTerms(query);
    if (!terms.length)
        return [];
    try {
        (0, firebaseAdmin_1.initFirebaseAdmin)();
        const snap = await firebaseAdmin_1.admin.firestore().collection('users').limit(300).get();
        const scored = [];
        snap.docs.forEach((d) => {
            const data = d.data();
            const hay = [data.displayName, data.username, data.bio].filter(Boolean).join(' ');
            const score = scoreText(hay, terms);
            if (score <= 0)
                return;
            scored.push({
                score,
                r: {
                    kind: 'creator',
                    title: data.displayName || data.username || 'Creator',
                    snippet: data.bio || '',
                    entityId: d.id,
                    entity: Object.assign({ id: d.id }, data),
                    provenance: { provider: 'blypCreators', providerVersion: '1', fetchedAt: Date.now(), ownerType: 'creator', ownerId: d.id },
                },
            });
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map((s) => s.r);
    }
    catch (_a) {
        return [];
    }
}
//# sourceMappingURL=postsProvider.js.map