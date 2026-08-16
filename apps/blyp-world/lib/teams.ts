import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  addDoc,
  limit,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { liveServiceUrl, siteUrl } from "./env";
import { fetchLiveDirectory, type LiveCard } from "./live";
import {
  estimateAgencyEarnings,
  estimateGiftSpendFromCreatorGems,
  type AgencyTier,
} from "./teamEconomy";

export type TeamMember = {
  uid: string;
  displayName: string;
  username: string;
  role: string;
  photoURL?: string | null;
  totalEarned?: number;
  teamBonusGems?: number;
  hoursLive?: number;
  joinedAtMs?: number | null;
  restricted?: boolean;
  warningCount?: number;
  isLive?: boolean;
  liveStreamId?: string | null;
  liveTitle?: string | null;
  liveViewers?: number;
};

export type TeamJoinRequest = {
  uid: string;
  displayName: string;
  username: string;
  message?: string;
  status: string;
  photoURL?: string | null;
};

export type TeamBattle = {
  id: string;
  aUid: string;
  aName: string;
  bUid: string;
  bName: string;
  status: string;
  note?: string;
  scheduledAtMs?: number | null;
  createdAtMs?: number | null;
  /** Cross-agency peer team when challenge is linked. */
  opponentTeamId?: string | null;
  opponentTeamName?: string | null;
  source?: "internal" | "linked" | string;
  /** Present when a scored fight lands a winner. */
  winnerUid?: string | null;
};

export type AgencyLinkVisibility = "public" | "private";
export type AgencyLinkStatus = "pending" | "active" | "rejected" | "revoked";

export type TeamAgencyLink = {
  id: string;
  teamIds: [string, string];
  peerTeamId: string;
  peerTeamName: string;
  visibility: AgencyLinkVisibility;
  status: AgencyLinkStatus;
  requestedByTeamId: string;
  requestedByUid: string;
  isIncoming: boolean;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
};

export type TeamBattleParams = {
  durationMinutes: number;
  giftWindowMinutes: number;
  cooldownMinutes: number;
  allowInternal: boolean;
  allowLinked: boolean;
  /** Who may open a challenge pick. */
  challengers: "members" | "leader_only";
};

export type LinkedOpponent = {
  uid: string;
  displayName: string;
  username: string;
  photoURL?: string | null;
  isLive?: boolean;
  teamId: string;
  teamName: string;
  linkVisibility: AgencyLinkVisibility;
  source: "roster" | "linked";
};

export const DEFAULT_BATTLE_PARAMS: TeamBattleParams = {
  durationMinutes: 5,
  giftWindowMinutes: 5,
  cooldownMinutes: 30,
  allowInternal: true,
  allowLinked: true,
  challengers: "members",
};

export type TeamApplicationStatus = {
  status: string;
  pitch?: string;
  teamName?: string | null;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
};

export type TeamReferral = {
  id: string;
  email: string;
  name: string;
  note: string;
  roleHint: "host" | "co-leader" | "member";
  status: string;
  inviteUrl: string;
  emailSent: boolean;
  createdAtMs?: number | null;
};

export type TeamBundle = {
  teamId: string;
  name: string;
  leaderId: string;
  leaderName: string;
  memberCount: number;
  teamTotalGems: number;
  leaderBonusGems: number;
  wins?: number;
  battles?: number;
  crestUrl?: string | null;
  isLeader: boolean;
  members: TeamMember[];
  joinRequests: TeamJoinRequest[];
  teamBattles: TeamBattle[];
  referrals: TeamReferral[];
  agencyLinks: TeamAgencyLink[];
  battleParams: TeamBattleParams;
  /** Eligible pick list: same roster + active linked agency hosts. */
  linkedOpponents: LinkedOpponent[];
  weeklyHours?: number | null;
  /** Estimated gift spend (coins) from creator-half gems when GMV field missing. */
  estimatedGiftSpend: number;
  /** Live leaderBonusGems when set; else estimate at base 10%. */
  agencyEarningsDisplay: number;
  agencyEarningsIsEstimate: boolean;
  agencyTier: AgencyTier;
  liveNowCount: number;
  inactiveCount: number;
};

function asNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "object") {
    const o = v as { toMillis?: () => number; seconds?: number };
    try {
      if (typeof o.toMillis === "function") return o.toMillis();
      if (typeof o.seconds === "number") return o.seconds * 1000;
    } catch {
      return null;
    }
  }
  return null;
}

function person(row: Record<string, unknown>, uid: string): TeamMember {
  return {
    uid,
    displayName: String(row.displayName || row.name || "Member"),
    username: String(row.username || uid.slice(0, 8)),
    role: String(row.role || "member"),
    photoURL: (row.photoURL || row.photo || null) as string | null,
    totalEarned: asNum(row.totalEarned ?? row.lifetimeGems ?? row.gemsEarned),
    teamBonusGems: asNum(row.teamBonusGems),
    hoursLive: asNum(row.hoursLive ?? row.weekLiveHours ?? row.liveHours),
    joinedAtMs: toMs(row.joinedAt),
    restricted: !!row.restricted,
    warningCount: asNum(row.warningCount),
  };
}

function battleRow(id: string, row: Record<string, unknown>): TeamBattle {
  const winnerRaw = row.winnerUid ?? row.winnerId;
  return {
    id,
    aUid: String(row.aUid || ""),
    aName: String(row.aName || "Member A"),
    bUid: String(row.bUid || ""),
    bName: String(row.bName || "Member B"),
    status: String(row.status || "scheduled"),
    note: row.note ? String(row.note) : "",
    scheduledAtMs: toMs(row.scheduledAt),
    createdAtMs: toMs(row.createdAt),
    opponentTeamId: row.opponentTeamId ? String(row.opponentTeamId) : null,
    opponentTeamName: row.opponentTeamName
      ? String(row.opponentTeamName)
      : null,
    source: row.source ? String(row.source) : undefined,
    winnerUid: winnerRaw ? String(winnerRaw) : null,
  };
}

