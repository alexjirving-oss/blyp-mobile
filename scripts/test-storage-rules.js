/**
 * Owner-scoped Firebase Storage Security Rules tests.
 *
 * Run only against the local Storage emulator. The suite covers every active
 * client upload namespace plus cross-user and unlisted-path adversarial cases.
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-livestream';
const RULES_PATH = path.join(__dirname, '..', 'storage.rules');

async function main() {
  const emulatorHost =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
  const [host, portValue] = emulatorHost.split(':');
  const port = Number.parseInt(portValue, 10) || 9199;
  const bucketUrl = `gs://${PROJECT_ID}.appspot.com`;

  const environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host,
      port,
    },
  });

  let assertions = 0;
  const succeeds = async (label, operation) => {
    await assertSucceeds(operation);
    assertions += 1;
    console.log(`PASS ${assertions}: ${label}`);
  };
  const fails = async (label, operation) => {
    await assertFails(operation);
    assertions += 1;
    console.log(`PASS ${assertions}: ${label}`);
  };

  try {
    const ownerStorage = environment
      .authenticatedContext('user_owner')
      .storage(bucketUrl);
    const attackerStorage = environment
      .authenticatedContext('user_attacker')
      .storage(bucketUrl);
    const viewerStorage = environment
      .authenticatedContext('user_viewer')
      .storage(bucketUrl);
    const anonymousStorage = environment.unauthenticatedContext().storage(bucketUrl);

    const segmentPath = 'streams/user_owner/stream-1/segment_0.mp4';
    const streamThumbnailPath =
      'streams/user_owner/thumbnail_1700000000000.jpg';
    const profilePath =
      'users/user_owner/profile/user_owner-profile-1700000000000.jpg';
    const postPhotoPath = 'users/user_owner/media/photo-1700000000000.jpg';
    const postVideoPath = 'users/user_owner/media/video-1700000000001.mp4';
    const postThumbnailPath =
      'users/user_owner/thumbnails/thumbnail-1700000000002.jpg';
    const legacyProfilePath = 'userProfiles/user_owner/profile.jpg';
    const playlistPath =
      'streams/user_owner/stream-1/playlists/master.m3u8';
    const renditionPath =
      'streams/user_owner/stream-1/qualities/720p/segment_0.ts';
    const privatePath = 'internal/config/private.json';

    await environment.withSecurityRulesDisabled(async (context) => {
      const storage = context.storage(bucketUrl);
      await storage.ref(playlistPath).put(Buffer.from('#EXTM3U'), {
        contentType: 'application/vnd.apple.mpegurl',
      });
      await storage.ref(renditionPath).put(Buffer.from('server rendition'), {
        contentType: 'video/mp2t',
      });
      await storage.ref(privatePath).put(Buffer.from('{}'), {
        contentType: 'application/json',
      });
    });

    await succeeds(
      'stream owner can upload a valid segment',
      ownerStorage.ref(segmentPath).put(Buffer.alloc(1024), {
        contentType: 'video/mp4',
      })
    );
    await succeeds(
      'anonymous playback can fetch a known stream segment',
      anonymousStorage.ref(segmentPath).getMetadata()
    );
    await succeeds(
      'authenticated viewers can fetch a known stream segment',
      viewerStorage.ref(segmentPath).getMetadata()
    );
    await fails(
      'a different user cannot overwrite the owner segment',
      attackerStorage.ref(segmentPath).put(Buffer.alloc(32), {
        contentType: 'video/mp4',
      })
    );
    await fails(
      'a different user cannot delete the owner segment',
      attackerStorage.ref(segmentPath).delete()
    );
    await fails(
      'segment filenames outside segment_{N}.mp4 are denied',
      ownerStorage
        .ref('streams/user_owner/stream-1/arbitrary.mp4')
        .put(Buffer.alloc(32), { contentType: 'video/mp4' })
    );
    await fails(
      'segment uploads with unsupported MIME types are denied',
      ownerStorage
        .ref('streams/user_owner/stream-1/segment_1.mp4')
        .put(Buffer.from('not video'), { contentType: 'text/plain' })
    );
    await fails(
      'zero-byte segment uploads are denied',
      ownerStorage
        .ref('streams/user_owner/stream-1/segment_2.mp4')
        .put(Buffer.alloc(0), { contentType: 'video/mp4' })
    );
    await fails(
      'segments at the 10 MiB limit are denied',
      ownerStorage
        .ref('streams/user_owner/stream-1/segment_3.mp4')
        .put(Buffer.alloc(10 * 1024 * 1024), { contentType: 'video/mp4' })
    );
    await succeeds(
      'the stream owner can delete their segment',
      ownerStorage.ref(segmentPath).delete()
    );

    await succeeds(
      'stream owner can upload the active thumbnail filename',
      ownerStorage.ref(streamThumbnailPath).put(Buffer.alloc(1024), {
        contentType: 'image/jpeg',
      })
    );
    await fails(
      'a different user cannot upload into the owner stream-thumbnail path',
      attackerStorage.ref(streamThumbnailPath).put(Buffer.alloc(32), {
        contentType: 'image/jpeg',
      })
    );
    await fails(
      'stream thumbnails at the 5 MiB limit are denied',
      ownerStorage
        .ref('streams/user_owner/thumbnail_1700000000001.jpg')
        .put(Buffer.alloc(5 * 1024 * 1024), { contentType: 'image/jpeg' })
    );

    await succeeds(
      'owner can upload the current profile-image path',
      ownerStorage.ref(profilePath).put(Buffer.alloc(1024), {
        contentType: 'application/octet-stream',
      })
    );
    await succeeds(
      'owner can upload a post photo',
      ownerStorage.ref(postPhotoPath).put(Buffer.alloc(1024), {
        contentType: 'image/jpeg',
      })
    );
    await succeeds(
      'owner can upload a post video',
      ownerStorage.ref(postVideoPath).put(Buffer.alloc(1024), {
        contentType: 'video/mp4',
      })
    );
    await succeeds(
      'owner can upload a generated post thumbnail',
      ownerStorage.ref(postThumbnailPath).put(Buffer.alloc(1024), {
        contentType: 'image/jpeg',
      })
    );
    await succeeds(
      'owner can still upload to the previously deployed profile namespace',
      ownerStorage.ref(legacyProfilePath).put(Buffer.alloc(1024), {
        contentType: 'image/jpeg',
      })
    );
    await succeeds(
      'anonymous users can fetch known user media for feed playback',
      anonymousStorage.ref(postVideoPath).getMetadata()
    );
    await fails(
      'a different user cannot write profile images for the owner',
      attackerStorage.ref(profilePath).put(Buffer.alloc(32), {
        contentType: 'image/jpeg',
      })
    );
    await fails(
      'a different user cannot write post media for the owner',
      attackerStorage.ref(postPhotoPath).put(Buffer.alloc(32), {
        contentType: 'image/jpeg',
      })
    );
    await fails(
      'a different user cannot write post thumbnails for the owner',
      attackerStorage.ref(postThumbnailPath).put(Buffer.alloc(32), {
        contentType: 'image/jpeg',
      })
    );
    await fails(
      'owners cannot write unlisted nested paths under their user namespace',
      ownerStorage
        .ref('users/user_owner/admin/config.json')
        .put(Buffer.from('{}'), { contentType: 'application/json' })
    );
    await fails(
      'post media filenames outside the live app convention are denied',
      ownerStorage
        .ref('users/user_owner/media/arbitrary.mp4')
        .put(Buffer.alloc(32), { contentType: 'video/mp4' })
    );
    await fails(
      'post-media uploads with unsupported MIME types are denied',
      ownerStorage
        .ref('users/user_owner/media/video-1700000000003.mp4')
        .put(Buffer.from('not video'), { contentType: 'text/plain' })
    );
    await fails(
      'image extensions outside the allowed set are denied',
      ownerStorage
        .ref('users/user_owner/profile/avatar.exe')
        .put(Buffer.alloc(32), { contentType: 'image/jpeg' })
    );
    await fails(
      'anonymous users cannot upload to owner-scoped paths',
      anonymousStorage
        .ref('users/user_owner/media/photo-1700000000004.jpg')
        .put(Buffer.alloc(32), { contentType: 'image/jpeg' })
    );

    await succeeds(
      'anonymous playback can fetch a known server-generated playlist',
      anonymousStorage.ref(playlistPath).getMetadata()
    );
    await succeeds(
      'anonymous playback can fetch a known server-generated rendition',
      anonymousStorage.ref(renditionPath).getMetadata()
    );
    await fails(
      'client owners cannot write server-generated playlists',
      ownerStorage.ref(playlistPath).put(Buffer.from('#EXTM3U'), {
        contentType: 'application/vnd.apple.mpegurl',
      })
    );
    await fails(
      'client owners cannot write server-generated renditions',
      ownerStorage.ref(renditionPath).put(Buffer.alloc(32), {
        contentType: 'video/mp2t',
      })
    );
    await fails(
      'client owners cannot write arbitrary nested stream paths',
      ownerStorage
        .ref('streams/user_owner/stream-1/private/evil.mp4')
        .put(Buffer.alloc(32), { contentType: 'video/mp4' })
    );

    await succeeds(
      'stream owner can list their own namespace for cleanup',
      ownerStorage.ref('streams/user_owner').listAll()
    );
    await fails(
      'a different user cannot list the owner stream namespace',
      attackerStorage.ref('streams/user_owner').listAll()
    );
    await fails(
      'anonymous users cannot enumerate stream objects',
      anonymousStorage.ref('streams/user_owner').listAll()
    );
    await fails(
      'user-media namespaces cannot be enumerated by clients',
      ownerStorage.ref('users/user_owner').listAll()
    );

    await fails(
      'unlisted existing objects are not publicly readable',
      anonymousStorage.ref(privatePath).getMetadata()
    );
    await fails(
      'authenticated users cannot read unlisted existing objects',
      viewerStorage.ref(privatePath).getMetadata()
    );
    await fails(
      'authenticated users cannot write arbitrary top-level paths',
      ownerStorage.ref('backups/user_owner/archive.bin').put(Buffer.alloc(32), {
        contentType: 'application/octet-stream',
      })
    );

    console.log(`Storage rules tests passed: ${assertions} assertions`);
  } finally {
    await environment.cleanup();
  }
}

main().catch((error) => {
  console.error('Storage rules tests failed:', error);
  process.exit(1);
});
