/** Console RBAC helpers — mirrors backend adminRbac.ts permission keys. */

export const ADMIN_ROLES = [
  "owner",
  "executive",
  "admin",
  "trust_safety_lead",
  "moderator",
  "support",
  "analyst_readonly",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminPermission =
  | "staff.manage"
  | "kill.global.write"
  | "kill.soft.write"
  | "economy.credit"
  | "economy.withdraw.approve"
  | "economy.withdraw.reject"
  | "users.ban"
  | "users.ban.mass"
  | "users.unban"
  | "users.capabilities"
  | "child_safety.force"
  | "live.force_end"
  | "comms.broadcast"
  | "comms.broadcast.all"
  | "config.flags.write"
  | "config.version.write"
  | "audit.export"
  | "content.moderate"
  | "reports.resolve"
  | "reports.resolve.child_safety"
  | "growth.rankings"
  | "growth.feed_priority"
  | "dsar.manage"
  | "dsar.execute"
  | "teams.approve"
  | "appeals.resolve"
  | "strikes.write"
  | "users.message"
  | "agents.oversight"
  | "marketing.manage";

export const ROLE_DISPLAY: Record<AdminRole, string> = {
  owner: "Owner",
  executive: "Executive",
  admin: "Administrator",
  trust_safety_lead: "Trust & Safety Lead",
  moderator: "Moderator",
  support: "Support",
  analyst_readonly: "Analyst (readonly)",
};

/** UI blurbs for AccountMenu — Mel/admin retains economy.credit via backend RBAC. */
export const ROLE_BLURB: Record<AdminRole, string> = {
  owner: "Unrestricted console access — catastrophic actions, role grants, and system config.",
  executive: "Executive oversight — broad ops without Owner-only nukes.",
  admin: "Administrator (Mel) — bans, disputes, agents, and coin credit (economy.credit).",
  trust_safety_lead: "Trust & Safety lead — reports, child-safety, and moderation lanes.",
  moderator: "Moderator — content and report resolution within scope.",
  support: "Support — people assistance, notes/messages. No coin credit.",
  analyst_readonly: "Read-only dashboards and People list. No mutations.",
};

export interface AdminMe {
  ok: boolean;
  actorUserId: string;
  authMode: string;
  role: AdminRole;
  roleDisplay: string;
  permissions: AdminPermission[];
  staffSource?: string;
  displayName?: string | null;
  email?: string | null;
}

export function can(perms: readonly string[] | undefined | null, permission: AdminPermission): boolean {
  if (!perms || !perms.length) return false;
  return perms.includes(permission);
}