export function parseBattleParams(raw: unknown): TeamBattleParams {
  const d =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const challengersRaw = String(d.challengers || "members").toLowerCase();
  return {
    durationMinutes: Math.min(
      60,
      Math.max(1, asNum(d.durationMinutes) || DEFAULT_BATTLE_PARAMS.durationMinutes),
    ),
    giftWindowMinutes: Math.min(
      60,
      Math.max(
        1,
        asNum(d.giftWindowMinutes) || DEFAULT_BATTLE_PARAMS.giftWindowMinutes,
      ),
    ),
    cooldownMinutes: Math.min(
      24 * 60,
      Math.max(0, asNum(d.cooldownMinutes) || DEFAULT_BATTLE_PARAMS.cooldownMinutes),
    ),
    allowInternal:
      d.allowInternal === undefined
        ? DEFAULT_BATTLE_PARAMS.allowInternal
        : !!d.allowInternal,
    allowLinked:
      d.allowLinked === undefined
        ? DEFAULT_BATTLE_PARAMS.allowLinked
        : !!d.allowLinked,
    challengers:
      challengersRaw === "leader_only" || challengersRaw === "leader-only"
        ? "leader_only"
        : "members",
  };
}

function linkRow(
  id: string,
  row: Record<string, unknown>,
  myTeamId: string,
): TeamAgencyLink | null {
  const ids = Array.isArray(row.teamIds)
    ? (row.teamIds as unknown[]).map((x) => String(x || "")).filter(Boolean)
    : [String(row.teamAId || ""), String(row.teamBId || "")].filter(Boolean);
  if (ids.length < 2) return null;
  const teamIds = [ids[0], ids[1]] as [string, string];
  if (!teamIds.includes(myTeamId)) return null;
  const peerTeamId = teamIds[0] === myTeamId ? teamIds[1] : teamIds[0];
  const names =
    row.teamNames && typeof row.teamNames === "object"
      ? (row.teamNames as Record<string, unknown>)
      : {};
  const peerTeamName = String(
    names[peerTeamId] ||
      row.peerTeamName ||
      (peerTeamId === row.teamBId ? row.teamBName : row.teamAName) ||
      "Agency",
  );
  const vis = String(row.visibility || "private").toLowerCase();
  const st = String(row.status || "pending").toLowerCase();
  return {
    id,
    teamIds,
    peerTeamId,
    peerTeamName,
    visibility: vis === "public" ? "public" : "private",
    status:
      st === "active"
        ? "active"
        : st === "rejected"
          ? "rejected"
          : st === "revoked"
            ? "revoked"
            : "pending",
    requestedByTeamId: String(row.requestedByTeamId || ""),
    requestedByUid: String(row.requestedByUid || ""),
    isIncoming:
      String(row.requestedByTeamId || "") !== myTeamId &&
      String(row.status || "pending").toLowerCase() === "pending",
    createdAtMs: toMs(row.createdAt),
    updatedAtMs: toMs(row.updatedAt),
  };
}

export function teamInviteUrl(team: {
  teamId: string;
  name?: string;
  leaderName?: string;
}): string {
  const parts = [`join=${encodeURIComponent(team.teamId)}`];
  if (team.name) parts.push(`t=${encodeURIComponent(team.name.slice(0, 80))}`);
  if (team.leaderName) {
    parts.push(`leader=${encodeURIComponent(team.leaderName.slice(0, 60))}`);
  }
  return `${siteUrl}/teams/?${parts.join("&")}`;
}

export function teamDeepLink(teamId: string): string {
  return `blyp://team/${encodeURIComponent(teamId)}`;
}

function enrichEconomy(
  base: Omit<
    TeamBundle,
    | "estimatedGiftSpend"
    | "agencyEarningsDisplay"
    | "agencyEarningsIsEstimate"
    | "agencyTier"
    | "liveNowCount"
    | "inactiveCount"
  > &
    Partial<
      Pick<
        TeamBundle,
        | "estimatedGiftSpend"
        | "agencyEarningsDisplay"
        | "agencyEarningsIsEstimate"
        | "agencyTier"
        | "liveNowCount"
        | "inactiveCount"
      >
    >,
): TeamBundle {
  const creatorGems =
    base.teamTotalGems > 0
      ? base.teamTotalGems
      : base.members.reduce((s, m) => s + (m.totalEarned || 0), 0);
  const estimatedGiftSpend = estimateGiftSpendFromCreatorGems(creatorGems);
  const hasLiveCut = base.leaderBonusGems > 0;
  const agencyTier: AgencyTier = "base";
  const agencyEarningsDisplay = hasLiveCut
    ? base.leaderBonusGems
    : estimateAgencyEarnings(estimatedGiftSpend, agencyTier);
  const liveNowCount = base.members.filter((m) => m.isLive).length;
  const inactiveCount = base.members.filter(
    (m) => m.role !== "leader" && !(m.hoursLive || 0) && !m.isLive,
  ).length;

  return {
    ...base,
    teamBattles: base.teamBattles || [],
    referrals: base.referrals || [],
    agencyLinks: base.agencyLinks || [],
    battleParams: base.battleParams || DEFAULT_BATTLE_PARAMS,
    linkedOpponents: base.linkedOpponents || [],
    estimatedGiftSpend,
    agencyEarningsDisplay,
    agencyEarningsIsEstimate: !hasLiveCut && estimatedGiftSpend > 0,
    agencyTier,
    liveNowCount,
    inactiveCount,
  };
}

