/**
 * Fail Cloud Run source builds that ship a stale/partial `src/` tree.
 * Revision 00193 rebuilt from an incomplete upload that only had liveRoutes,
 * wiping Frenemies/rooms/marble from the running image (HTML Express 404s).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = [
  'src/index.ts',
  'src/routes/liveRoutes.ts',
  'src/routes/frenemiesRoutes.ts',
  'src/routes/roomsRoutes.ts',
  'src/routes/gameRoutes.ts',
  'src/routes/marbleRoutes.ts',
  'src/routes/battleRoutes.ts',
  'src/routes/reactionDuelRoutes.ts',
  'src/games/grid9/grid9AtomicScript.ts',
  'src/games/grid9/grid9Engine.ts',
  'src/games/grid9/grid9GameLoop.ts',
  'src/games/grid9/grid9Socket.ts',
];

const missing = required.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error('[assert-live-game-routes] Incomplete live-service source upload:');
  for (const rel of missing) console.error(`  - missing ${rel}`);
  process.exit(1);
}

const indexSrc = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
for (const needle of ['frenemiesRoutes', 'roomsRoutes', 'gameRoutes', 'marbleRoutes']) {
  if (!indexSrc.includes(needle)) {
    console.error(`[assert-live-game-routes] src/index.ts does not mount ${needle}`);
    process.exit(1);
  }
}

const socketSrc = fs.readFileSync(path.join(root, 'src/realtime/socketServer.ts'), 'utf8');
for (const needle of ['registerGrid9Socket', 'startGrid9GameLoop']) {
  if (!socketSrc.includes(needle)) {
    console.error(`[assert-live-game-routes] socketServer.ts does not wire ${needle}`);
    process.exit(1);
  }
}

console.log('[assert-live-game-routes] ok');
