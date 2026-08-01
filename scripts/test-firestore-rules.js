const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} = require('firebase/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-livestream';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

async function main() {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portValue] = emulatorHost.split(':');
  const port = Number.parseInt(portValue, 10) || 8080;
  const environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host,
      port,
    },
  });

  let assertionCount = 0;
  const succeeds = async (label, operation) => {
    const result = await assertSucceeds(operation);
    assertionCount += 1;
    console.log(`PASS ${String(assertionCount).padStart(3, '0')}: ${label}`);
    return result;
  };
  const fails = async (label, operation) => {
    await assertFails(operation);
    assertionCount += 1;
    console.log(`PASS ${String(assertionCount).padStart(3, '0')}: ${label}`);
  };
  const seed = async (documentPath, data) => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), documentPath), data);
    });
  };

  try {
    await environment.clearFirestore();

    const ownerId = 'user_owner';
    const viewerId = 'user_viewer';
    const outsiderId = 'user_outsider';
    const ownerDb = environment.authenticatedContext(ownerId).firestore();
    const viewerDb = environment.authenticatedContext(viewerId).firestore();
    const outsiderDb = environment.authenticatedContext(outsiderId).firestore();
    const anonymousDb = environment.unauthenticatedContext().firestore();

    console.log('\nPROFILE AND SOCIAL-EDGE POLICY');
    await succeeds(
      'a user can create only their own bounded public profile',
      setDoc(doc(ownerDb, 'users', ownerId), {
        uid: ownerId,
        displayName: 'Owner',
        username: 'owner',
        email: 'owner@example.test',
        bio: 'Canonical profile',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await succeeds(
      'an authenticated user can read a public profile',
      getDoc(doc(viewerDb, 'users', ownerId))
    );
    await fails(
      'an anonymous caller cannot read a public profile',
      getDoc(doc(anonymousDb, 'users', ownerId))
    );
    await fails(
      'a user cannot create another user document',
      setDoc(doc(viewerDb, 'users', outsiderId), {
        uid: outsiderId,
        displayName: 'Spoofed',
      })
    );
    await fails(
      'a profile owner cannot inject an administrative role',
      updateDoc(doc(ownerDb, 'users', ownerId), { role: 'admin' })
    );
    await fails(
      'a profile owner cannot inject an economy balance',
      updateDoc(doc(ownerDb, 'users', ownerId), { balance: 999999 })
    );
    await fails(
      'another authenticated user cannot edit the profile',
      updateDoc(doc(viewerDb, 'users', ownerId), { bio: 'Taken over' })
    );
    await succeeds(
      'the owner can update bounded public profile fields',
      updateDoc(doc(ownerDb, 'users', ownerId), {
        displayName: 'Owner Updated',
        bio: 'Updated safely',
        updatedAt: serverTimestamp(),
      })
    );
    await fails(
      'even the owner cannot delete the public profile from a client',
      deleteDoc(doc(ownerDb, 'users', ownerId))
    );

    await succeeds(
      'a caller can create their own following edge',
      setDoc(doc(ownerDb, 'users', ownerId, 'following', viewerId), {
        userId: viewerId,
        timestamp: serverTimestamp(),
      })
    );
    await fails(
      'another caller cannot forge an owner following edge',
      setDoc(doc(viewerDb, 'users', ownerId, 'following', outsiderId), {
        userId: outsiderId,
        timestamp: serverTimestamp(),
      })
    );
    await succeeds(
      'a follower can create their mirrored follower edge',
      setDoc(doc(viewerDb, 'users', ownerId, 'followers', viewerId), {
        userId: viewerId,
        timestamp: serverTimestamp(),
      })
    );
    await fails(
      'a caller cannot create a follower edge under another identity',
      setDoc(doc(viewerDb, 'users', ownerId, 'followers', outsiderId), {
        userId: outsiderId,
        timestamp: serverTimestamp(),
      })
    );

    console.log('\nDRAFT, POST, AND COMMENT POLICY');
    const draftId = 'draft-1';
    await succeeds(
      'an author can create an owned draft',
      setDoc(doc(ownerDb, 'drafts', draftId), {
        userId: ownerId,
        type: 'draft',
        caption: 'Work in progress',
        mediaType: 'video',
        videoUri: 'file://draft.mp4',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await succeeds(
      'the draft owner can read their draft',
      getDoc(doc(ownerDb, 'drafts', draftId))
    );
    await fails(
      'another authenticated user cannot read the draft',
      getDoc(doc(viewerDb, 'drafts', draftId))
    );
    await fails(
      'another authenticated user cannot overwrite the draft',
      updateDoc(doc(viewerDb, 'drafts', draftId), { caption: 'Stolen' })
    );

    const postId = 'post-1';
    await succeeds(
      'an author can create a bounded post with zeroed counters',
      setDoc(doc(ownerDb, 'posts', postId), {
        userId: ownerId,
        username: 'owner',
        title: 'Rules-backed post',
        caption: 'A real post',
        mediaType: 'video',
        videoUrl: 'https://media.example.test/post.mp4',
        likes: 0,
        comments: 0,
        views: 0,
        createdAt: serverTimestamp(),
      })
    );
    await succeeds(
      'an authenticated user can read a post',
      getDoc(doc(viewerDb, 'posts', postId))
    );
    await succeeds(
      'an authenticated collection query can read posts',
      getDocs(collection(viewerDb, 'posts'))
    );
    await fails(
      'an anonymous caller cannot read a post',
      getDoc(doc(anonymousDb, 'posts', postId))
    );
    await fails(
      'a caller cannot create a post under another author identity',
      setDoc(doc(viewerDb, 'posts', 'spoofed-post'), {
        userId: ownerId,
        title: 'Spoofed',
        likes: 0,
        comments: 0,
        views: 0,
      })
    );
    await fails(
      'a new post cannot begin with a fabricated like count',
      setDoc(doc(viewerDb, 'posts', 'inflated-post'), {
        userId: viewerId,
        title: 'Inflated',
        likes: 500,
        comments: 0,
        views: 0,
      })
    );
    await fails(
      'a non-owner cannot edit post content',
      updateDoc(doc(viewerDb, 'posts', postId), { caption: 'Taken over' })
    );
    await fails(
      'the owner cannot client-increment aggregate post counters',
      updateDoc(doc(ownerDb, 'posts', postId), { views: 1000 })
    );
    await succeeds(
      'the owner can edit bounded post content without changing identity',
      updateDoc(doc(ownerDb, 'posts', postId), {
        caption: 'Edited by owner',
        updatedAt: serverTimestamp(),
      })
    );

    const commentId = 'comment-1';
    await succeeds(
      'a signed-in commenter can create a caller-bound comment',
      setDoc(doc(viewerDb, 'posts', postId, 'comments', commentId), {
        postId,
        parentId: null,
        userId: viewerId,
        username: 'viewer',
        text: 'Source-backed comment',
        likes: 0,
        createdAt: serverTimestamp(),
      })
    );
    await succeeds(
      'an authenticated user can read a post comment',
      getDoc(doc(ownerDb, 'posts', postId, 'comments', commentId))
    );
    await fails(
      'a commenter cannot spoof another user identity',
      setDoc(doc(outsiderDb, 'posts', postId, 'comments', 'spoofed-comment'), {
        postId,
        parentId: null,
        userId: ownerId,
        text: 'Spoofed',
        likes: 0,
        createdAt: serverTimestamp(),
      })
    );
    await fails(
      'a comment cannot be attached to a mismatched post ID',
      setDoc(doc(outsiderDb, 'posts', postId, 'comments', 'wrong-parent'), {
        postId: 'another-post',
        parentId: null,
        userId: outsiderId,
        text: 'Wrong parent',
        likes: 0,
        createdAt: serverTimestamp(),
      })
    );
    await fails(
      'a comment author cannot fabricate engagement on update',
      updateDoc(doc(viewerDb, 'posts', postId, 'comments', commentId), { likes: 50 })
    );
    await succeeds(
      'a comment author can edit only comment text',
      updateDoc(doc(viewerDb, 'posts', postId, 'comments', commentId), {
        text: 'Corrected comment',
        updatedAt: serverTimestamp(),
      })
    );
    await fails(
      'another user cannot delete the comment',
      deleteDoc(doc(ownerDb, 'posts', postId, 'comments', commentId))
    );

    console.log('\nDIRECT CHAT POLICY');
    const chatId = 'chat-1';
    await succeeds(
      'a participant can create a two-party chat with zeroed unread counters',
      setDoc(doc(ownerDb, 'chats', chatId), {
        participants: [ownerId, viewerId],
        participantNames: ['Owner', 'Viewer'],
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp(),
        unreadCount: { [ownerId]: 0, [viewerId]: 0 },
      })
    );
    await succeeds(
      'a participant can query only chats containing their identity',
      getDocs(
        query(
          collection(ownerDb, 'chats'),
          where('participants', 'array-contains', ownerId)
        )
      )
    );
    await succeeds(
      'the second participant can read the chat',
      getDoc(doc(viewerDb, 'chats', chatId))
    );
    await fails(
      'an outsider cannot read the chat',
      getDoc(doc(outsiderDb, 'chats', chatId))
    );
    await fails(
      'a caller cannot create a chat whose participant list omits them',
      setDoc(doc(outsiderDb, 'chats', 'chat-without-caller'), {
        participants: [ownerId, viewerId],
        participantNames: ['Owner', 'Viewer'],
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp(),
        unreadCount: { [ownerId]: 0, [viewerId]: 0 },
      })
    );
    await fails(
      'a caller cannot create a duplicate-participant chat',
      setDoc(doc(ownerDb, 'chats', 'duplicate-chat'), {
        participants: [ownerId, ownerId],
        participantNames: ['Owner', 'Owner'],
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp(),
        unreadCount: { [ownerId]: 0 },
      })
    );

    const directMessageId = 'message-1';
    await succeeds(
      'a chat participant can send a caller-bound message',
      setDoc(doc(ownerDb, 'chats', chatId, 'messages', directMessageId), {
        text: 'Hello',
        senderId: ownerId,
        senderName: 'Owner',
        timestamp: serverTimestamp(),
        status: 'sent',
      })
    );
    await succeeds(
      'the other participant can read a direct message',
      getDoc(doc(viewerDb, 'chats', chatId, 'messages', directMessageId))
    );
    await fails(
      'an outsider cannot read a direct message',
      getDoc(doc(outsiderDb, 'chats', chatId, 'messages', directMessageId))
    );
    await fails(
      'a participant cannot send under the other participant identity',
      setDoc(doc(viewerDb, 'chats', chatId, 'messages', 'spoofed-message'), {
        text: 'Spoofed',
        senderId: ownerId,
        senderName: 'Owner',
        timestamp: serverTimestamp(),
        status: 'sent',
      })
    );
    await succeeds(
      'a recipient can advance receipt status to delivered',
      updateDoc(doc(viewerDb, 'chats', chatId, 'messages', directMessageId), {
        status: 'delivered',
        deliveredAt: serverTimestamp(),
      })
    );
    await fails(
      'a recipient cannot alter the sender message body',
      updateDoc(doc(viewerDb, 'chats', chatId, 'messages', directMessageId), {
        text: 'Tampered',
      })
    );
    await succeeds(
      'the sender can update the chat preview and bounded unread map',
      updateDoc(doc(ownerDb, 'chats', chatId), {
        lastMessage: 'Hello',
        lastMessageTime: serverTimestamp(),
        unreadCount: { [ownerId]: 0, [viewerId]: 1 },
      })
    );
    await fails(
      'a participant cannot replace the participant membership list',
      updateDoc(doc(ownerDb, 'chats', chatId), { participants: [ownerId, outsiderId] })
    );
    await fails(
      'a participant cannot delete the shared conversation',
      deleteDoc(doc(ownerDb, 'chats', chatId))
    );

    console.log('\nCHAT ROOM POLICY');
    const roomId = 'room-1';
    await succeeds(
      'a creator can create a bounded room with themselves as the first member',
      setDoc(doc(ownerDb, 'chatRooms', roomId), {
        name: 'Security Room',
        description: 'Rules-backed room',
        category: 'general',
        tags: ['security'],
        createdBy: ownerId,
        createdByName: 'Owner',
        createdAt: serverTimestamp(),
        participants: [ownerId],
        participantCount: 1,
        maxParticipants: 10,
        isPrivate: false,
        isActive: true,
        lastActivity: serverTimestamp(),
        lastMessage: '',
      })
    );
    await succeeds(
      'a signed-in user can discover room metadata',
      getDoc(doc(viewerDb, 'chatRooms', roomId))
    );
    await fails(
      'a room cannot be created under another creator identity',
      setDoc(doc(viewerDb, 'chatRooms', 'spoofed-room'), {
        name: 'Spoofed Room',
        description: '',
        category: 'general',
        tags: [],
        createdBy: ownerId,
        createdAt: serverTimestamp(),
        participants: [viewerId],
        participantCount: 1,
        maxParticipants: 10,
        isPrivate: false,
        isActive: true,
        lastActivity: serverTimestamp(),
      })
    );
    await succeeds(
      'a signed-in user can add only themselves to a room',
      updateDoc(doc(viewerDb, 'chatRooms', roomId), {
        participants: arrayUnion(viewerId),
        participantCount: 2,
        lastActivity: serverTimestamp(),
      })
    );
    await fails(
      'a non-creator cannot rewrite room metadata',
      updateDoc(doc(viewerDb, 'chatRooms', roomId), { name: 'Taken over' })
    );
    await fails(
      'a participant cannot remove a different room member',
      updateDoc(doc(viewerDb, 'chatRooms', roomId), {
        participants: [viewerId],
        participantCount: 1,
        lastActivity: serverTimestamp(),
      })
    );

    const roomMessageId = 'room-message-1';
    await succeeds(
      'a room participant can create a sender-bound room message',
      setDoc(doc(viewerDb, 'chatMessages', roomMessageId), {
        text: 'Room hello',
        type: 'text',
        senderId: viewerId,
        senderName: 'Viewer',
        roomId,
        timestamp: serverTimestamp(),
      })
    );
    await succeeds(
      'a room participant can read the room message',
      getDoc(doc(ownerDb, 'chatMessages', roomMessageId))
    );
    await fails(
      'an outsider cannot read a room message',
      getDoc(doc(outsiderDb, 'chatMessages', roomMessageId))
    );
    await fails(
      'an outsider cannot write a room message',
      setDoc(doc(outsiderDb, 'chatMessages', 'outsider-room-message'), {
        text: 'Intrusion',
        type: 'text',
        senderId: outsiderId,
        senderName: 'Outsider',
        roomId,
        timestamp: serverTimestamp(),
      })
    );

    console.log('\nLIVE STREAM POLICY');
    await succeeds(
      'a user can create their own live-presence profile',
      setDoc(doc(ownerDb, 'userProfiles', ownerId), {
        uid: ownerId,
        displayName: 'Owner',
        isLive: false,
        currentStreamId: null,
        createdAt: serverTimestamp(),
      })
    );
    await succeeds(
      'the live-profile owner can update presence fields',
      updateDoc(doc(ownerDb, 'userProfiles', ownerId), {
        isLive: true,
        currentStreamId: 'live-1',
        lastStreamStarted: serverTimestamp(),
      })
    );
    await fails(
      'another user cannot change the live-profile marker',
      updateDoc(doc(viewerDb, 'userProfiles', ownerId), { isLive: false })
    );

    const liveStreamId = 'live-1';
    await succeeds(
      'a host can create a caller-bound live stream',
      setDoc(doc(ownerDb, 'liveStreams', liveStreamId), {
        title: 'Rules Live',
        description: 'A real stream',
        userId: ownerId,
        hostId: ownerId,
        userName: 'Owner',
        status: 'live',
        currentSegment: -1,
        viewCount: 1,
        likes: 0,
        totalSegments: 0,
        avgSegmentSize: 0,
        streamHealth: { status: 'starting' },
        createdAt: serverTimestamp(),
        startedAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      })
    );
    await succeeds(
      'an authenticated viewer can read a live stream',
      getDoc(doc(viewerDb, 'liveStreams', liveStreamId))
    );
    await fails(
      'a viewer cannot directly manipulate aggregate live counters',
      updateDoc(doc(viewerDb, 'liveStreams', liveStreamId), { viewCount: 5000 })
    );
    await succeeds(
      'the host can append an HLS segment document',
      setDoc(doc(ownerDb, 'liveStreams', liveStreamId, 'segments', '0'), {
        number: 0,
        variant: 'source',
        url: 'https://media.example.test/segment-0.ts',
        uploadedAt: serverTimestamp(),
        clientUploadLatencyMs: 120,
      })
    );
    await fails(
      'a viewer cannot inject an HLS segment',
      setDoc(doc(viewerDb, 'liveStreams', liveStreamId, 'segments', '1'), {
        number: 1,
        variant: 'source',
        url: 'https://attacker.example.test/segment.ts',
        uploadedAt: serverTimestamp(),
      })
    );

    const liveCommentId = 'live-comment-1';
    await succeeds(
      'an authenticated viewer can add a caller-bound live comment',
      setDoc(doc(viewerDb, 'liveStreams', liveStreamId, 'comments', liveCommentId), {
        userId: viewerId,
        userName: 'Viewer',
        userPhotoURL: null,
        content: 'Live comment',
        timestamp: serverTimestamp(),
        likes: 0,
        isHighlighted: false,
      })
    );
    await fails(
      'a live commenter cannot spoof another user',
      setDoc(doc(outsiderDb, 'liveStreams', liveStreamId, 'comments', 'spoofed-live-comment'), {
        userId: viewerId,
        userName: 'Viewer',
        userPhotoURL: null,
        content: 'Spoofed live comment',
        timestamp: serverTimestamp(),
        likes: 0,
        isHighlighted: false,
      })
    );
    await succeeds(
      'the host can highlight a live comment without changing its author',
      updateDoc(doc(ownerDb, 'liveStreams', liveStreamId, 'comments', liveCommentId), {
        isHighlighted: true,
        updatedAt: serverTimestamp(),
      })
    );
    await fails(
      'a viewer cannot self-highlight a live comment',
      updateDoc(doc(viewerDb, 'liveStreams', liveStreamId, 'comments', liveCommentId), {
        isHighlighted: false,
      })
    );
    await succeeds(
      'a viewer can create only their own per-stream like document',
      setDoc(doc(viewerDb, 'liveStreams', liveStreamId, 'likes', viewerId), {
        streamId: liveStreamId,
        userId: viewerId,
        likedAt: serverTimestamp(),
      })
    );
    await fails(
      'a viewer cannot create a like document for another user',
      setDoc(doc(viewerDb, 'liveStreams', liveStreamId, 'likes', outsiderId), {
        streamId: liveStreamId,
        userId: outsiderId,
        likedAt: serverTimestamp(),
      })
    );
    await fails(
      'a client cannot write live moderation controls',
      setDoc(doc(ownerDb, 'liveStreams', liveStreamId, 'controls', 'mutes'), {
        userId: viewerId,
        mutedBy: ownerId,
      })
    );

    console.log('\nLEGACY LIVE AND GAME POLICY');
    const legacyStreamId = 'stream-1';
    await succeeds(
      'a host can create their own bounded legacy stream',
      setDoc(doc(ownerDb, 'streams', legacyStreamId), {
        hostUid: ownerId,
        hostName: 'Owner',
        title: 'Legacy stream',
        status: 'live',
        viewerCount: 0,
        createdAt: serverTimestamp(),
      })
    );
    await fails(
      'a viewer cannot manipulate a legacy stream root counter',
      updateDoc(doc(viewerDb, 'streams', legacyStreamId), { viewerCount: 99 })
    );
    await succeeds(
      'a signed-in viewer can send a caller-bound legacy stream message',
      setDoc(doc(viewerDb, 'streams', legacyStreamId, 'messages', 'legacy-message-1'), {
        senderId: viewerId,
        senderName: 'Viewer',
        text: 'Legacy hello',
        type: 'text',
        timestamp: serverTimestamp(),
      })
    );

    const gameId = 'game-1';
    await succeeds(
      'a host can create a bounded waiting game room',
      setDoc(doc(ownerDb, 'gameRooms', gameId), {
        gameType: 'rock-paper-scissors',
        hostId: ownerId,
        players: [ownerId],
        invitedUsers: [],
        status: 'waiting',
        isPrivate: false,
        createdAt: serverTimestamp(),
        maxPlayers: 2,
        gameState: {},
        currentRound: 1,
        scores: { [ownerId]: 0 },
        playerData: {
          [ownerId]: {
            name: 'Owner',
            avatar: '',
            score: 0,
            ready: false,
          },
        },
        winner: null,
        completedAt: null,
      })
    );
    await succeeds(
      'a waiting-game caller can add only themselves and self-scoped state',
      updateDoc(doc(viewerDb, 'gameRooms', gameId), {
        players: arrayUnion(viewerId),
        [`scores.${viewerId}`]: 0,
        [`playerData.${viewerId}`]: {
          name: 'Viewer',
          avatar: '',
          score: 0,
          ready: false,
        },
      })
    );
    await fails(
      'a non-host participant cannot author shared game state or scores',
      updateDoc(doc(viewerDb, 'gameRooms', gameId), {
        gameState: { round_1: { [viewerId]: 'rock' } },
        scores: { [ownerId]: 0, [viewerId]: 99 },
      })
    );
    await succeeds(
      'the host can advance the authoritative game lifecycle',
      updateDoc(doc(ownerDb, 'gameRooms', gameId), {
        status: 'active',
        startedAt: serverTimestamp(),
      })
    );

    console.log('\nREPORT, ACTIVITY, AND SERVER-ONLY POLICY');
    const reportId = 'report-1';
    await succeeds(
      'a signed-in user can submit a bounded report under their own identity',
      setDoc(doc(viewerDb, 'reports', reportId), {
        targetType: 'stream',
        targetId: liveStreamId,
        reporterId: viewerId,
        reasonCode: 'harassment',
        details: 'Bounded source-backed report details.',
        createdAt: serverTimestamp(),
        status: 'open',
      })
    );
    await fails(
      'a reporter cannot submit under another identity',
      setDoc(doc(outsiderDb, 'reports', 'spoofed-report'), {
        targetType: 'stream',
        targetId: liveStreamId,
        reporterId: viewerId,
        reasonCode: 'spam',
        details: '',
        createdAt: serverTimestamp(),
        status: 'open',
      })
    );
    await fails(
      'a client cannot read an individual report, including their own',
      getDoc(doc(viewerDb, 'reports', reportId))
    );
    await fails(
      'a client cannot enumerate open reports',
      getDocs(query(collection(ownerDb, 'reports'), where('status', '==', 'open')))
    );

    const activityId = 'activity-1';
    await seed(`activities/${activityId}`, {
      type: 'follow',
      actorId: viewerId,
      targetUserId: ownerId,
      timestamp: serverTimestamp(),
      read: false,
      metadata: { source: 'server' },
    });
    await succeeds(
      'an activity recipient can read their own activity',
      getDoc(doc(ownerDb, 'activities', activityId))
    );
    await succeeds(
      'an activity recipient can run a target-scoped activity query',
      getDocs(
        query(
          collection(ownerDb, 'activities'),
          where('targetUserId', '==', ownerId)
        )
      )
    );
    await fails(
      'an activity actor cannot read the recipient activity',
      getDoc(doc(viewerDb, 'activities', activityId))
    );
    await succeeds(
      'the activity recipient can mark only the read bit',
      updateDoc(doc(ownerDb, 'activities', activityId), { read: true })
    );
    await fails(
      'the activity recipient cannot rewrite event metadata',
      updateDoc(doc(ownerDb, 'activities', activityId), {
        metadata: { source: 'client-tamper' },
      })
    );
    await fails(
      'a client cannot create a synthetic activity',
      setDoc(doc(ownerDb, 'activities', 'synthetic-activity'), {
        type: 'admin_notice',
        actorId: ownerId,
        targetUserId: viewerId,
        timestamp: serverTimestamp(),
        read: false,
      })
    );

    const protectedServerPaths = [
      'wallets/user_owner',
      'gems/user_owner',
      'transactions/tx-1',
      'ledger_entries/ledger-1',
      'gift_catalog/gift-1',
      'gift_events/event-1',
      'iap_products/product-1',
      'alerts/alert-1',
      'analytics/event-1',
      'analyticsPurgeLog/purge-1',
      'processingAnalytics/process-1',
      'streamAlerts/stream-alert-1',
      'streamAnalytics/live-1',
      'moderationQueue/queue-1',
      'moderationActions/action-1',
      'games/legacy-game-1',
      'gameSessions/session-1',
      'test/test-1',
      'test_collection/test-1',
    ];

    for (const protectedPath of protectedServerPaths) {
      await fails(
        `client read is denied for server-only path ${protectedPath}`,
        getDoc(doc(ownerDb, protectedPath))
      );
      await fails(
        `client write is denied for server-only path ${protectedPath}`,
        setDoc(doc(ownerDb, protectedPath), {
          userId: ownerId,
          balance: 999999,
          createdAt: serverTimestamp(),
        })
      );
    }

    await fails(
      'an authenticated client cannot access an unenumerated collection',
      setDoc(doc(ownerDb, 'unexpectedCollection', 'document-1'), {
        userId: ownerId,
      })
    );
    await fails(
      'an anonymous client cannot access an unenumerated collection',
      getDoc(doc(anonymousDb, 'unexpectedCollection', 'document-1'))
    );

    console.log(`\nFirestore authorization suite passed with ${assertionCount} assertions.`);
  } finally {
    await environment.cleanup();
  }
}

main().catch((error) => {
  console.error('Firestore rules tests failed:', error);
  process.exit(1);
});