function pickPhoto(data: Record<string, unknown>): string | null {
  for (const key of ["photoURL", "avatar", "userPhotoURL", "photo", "profilePhoto"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Fill missing member photos from users/{uid} — never invent faces. */
async function hydrateMemberPhotos(
  members: TeamMember[],
): Promise<TeamMember[]> {
  if (!members.length) return members;
  const db = getDb();
  return Promise.all(
    members.map(async (m) => {
      if (m.photoURL) return m;
      try {
        const snap = await getDoc(doc(db, "users", m.uid));
        if (!snap.exists()) return m;
        const photo = pickPhoto(snap.data() as Record<string, unknown>);
        return photo ? { ...m, photoURL: photo } : m;
      } catch {
        return m;
      }
    }),
  );
}

function referralFromDoc(
  id: string,
  row: Record<string, unknown>,
): TeamReferral {
  const roleRaw = String(row.roleHint || row.role || "host").toLowerCase();
  const roleHint =
    roleRaw === "co-leader" || roleRaw === "coleader"
      ? "co-leader"
      : roleRaw === "member"
        ? "member"
        : "host";
  return {
    id,
    email: String(row.email || "").toLowerCase(),
    name: String(row.name || row.displayName || "").trim(),
    note: String(row.note || "").trim(),
    roleHint,
    status: String(row.status || "pending"),
    inviteUrl: String(row.inviteUrl || ""),
    emailSent: !!row.emailSent,
    createdAtMs: toMs(row.createdAt),
  };
}

async function loadTeamReferralsFs(teamId: string): Promise<TeamReferral[]> {
  try {
    const snap = await getDocs(
      query(
        collection(getDb(), "teamReferrals"),
        where("teamId", "==", teamId),
        limit(40),
      ),
    );
    return snap.docs
      .map((d) => referralFromDoc(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  } catch {
    return [];
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export type CreateTeamReferralInput = {
  teamId: string;
  teamName: string;
  leaderUid: string;
  leaderName: string;
  email: string;
  name?: string;
  note?: string;
  roleHint?: "host" | "co-leader" | "member";
  idToken?: string;
};

export type CreateTeamReferralResult = {
  referral: TeamReferral;
  emailSent: boolean;
  inviteUrl: string;
};

/** Persist a host / co-leader email referral for admin + desk. */
export async function createTeamReferralWeb(
  input: CreateTeamReferralInput,
): Promise<CreateTeamReferralResult> {
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error("Enter a valid email address.");
  }
  const name = String(input.name || "").trim().slice(0, 80);
  const note = String(input.note || "").trim().slice(0, 400);
  const roleHint = input.roleHint || "host";
  const inviteUrl = teamInviteUrl({
    teamId: input.teamId,
    name: input.teamName,
    leaderName: input.leaderName,
  });

  const payload = {
    teamId: input.teamId,
    teamName: input.teamName.slice(0, 80),
    referrerUid: input.leaderUid,
    referrerName: input.leaderName.slice(0, 80),
    email,
    name: name || null,
    note: note || null,
    roleHint,
    status: "pending",
    inviteUrl,
    emailSent: false,
    source: "blyp-world",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const ref = await addDoc(collection(getDb(), "teamReferrals"), payload);
    const referral: TeamReferral = {
      id: ref.id,
      email,
      name,
      note,
      roleHint,
      status: "pending",
      inviteUrl,
      emailSent: false,
      createdAtMs: Date.now(),
    };
    return { referral, emailSent: false, inviteUrl };
  } catch (err) {
    if (!input.idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(input.teamId)}/referrals`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          name,
          note,
          roleHint,
          teamName: input.teamName,
          leaderName: input.leaderName,
        }),
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Referral failed (${res.status})`);
    }
    const json = (await res.json()) as {
      referral?: TeamReferral;
      emailSent?: boolean;
      inviteUrl?: string;
    };
    if (!json.referral) {
      throw new Error("Referral saved but response was incomplete.");
    }
    return {
      referral: json.referral,
      emailSent: !!json.emailSent,
      inviteUrl: json.inviteUrl || inviteUrl,
    };
  }
}

async function attachLiveStatus(members: TeamMember[]): Promise<TeamMember[]> {
  if (!members.length) return members;
  try {
    const lives = await fetchLiveDirectory();
    const byHost = new Map<string, LiveCard>();
    for (const card of lives) {
      if (card.hostUid) byHost.set(card.hostUid, card);
    }
    return members.map((m) => {
      const live = byHost.get(m.uid);
      if (!live) return { ...m, isLive: false, liveStreamId: null };
      return {
        ...m,
        isLive: true,
        liveStreamId: live.streamId || live.id,
        liveTitle: live.title,
        liveViewers: live.viewerCount,
      };
    });
  } catch {
    return members.map((m) => ({ ...m, isLive: false, liveStreamId: null }));
  }
}

async function loadTeamBattlesFs(teamId: string): Promise<TeamBattle[]> {
  try {
    const snap = await getDocs(
      query(
        collection(getDb(), "teamBattles"),
        where("teamId", "==", teamId),
        limit(40),
      ),
    );
    return snap.docs
      .map((d) => battleRow(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  } catch {
    return [];
  }
}

async function loadAgencyLinksFs(teamId: string): Promise<TeamAgencyLink[]> {
  try {
    const snap = await getDocs(
      query(
        collection(getDb(), "teamAgencyLinks"),
        where("teamIds", "array-contains", teamId),
        limit(40),
      ),
    );
    return snap.docs
      .map((d) => linkRow(d.id, d.data() as Record<string, unknown>, teamId))
      .filter((x): x is TeamAgencyLink => !!x)
      .sort((a, b) => (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0));
  } catch {
    return [];
  }
}

async function loadLinkedOpponentsFs(
  myTeamId: string,
  myMembers: TeamMember[],
  links: TeamAgencyLink[],
  params: TeamBattleParams,
): Promise<LinkedOpponent[]> {
  const out: LinkedOpponent[] = [];
  if (params.allowInternal) {
    for (const m of myMembers) {
      if (m.role === "leader") continue;
      out.push({
        uid: m.uid,
        displayName: m.displayName,
        username: m.username,
        photoURL: m.photoURL,
        isLive: m.isLive,
        teamId: myTeamId,
        teamName: "Your roster",
        linkVisibility: "private",
        source: "roster",
      });
    }
  }
  if (!params.allowLinked) return out;
  const active = links.filter((l) => l.status === "active");
  const db = getDb();
  for (const link of active) {
    try {
      const membersSnap = await getDocs(
        collection(db, "teams", link.peerTeamId, "members"),
      );
      let peers = membersSnap.docs.map((d) =>
        person(d.data() as Record<string, unknown>, d.id),
      );
      peers = await hydrateMemberPhotos(peers);
      peers = await attachLiveStatus(peers);
      for (const m of peers) {
        if (m.role === "leader") continue;
        out.push({
          uid: m.uid,
          displayName: m.displayName,
          username: m.username,
          photoURL: m.photoURL,
          isLive: m.isLive,
          teamId: link.peerTeamId,
          teamName: link.peerTeamName,
          linkVisibility: link.visibility,
          source: "linked",
        });
      }
    } catch {
      // peer roster may be rules-gated; skip silently
    }
  }
  return out;
}

export type TeamApplicationInput = {
  uid: string;
  displayName: string;
  username: string;
  photoURL?: string | null;
  pitch: string;
  teamName?: string;
  contactEmail?: string;
  rosterSize?: string;
};

/**
 * Apply to run a team — same Firestore doc the mobile app + admin review use
 * (`teamApplications/{uid}`). Requires Cognito→Firebase bridge first.
 */
export async function applyToRunTeamWeb(
  input: TeamApplicationInput,
): Promise<void> {
  const uid = String(input.uid || "").trim();
  if (!uid) throw new Error("Please sign in to apply to run a team.");
  const pitch = String(input.pitch || "").trim().slice(0, 1000);
  if (!pitch) throw new Error("Add a short pitch about your team.");

  const db = getDb();
  const userSnap = await getDoc(doc(db, "users", uid));
  const userData = userSnap.exists()
    ? (userSnap.data() as Record<string, unknown>)
    : {};
  const verified =
    userData.verified === true ||
    userData.isVerified === true ||
    String(userData.verificationStatus || "").toLowerCase() === "verified";
  if (!verified) {
    const err = new Error(
      "Verify your Blyp profile before applying to run a team. Open the app → Edit Profile to submit verification.",
    );
    (err as Error & { code?: string }).code = "VERIFICATION_REQUIRED";
    throw err;
  }

  const teamName = String(input.teamName || "").trim().slice(0, 80);
  const contactEmail = String(input.contactEmail || "").trim().slice(0, 120);
  const rosterSize = String(input.rosterSize || "").trim().slice(0, 40);
  const composedPitch = [
    teamName ? `Team: ${teamName}` : "",
    rosterSize ? `Roster size: ${rosterSize}` : "",
    contactEmail ? `Contact: ${contactEmail}` : "",
    pitch,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);

  await setDoc(
    doc(db, "teamApplications", uid),
    {
      uid,
      displayName: String(input.displayName || "Creator").slice(0, 80),
      username: String(input.username || uid.slice(0, 8)).slice(0, 64),
      photoURL: input.photoURL || null,
      pitch: composedPitch,
      teamName: teamName || null,
      contactEmail: contactEmail || null,
      rosterSize: rosterSize || null,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      requiresVerified: true,
      source: "blyp-world",
    },
    { merge: true },
  );
}

export async function loadTeamApplicationStatus(
  uid: string,
): Promise<TeamApplicationStatus | null> {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(getDb(), "teamApplications", uid));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    return {
      status: String(d.status || "pending"),
      pitch: d.pitch ? String(d.pitch) : "",
      teamName: d.teamName ? String(d.teamName) : null,
      createdAtMs: toMs(d.createdAt),
      updatedAtMs: toMs(d.updatedAt),
    };
  } catch {
    return null;
  }
}

function parseApiTeam(raw: Record<string, unknown> | null): TeamBundle | null {
  if (!raw) return null;
  const members = Array.isArray(raw.members)
    ? (raw.members as Record<string, unknown>[]).map((m) =>
        person(m, String(m.uid || "")),
      )
    : [];
  const joinRequests = Array.isArray(raw.joinRequests)
    ? (raw.joinRequests as Record<string, unknown>[]).map((r) => ({
        uid: String(r.uid || ""),
        displayName: String(r.displayName || "Applicant"),
        username: String(r.username || ""),
        message: r.message ? String(r.message) : "",
        status: String(r.status || "pending"),
        photoURL: (r.photoURL || null) as string | null,
      }))
    : [];
  const teamBattles = Array.isArray(raw.teamBattles)
    ? (raw.teamBattles as Record<string, unknown>[]).map((b, i) =>
        battleRow(String(b.id || `b${i}`), b),
      )
    : [];
  const referrals = Array.isArray(raw.referrals)
    ? (raw.referrals as Record<string, unknown>[]).map((r, i) =>
        referralFromDoc(String(r.id || `r${i}`), r),
      )
    : [];
  const agencyLinks = Array.isArray(raw.agencyLinks)
    ? (raw.agencyLinks as Record<string, unknown>[])
        .map((l, i) =>
          linkRow(
            String(l.id || `l${i}`),
            l,
            String(raw.teamId || ""),
          ),
        )
        .filter((x): x is TeamAgencyLink => !!x)
    : [];
  const battleParams = parseBattleParams(raw.battleParams);
  const linkedOpponents = Array.isArray(raw.linkedOpponents)
    ? (raw.linkedOpponents as Record<string, unknown>[]).map((o) => ({
        uid: String(o.uid || ""),
        displayName: String(o.displayName || "Host"),
        username: String(o.username || ""),
        photoURL: (o.photoURL || null) as string | null,
        isLive: !!o.isLive,
        teamId: String(o.teamId || ""),
        teamName: String(o.teamName || "Agency"),
        linkVisibility:
          String(o.linkVisibility || "private").toLowerCase() === "public"
            ? ("public" as const)
            : ("private" as const),
        source:
          String(o.source || "linked").toLowerCase() === "roster"
            ? ("roster" as const)
            : ("linked" as const),
      }))
    : [];

  return enrichEconomy({
    teamId: String(raw.teamId || ""),
    name: String(raw.name || "Team"),
    leaderId: String(raw.leaderId || ""),
    leaderName: String(raw.leaderName || "Leader"),
    memberCount: asNum(raw.memberCount) || members.length,
    teamTotalGems: asNum(raw.teamTotalGems),
    leaderBonusGems: asNum(raw.leaderBonusGems),
    wins: asNum(raw.wins),
    battles: asNum(raw.battles),
    crestUrl: (raw.crestUrl || null) as string | null,
    isLeader: !!raw.isLeader,
    members,
    joinRequests,
    teamBattles,
    referrals,
    agencyLinks,
    battleParams,
    linkedOpponents,
    weeklyHours:
      raw.weeklyHours == null ? null : asNum(raw.weeklyHours) || null,
  });
}

/** Admin-SDK fallback via live-service (Cognito Bearer) — same Firestore data. */
export async function loadMyTeamViaApi(
  idToken: string,
): Promise<TeamBundle | null> {
  const res = await fetch(`${liveServiceUrl}/teams/me`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || `Teams API failed (${res.status})`);
  }
  const json = (await res.json()) as { team?: Record<string, unknown> | null };
  const parsed = parseApiTeam(json.team || null);
  if (!parsed) return null;
  let members = await hydrateMemberPhotos(parsed.members);
  members = await attachLiveStatus(members);
  const referrals =
    parsed.isLeader && (!parsed.referrals || parsed.referrals.length === 0)
      ? await loadTeamReferralsFs(parsed.teamId).catch(() => [])
      : parsed.referrals || [];
  return enrichEconomy({ ...parsed, members, referrals });
}

/** Load the signed-in user's team (leader or member) with roster + pending joins. */
export async function loadMyTeam(uid: string): Promise<TeamBundle | null> {
  if (!uid) return null;
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, "teams"), where("memberIds", "array-contains", uid)),
  );
  if (snap.empty) return null;

  const teamDoc =
    snap.docs.find((d) => String(d.data()?.status || "active") !== "closed") ||
    snap.docs[0];
  if (!teamDoc) return null;

  const data = teamDoc.data() || {};
  const leaderId = String(data.leaderId || "");
  const isLeader = leaderId === uid;

  const membersSnap = await getDocs(
    collection(db, "teams", teamDoc.id, "members"),
  );
  let members = membersSnap.docs.map((d) =>
    person(d.data() as Record<string, unknown>, d.id),
  );
  members = await hydrateMemberPhotos(members);
  members = await attachLiveStatus(members);

  let joinRequests: TeamJoinRequest[] = [];
  if (isLeader) {
    try {
      const reqSnap = await getDocs(
        query(
          collection(db, "teams", teamDoc.id, "joinRequests"),
          where("status", "==", "pending"),
          orderBy("createdAt", "desc"),
        ),
      );
      joinRequests = reqSnap.docs.map((d) => {
        const r = d.data() as Record<string, unknown>;
        return {
          uid: d.id,
          displayName: String(r.displayName || "Applicant"),
          username: String(r.username || d.id.slice(0, 8)),
          message: r.message ? String(r.message) : "",
          status: String(r.status || "pending"),
          photoURL: (r.photoURL || null) as string | null,
        };
      });
    } catch {
      const reqSnap = await getDocs(
        collection(db, "teams", teamDoc.id, "joinRequests"),
      );
      joinRequests = reqSnap.docs
        .map((d) => {
          const r = d.data() as Record<string, unknown>;
          return {
            uid: d.id,
            displayName: String(r.displayName || "Applicant"),
            username: String(r.username || d.id.slice(0, 8)),
            message: r.message ? String(r.message) : "",
            status: String(r.status || "pending"),
            photoURL: (r.photoURL || null) as string | null,
          };
        })
        .filter((r) => r.status === "pending");
    }
  }

  const teamBattles = await loadTeamBattlesFs(teamDoc.id);
  const referrals = isLeader ? await loadTeamReferralsFs(teamDoc.id) : [];
  const agencyLinks = await loadAgencyLinksFs(teamDoc.id);
  const battleParams = parseBattleParams(data.battleParams);
  const linkedOpponents = await loadLinkedOpponentsFs(
    teamDoc.id,
    members,
    agencyLinks,
    battleParams,
  );
  const weeklyRaw = data.weeklyActivity ?? data.weekLiveHours ?? data.weeklyHours;

  return enrichEconomy({
    teamId: teamDoc.id,
    name: String(data.name || `${data.leaderName || "Team"}'s team`),
    leaderId,
    leaderName: String(data.leaderName || data.leaderDisplayName || "Leader"),
    memberCount: members.length || asNum(data.memberCount),
    teamTotalGems: asNum(data.teamTotalGems),
    leaderBonusGems: asNum(data.leaderBonusGems),
    wins: asNum(data.wins ?? data.battleWins),
    battles: asNum(data.battles ?? data.battleCount) || teamBattles.length,
    crestUrl: (data.crestUrl || data.avatarUrl || data.photoURL || null) as
      | string
      | null,
    isLeader,
    members: members.sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0)),
    joinRequests,
    teamBattles,
    referrals,
    agencyLinks,
    battleParams,
    linkedOpponents,
    weeklyHours:
      weeklyRaw == null ? null : asNum(weeklyRaw) > 0 ? asNum(weeklyRaw) : null,
  });
}

