// Plain JS to avoid TS compile collisions
const { Storage } = require('@google-cloud/storage');
(async () => {
  try {
    const storage = new Storage();
    const [buckets] = await storage.getBuckets();
    console.log('Project Buckets:');
    for (const b of buckets) console.log('-', b.name);
  } catch (e) {
    console.error('Bucket listing error:', e);
  }
})();
