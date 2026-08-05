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