export async function acceptJoinRequestWeb(
  teamId: string,
  request: TeamJoinRequest,
  leaderUid: string,
  idToken?: string,
) {
  try {
    const db = getDb();
    const teamRef = doc(db, "teams", teamId);
    const teamSnap = await getDoc(teamRef);
    if (!teamSnap.exists()) throw new Error("Team not found");
    const team = teamSnap.data() || {};
    if (String(team.leaderId) !== leaderUid) {
      throw new Error("Only the team leader can accept requests");
    }

    const batch = writeBatch(db);
    batch.set(
      doc(db, "teams", teamId, "members", request.uid),
      {
        uid: request.uid,
        displayName: request.displayName,
        username: request.username,
        photoURL: request.photoURL || null,
        role: "member",
        joinedAt: serverTimestamp(),
        status: "active",
        hoursLive: 0,
      },
      { merge: true },
    );
    batch.update(doc(db, "teams", teamId, "joinRequests", request.uid), {
      status: "accepted",
      resolvedAt: serverTimestamp(),
      resolvedBy: leaderUid,
    });
    batch.update(teamRef, {
      memberIds: arrayUnion(request.uid),
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    if (!idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(teamId)}/join-requests/${encodeURIComponent(request.uid)}/accept`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Accept failed (${res.status})`);
    }
  }
}

