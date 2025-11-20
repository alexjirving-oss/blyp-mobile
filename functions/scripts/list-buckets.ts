import { Storage } from '@google-cloud/storage';

async function main() {
  const storage = new Storage();
  try {
    const [buckets] = await storage.getBuckets();
    console.log('Project Buckets:');
    for (const b of buckets) {
      console.log('-', b.name);
    }
  } catch (e) {
    console.error('Error listing buckets', e);
  }
}
main();
