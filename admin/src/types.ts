export interface AdminUserRow {
  userId: string;
  username?: string;
  email?: string;
  phoneNumber?: string;
  displayName?: string;
  photoURL?: string | null;
  userStatus?: string;
  enabled?: boolean;
  role: string;
  isBanned: boolean;
  banReason: string | null;
  bannedUntil: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminVerification {
  isVerified: boolean;
  note: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminRestrictions {
  messagingRestricted: boolean;
  liveRestricted: boolean;
  loginRestricted: boolean;
  accountRestricted: boolean;
  reason: string;
  expiresAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminAuditEntry {
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

export interface AdminMessage {
  messageId: string;
  channel: string;
  status: string;
  subject: string;
  body: string;
  createdAt: string | null;
}

export interface AdminUserDetail {
  userId: string;
  username?: string;
  email?: string;
  phoneNumber?: string;
  displayName?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  region?: string;
  postcode?: string;
  country?: string;
  userStatus?: string;
  enabled?: boolean;
  role: string;
  isBanned: boolean;
  banReason: string | null;
  bannedUntil: string | null;
  verification: AdminVerification;
  restrictions: AdminRestrictions;
  fraud?: {
    openChargebackCount: number;
    accountFrozen: boolean;
    underFraudReview: boolean;
    chargebackNote: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  avatarFrame: string | null;
  photoURL?: string | null;
  /** Account-wide For You / discovery weight. */
  feedPriorityAccount?: 'suppress' | 'low' | 'standard' | 'high' | 'boost';
  createdAt: string | null;
  updatedAt: string | null;
  recentActions: AdminAuditEntry[];
  recentMessages: AdminMessage[];
}

export interface AdminPost {
  postId: string;
  userId: string;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
  postType: string;
  mediaUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  likes: number;
  views: number;
  comments: number;
  isRemoved: boolean;
  removedReason: string | null;
  removedAt: string | null;
}

export interface AdminUsersResponse {
  items: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
  pageItemCount: number;
  resultState: "POPULATED" | "ZERO_MATCHES" | "EMPTY_PAGE";
  degraded?: boolean;
  detail?: string;
}

export interface AdminPostsResponse {
  items: AdminPost[];
  total: number;
  limit: number;
  offset: number;
  sourceTable?: string;
  degraded?: boolean;
  detail?: string;
}

export interface MetricsOverview {
  totalUsers: number;
  bannedUsers: number;
  directoryUsers?: number;
  activeUsers?: number;
  totalCoinSupply: number;
  gifts24h: number;
  ledgerEntries24h: number;
  activeSubscriptions: number;
  generatedAt: string;
  degraded?: boolean;
  detail?: string;
}

export interface GlobalPost extends AdminPost {
  authorUsername: string;
  authorDisplayName: string;
}

export interface LiveStream {
  streamId: string;
  userId: string;
  hostDisplayName: string;
  hostUsername: string;
  title: string;
  status: string;
  viewerCount: number;
  peakViewerCount: number;
  totalViews: number;
  likes: number;
  thumbnailUrl: string | null;
  createdAt: string | null;
  lastHeartbeatAt: string | null;
}

export interface LiveResponse {
  items: LiveStream[];
  live: number;
  total: number;
  totalViewers: number;
  degraded?: boolean;
  detail?: string;
}

export interface GlobalPostsResponse {
  items: GlobalPost[];
  total: number;
  limit: number;
  offset: number;
  sourceTable?: string;
  degraded?: boolean;
  detail?: string;
}

export interface AuditItem {
  id: number;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

export interface AuditResponse {
  items: AuditItem[];
  total: number;
  limit: number;
  offset: number;
  degraded?: boolean;
  detail?: string;
}

export interface AnalyticsResponse {
  generatedAt: string;
  totals: {
    directoryUsers: number;
    totalPosts: number;
    postsCounted: boolean;
    signups7d: number;
    posts7d: number;
  };
  signupsByDay: Array<{ date: string; count: number }>;
  postsByDay: Array<{ date: string; count: number }>;
  topCreators: Array<{ userId: string; count: number; displayName: string }>;
  countries: Array<{ country: string; count: number }>;
}

export interface AdminMessageRow {
  messageId: string;
  userId: string;
  channel: string;
  status: string;
  subject: string;
  body: string;
  broadcast: boolean;
  createdAt: string | null;
}

export interface MessagesResponse {
  items: AdminMessageRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface CatalogResponse {
  gifts: Array<{ giftId: string; name: string; coinCost: number; enabled: boolean; rarity: string }>;
  iapProducts: Array<{ platform: string; sku: string; coinsGranted: number; enabled: boolean }>;
  degraded?: boolean;
}

/** Honest ops readiness — never includes secrets. */
export interface OpsControlPlane {
  generatedAt: string;
  withdrawals: {
    enableWithdrawalsEnv: boolean;
    stripeConfigured: boolean;
    stripeWebhookConfigured?: boolean;
    stripeKeyMode?: "absent" | "test" | "live" | "unknown";
    stripeLiveKeyPresent?: boolean;
    stripeConnectRequired?: boolean;
    stripeNote?: string;
    paypalConfigured?: boolean;
    paypalMode?: "absent" | "sandbox" | "live";
    paypalNote?: string;
    effectivelyEnabled: boolean;
    note: string;
  };
  killSwitches: {
    streamingEnabled: boolean | null;
    featureFlags: Record<string, boolean>;
  };
  envReadOnly: {
    liveMarbleRaceEnabled?: boolean;
  };
  banCache?: {
    size: number;
    ttlMs: number;
    failOpenOnDbMiss: boolean;
    note: string;
  };
  dualControlUi?: {
    creditCoinsWarnAt: number;
    withdrawalApproveWarnAtGems: number;
    note: string;
  };
}

export interface WalletResponse {
  available: boolean;
  userId: string;
  coinBalance?: number;
  bonusCoinBalance?: number;
  gemAvailable?: number;
  gemPending?: number;
  detail?: string;
}

export interface LedgerItem {
  ledgerId: string;
  userId: string;
  entryType: string;
  currency: string;
  amount: number;
  status?: string;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface LedgerResponse {
  items: LedgerItem[];
  nextCursor: string | null;
  degraded?: boolean;
  detail?: string;
  dualControlUi?: OpsControlPlane["dualControlUi"];
}

export interface IapPurchaseItem extends LedgerItem {
  platform?: string;
  sku?: string;
  storeTransactionId?: string;
  anomalyHints: string[];
}

export interface IapPurchasesResponse {
  items: IapPurchaseItem[];
  nextCursor: string | null;
  source: string;
  note: string;
  degraded?: boolean;
  detail?: string;
}

export interface LiveRoomDetail {
  sessionId: string;
  hostUserId: string | null;
  title: string | null;
  status: string | null;
  viewerCount: number | null;
  peakViewerCount: number | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  firestore: LiveStream | null;
  dynamo: {
    sessionId: string;
    hostUserId: string;
    title: string;
    status: string;
    createdAt: string;
    endedAt: string | null;
    region: string | null;
    moderators: string[];
  } | null;
}

export interface BanCacheResponse {
  generatedAt: string;
  stats: { size: number; ttlMs: number; failOpenOnDbMiss: boolean; note: string };
  probe: {
    userId: string;
    dbBanned: boolean | null;
    cachedBanned: boolean | null;
    cacheHit: boolean;
    cacheExpiresAt: string | null;
    inSync: boolean | null;
    detail?: string;
  } | null;
}

export interface FraudSignalsResponse {
  generatedAt: string;
  windowHours: number;
  rapidPairs: Array<{ senderUserId: string; receiverUserId: string; giftCount: number; coinSpent: number }>;
  circularHints: Array<{ userA: string; userB: string; aToB: number; bToA: number }>;
  topSenders: Array<{ userId: string; giftCount: number; coinSpent: number }>;
  deviceReuse: { available: false; detail: string };
  degraded?: boolean;
  detail?: string;
  note: string;
}

export interface PromoteResponse {
  items: Array<{
    promotionId: string;
    userId: string;
    promotionType: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    coinCost: number;
    createdAt: string | null;
  }>;
  total: number;
  degraded?: boolean;
  detail?: string;
}

export interface DatingDeskResponse {
  available: boolean;
  prefsSample: Array<{
    userId: string;
    enabled: boolean | null;
    lookingFor: string | null;
    updatedAt: string | null;
  }>;
  datingReports: Array<{
    reportId: string;
    targetId: string;
    reporterId: string;
    reasonCode: string;
    status: string;
    surface: string | null;
    createdAt: string | null;
  }>;
  detail?: string;
  note: string;
}

export interface StrikeSummary {
  userId: string;
  activeCount: number;
  strikes: Array<{
    strikeId: string;
    reason: string;
    surface: string | null;
    relatedReportId: string | null;
    actorUserId: string;
    active: boolean;
    createdAt: string | null;
  }>;
  degraded?: boolean;
  detail?: string;
}

export interface AppealsResponse {
  items: Array<{
    appealId: string;
    userId: string;
    strikeId: string | null;
    status: string;
    statement: string;
    resolutionNote: string | null;
    resolvedByUserId: string | null;
    resolvedAt: string | null;
    createdAt: string | null;
  }>;
  total: number;
  degraded?: boolean;
  detail?: string;
}

export interface AppVersionPolicy {
  enabled: boolean;
  minimumAndroidVersionCode: number | null;
  message?: string;
  storeUrl?: string;
}

export interface UserSourceStats {
  generatedAt: string;
  counts: Array<{ source: string; table: string; exists: boolean; distinctUsers?: number; error?: string }>;
}

export interface AdminTeamRow {
  teamId: string;
  name: string;
  description?: string;
  leaderId: string;
  leaderName: string;
  memberCount: number;
  createdAt: string | null;
}

export interface TeamsResponse {
  items: AdminTeamRow[];
  total: number;
  degraded?: boolean;
  detail?: string;
}

export interface AdminTeamApplication {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  pitch: string;
  status: string;
  createdAt: string | null;
}

export interface TeamApplicationsResponse {
  items: AdminTeamApplication[];
  total: number;
  pendingCount: number;
  degraded?: boolean;
  detail?: string;
}