export async function rejectJoinRequestWeb(
  teamId: string,
  requestUid: string,
  leaderUid: string,
  idToken?: string,
) {
  try {
    const db = getDb();
    const teamSnap = await getDoc(doc(db, "teams", teamId));
    if (!teamSnap.exists()) throw new Error("Team not found");
    if (String(teamSnap.data()?.leaderId) !== leaderUid) {
      throw new Error("Only the team leader can reject requests");
    }
    await updateDoc(doc(db, "teams", teamId, "joinRequests", requestUid), {
      status: "rejected",
      resolvedAt: serverTimestamp(),
      resolvedBy: leaderUid,
    });
  } catch (err) {
    if (!idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(teamId)}/join-requests/${encodeURIComponent(requestUid)}/reject`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Reject failed (${res.status})`);
    }
  }
}

export async function removeTeamMemberWeb(
  teamId: string,
  memberUid: string,
  leaderUid: string,
  idToken?: string,
) {
  try {
    const db = getDb();
    const teamRef = doc(db, "teams", teamId);
    const teamSnap = await getDoc(teamRef);
    if (!teamSnap.exists()) throw new Error("Team not found");
    const team = teamSnap.data() || {};
    if (String(team.leaderId) !== leaderUid) {
      throw new Error("Only the team leader can remove members");
    }
    if (String(memberUid) === String(leaderUid)) {
      throw new Error("The team owner cannot be removed.");
    }
    const memberRef = doc(db, "teams", teamId, "members", memberUid);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) return;

    const batch = writeBatch(db);
    batch.delete(memberRef);
    batch.update(teamRef, {
      memberIds: arrayRemove(memberUid),
      memberCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    if (!idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberUid)}/remove`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Remove failed (${res.status})`);
    }
  }
}

export async function createTeamBattleWeb(
  teamId: string,
  actorUid: string,
  memberA: TeamMember | LinkedOpponent,
  memberB: TeamMember | LinkedOpponent,
  note: string,
  idToken?: string,
  opts?: {
    asLeader?: boolean;
    source?: "internal" | "linked";
    opponentTeamId?: string | null;
    opponentTeamName?: string | null;
    status?: string;
  },
): Promise<void> {
  if (!memberA?.uid || !memberB?.uid) throw new Error("Pick two members");
  if (memberA.uid === memberB.uid) throw new Error("Pick two different members");

  const source = opts?.source || "internal";
  const status = opts?.status || (opts?.asLeader === false ? "pending" : "scheduled");
  const payload = {
    teamId,
    creatorId: actorUid,
    aUid: memberA.uid,
    aName: memberA.displayName || "Member A",
    bUid: memberB.uid,
    bName: memberB.displayName || "Member B",
    note: String(note || "").slice(0, 280),
    status,
    source,
    opponentTeamId: opts?.opponentTeamId || null,
    opponentTeamName: opts?.opponentTeamName || null,
    createdAt: serverTimestamp(),
    scheduledAt: null,
  };

  try {
    const db = getDb();
    const teamSnap = await getDoc(doc(db, "teams", teamId));
    if (!teamSnap.exists()) throw new Error("Team not found");
    const team = teamSnap.data() || {};
    const isLeader = String(team.leaderId) === actorUid;
    if (opts?.asLeader !== false && !isLeader && opts?.asLeader !== undefined) {
      // explicit leader-only path
    }
    if (opts?.asLeader === true && !isLeader) {
      throw new Error("Only the team leader can arrange battles");
    }
    if (!isLeader) {
      const params = parseBattleParams(team.battleParams);
      if (params.challengers === "leader_only") {
        throw new Error("Boss locked challenges to leaders only");
      }
      if (source === "internal" && !params.allowInternal) {
        throw new Error("Internal challenges are off");
      }
      if (source === "linked" && !params.allowLinked) {
        throw new Error("Linked-agency challenges are off");
      }
    }
    await addDoc(collection(db, "teamBattles"), payload);
  } catch (err) {
    if (!idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(teamId)}/battles`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          aUid: memberA.uid,
          aName: memberA.displayName,
          bUid: memberB.uid,
          bName: memberB.displayName,
          note: String(note || "").slice(0, 280),
          source,
          status,
          opponentTeamId: opts?.opponentTeamId || null,
          opponentTeamName: opts?.opponentTeamName || null,
          asChallenge: !opts?.asLeader,
        }),
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Battle create failed (${res.status})`);
    }
  }
}

export async function saveBattleParamsWeb(
  teamId: string,
  leaderUid: string,
  params: TeamBattleParams,
  idToken?: string,
): Promise<void> {
  const cleaned = parseBattleParams(params);
  try {
    const db = getDb();
    const teamRef = doc(db, "teams", teamId);
    const snap = await getDoc(teamRef);
    if (!snap.exists()) throw new Error("Team not found");
    if (String(snap.data()?.leaderId) !== leaderUid) {
      throw new Error("Only the team leader can set battle parameters");
    }
    await updateDoc(teamRef, {
      battleParams: cleaned,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (!idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(teamId)}/battle-params`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cleaned),
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Params save failed (${res.status})`);
    }
  }
}

export type ProposeAgencyLinkInput = {
  teamId: string;
  teamName: string;
  leaderUid: string;
  peerTeamId: string;
  visibility: AgencyLinkVisibility;
  idToken?: string;
};

/** Resolve a peer agency by team id (from invite URL) for the link form. */
export async function lookupTeamForLink(
  peerTeamId: string,
): Promise<{ teamId: string; name: string; leaderName: string } | null> {
  const id = String(peerTeamId || "").trim();
  if (!id) return null;
  try {
    const snap = await getDoc(doc(getDb(), "teams", id));
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    if (String(d.status || "active") === "closed") return null;
    return {
      teamId: snap.id,
      name: String(d.name || `${d.leaderName || "Team"}'s team`),
      leaderName: String(d.leaderName || d.leaderDisplayName || "Leader"),
    };
  } catch {
    return null;
  }
}

export async function proposeAgencyLinkWeb(
  input: ProposeAgencyLinkInput,
): Promise<TeamAgencyLink> {
  const peerTeamId = String(input.peerTeamId || "").trim();
  if (!peerTeamId) throw new Error("Enter the other agency’s team id");
  if (peerTeamId === input.teamId) {
    throw new Error("You can’t link your agency to itself");
  }

  const tryFs = async (): Promise<TeamAgencyLink> => {
    const db = getDb();
    const mySnap = await getDoc(doc(db, "teams", input.teamId));
    if (!mySnap.exists()) throw new Error("Team not found");
    if (String(mySnap.data()?.leaderId) !== input.leaderUid) {
      throw new Error("Only the boss can propose agency links");
    }
    const peerSnap = await getDoc(doc(db, "teams", peerTeamId));
    if (!peerSnap.exists()) throw new Error("Peer agency not found");
    const peer = peerSnap.data() || {};
    const peerName = String(
      peer.name || `${peer.leaderName || "Team"}'s team`,
    );
    const sorted = [input.teamId, peerTeamId].sort();
    const pairKey = `${sorted[0]}_${sorted[1]}`;
    const existing = await getDocs(
      query(
        collection(db, "teamAgencyLinks"),
        where("pairKey", "==", pairKey),
        limit(5),
      ),
    );
    const blocking = existing.docs.find((d) => {
      const st = String(d.data()?.status || "");
      return st === "pending" || st === "active";
    });
    if (blocking) {
      throw new Error("A link already exists (pending or active) with that agency");
    }
    const payload = {
      teamIds: sorted,
      pairKey,
      teamNames: {
        [input.teamId]: input.teamName.slice(0, 80),
        [peerTeamId]: peerName.slice(0, 80),
      },
      visibility: input.visibility === "public" ? "public" : "private",
      status: "pending",
      requestedByTeamId: input.teamId,
      requestedByUid: input.leaderUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: "blyp-world",
    };
    const ref = await addDoc(collection(db, "teamAgencyLinks"), payload);
    return {
      id: ref.id,
      teamIds: sorted as [string, string],
      peerTeamId,
      peerTeamName: peerName,
      visibility: input.visibility === "public" ? "public" : "private",
      status: "pending",
      requestedByTeamId: input.teamId,
      requestedByUid: input.leaderUid,
      isIncoming: false,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
  };

  try {
    return await tryFs();
  } catch (err) {
    if (!input.idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(input.teamId)}/links`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          peerTeamId,
          visibility: input.visibility,
          teamName: input.teamName,
        }),
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Link propose failed (${res.status})`);
    }
    const json = (await res.json()) as { link?: TeamAgencyLink };
    if (!json.link) throw new Error("Link saved but response incomplete");
    return json.link;
  }
}

export async function respondAgencyLinkWeb(
  teamId: string,
  linkId: string,
  leaderUid: string,
  action: "accept" | "reject" | "revoke",
  idToken?: string,
): Promise<void> {
  const status =
    action === "accept" ? "active" : action === "reject" ? "rejected" : "revoked";
  try {
    const db = getDb();
    const teamSnap = await getDoc(doc(db, "teams", teamId));
    if (!teamSnap.exists()) throw new Error("Team not found");
    if (String(teamSnap.data()?.leaderId) !== leaderUid) {
      throw new Error("Only the boss can manage agency links");
    }
    const linkRef = doc(db, "teamAgencyLinks", linkId);
    const linkSnap = await getDoc(linkRef);
    if (!linkSnap.exists()) throw new Error("Link not found");
    const link = linkSnap.data() || {};
    const ids = Array.isArray(link.teamIds)
      ? (link.teamIds as unknown[]).map(String)
      : [];
    if (!ids.includes(teamId)) throw new Error("Link does not include your agency");
    if (action === "accept") {
      if (String(link.requestedByTeamId) === teamId) {
        throw new Error("Waiting on the other boss to accept");
      }
      if (String(link.status) !== "pending") {
        throw new Error("Link is not pending");
      }
    }
    await updateDoc(linkRef, {
      status,
      updatedAt: serverTimestamp(),
      resolvedByUid: leaderUid,
      resolvedByTeamId: teamId,
    });
  } catch (err) {
    if (!idToken) throw err;
    const res = await fetch(
      `${liveServiceUrl}/teams/${encodeURIComponent(teamId)}/links/${encodeURIComponent(linkId)}/${action}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || `Link ${action} failed (${res.status})`);
    }
  }
}

/** Demo bundle for marketing preview panels — same labels/layout as live desk. */
export function buildDemoTeamBundle(opts?: {
  asMember?: boolean;
}): TeamBundle {
  const members: TeamMember[] = [
    {
      uid: "demo-leader",
      displayName: "Alex Rivera",
      username: "alexr",
      role: "leader",
      totalEarned: 18400,
      hoursLive: 12,
      isLive: false,
    },
    {
      uid: "demo-1",
      displayName: "Maya Chen",
      username: "mayalive",
      role: "member",
      totalEarned: 9200,
      hoursLive: 8,
      isLive: true,
      liveStreamId: "demo-stream",
      liveTitle: "Night chat + gifts",
      liveViewers: 142,
    },
    {
      uid: "demo-2",
      displayName: "Jordan Blake",
      username: "jblake",
      role: "member",
      totalEarned: 6100,
      hoursLive: 5,
      isLive: true,
      liveStreamId: "demo-stream-2",
      liveTitle: "Battle warm-up",
      liveViewers: 89,
    },
    {
      uid: "demo-3",
      displayName: "Sam Okoye",
      username: "samok",
      role: "member",
      totalEarned: 2400,
      hoursLive: 0,
      isLive: false,
    },
    {
      uid: "demo-4",
      displayName: "Riley Park",
      username: "rpark",
      role: "member",
      totalEarned: 1100,
      hoursLive: 1,
      isLive: false,
    },
  ];
  const battleParams: TeamBattleParams = {
    ...DEFAULT_BATTLE_PARAMS,
    durationMinutes: 5,
    giftWindowMinutes: 4,
    cooldownMinutes: 20,
  };
  const agencyLinks: TeamAgencyLink[] = [
    {
      id: "link-public",
      teamIds: ["demo-north-star", "demo-orbit"],
      peerTeamId: "demo-orbit",
      peerTeamName: "Orbit House",
      visibility: "public",
      status: "active",
      requestedByTeamId: "demo-north-star",
      requestedByUid: "demo-leader",
      isIncoming: false,
      createdAtMs: Date.now() - 86400000,
    },
    {
      id: "link-private",
      teamIds: ["demo-north-star", "demo-quiet"],
      peerTeamId: "demo-quiet",
      peerTeamName: "Quiet Rival",
      visibility: "private",
      status: "active",
      requestedByTeamId: "demo-quiet",
      requestedByUid: "demo-peer-boss",
      isIncoming: false,
      createdAtMs: Date.now() - 172800000,
    },
    {
      id: "link-pending",
      teamIds: ["demo-north-star", "demo-incoming"],
      peerTeamId: "demo-incoming",
      peerTeamName: "Harbor LIVE",
      visibility: "private",
      status: "pending",
      requestedByTeamId: "demo-incoming",
      requestedByUid: "demo-harbor-boss",
      isIncoming: true,
      createdAtMs: Date.now() - 3600000,
    },
  ];
  const linkedOpponents: LinkedOpponent[] = [
    ...members
      .filter((m) => m.role !== "leader")
      .map((m) => ({
        uid: m.uid,
        displayName: m.displayName,
        username: m.username,
        photoURL: m.photoURL,
        isLive: m.isLive,
        teamId: "demo-north-star",
        teamName: "Your roster",
        linkVisibility: "private" as const,
        source: "roster" as const,
      })),
    {
      uid: "orbit-1",
      displayName: "Nova Kim",
      username: "novak",
      isLive: true,
      teamId: "demo-orbit",
      teamName: "Orbit House",
      linkVisibility: "public",
      source: "linked",
    },
    {
      uid: "orbit-2",
      displayName: "Theo Vance",
      username: "theov",
      isLive: false,
      teamId: "demo-orbit",
      teamName: "Orbit House",
      linkVisibility: "public",
      source: "linked",
    },
    {
      uid: "quiet-1",
      displayName: "Iris Cole",
      username: "irisc",
      isLive: false,
      teamId: "demo-quiet",
      teamName: "Quiet Rival",
      linkVisibility: "private",
      source: "linked",
    },
  ];
  return enrichEconomy({
    teamId: "demo-north-star",
    name: "North Star LIVE",
    leaderId: "demo-leader",
    leaderName: "Alex Rivera",
    memberCount: members.length,
    teamTotalGems: 37200,
    leaderBonusGems: 7440,
    wins: 14,
    battles: 22,
    crestUrl: null,
    isLeader: !opts?.asMember,
    members,
    joinRequests: [
      {
        uid: "demo-req",
        displayName: "Casey Nguyen",
        username: "caseyng",
        message: "Hosted TikTok LIVE 6mo — looking for a fair desk.",
        status: "pending",
        photoURL: null,
      },
    ],
    teamBattles: [
      {
        id: "b1",
        aUid: "demo-1",
        aName: "Maya Chen",
        bUid: "demo-2",
        bName: "Jordan Blake",
        status: "scheduled",
        note: "Friday 9pm UK",
        createdAtMs: Date.now(),
        source: "internal",
      },
      {
        id: "b2",
        aUid: "demo-1",
        aName: "Maya Chen",
        bUid: "orbit-1",
        bName: "Nova Kim",
        status: "pending",
        note: "Linked challenge · Orbit House",
        createdAtMs: Date.now() - 7200000,
        opponentTeamId: "demo-orbit",
        opponentTeamName: "Orbit House",
        source: "linked",
      },
      {
        id: "b3",
        aUid: "demo-2",
        aName: "Jordan Blake",
        bUid: "quiet-1",
        bName: "Iris Cole",
        status: "live",
        note: "Private link match",
        createdAtMs: Date.now() - 600000,
        opponentTeamId: "demo-quiet",
        opponentTeamName: "Quiet Rival",
        source: "linked",
      },
      {
        id: "b4",
        aUid: "demo-3",
        aName: "Sam Okoye",
        bUid: "demo-4",
        bName: "Riley Park",
        status: "completed",
        note: "Warm-up W",
        createdAtMs: Date.now() - 86400000,
        source: "internal",
        winnerUid: "demo-3",
      },
    ],
    referrals: [
      {
        id: "ref-1",
        email: "host@example.com",
        name: "Priya Shah",
        note: "Strong UK nights — TikTok agency exit.",
        roleHint: "host",
        status: "pending",
        inviteUrl: "https://blyp.world/teams/?join=demo-north-star",
        emailSent: false,
        createdAtMs: Date.now() - 86_400_000,
      },
    ],
    agencyLinks,
    battleParams,
    linkedOpponents,
    weeklyHours: 26,
  });
}
