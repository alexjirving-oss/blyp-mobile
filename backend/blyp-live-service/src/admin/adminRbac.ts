/**
 * Console staff RBAC (second gate inside ADMIN_ALLOWLIST_SUBS).
 * Roles live in Postgres admin_staff (Admin-SDK-only writes via /admin/staff).
 * See _agent/admin-dashboard-20260806/ADMIN_STAFF_HIERARCHY_AND_DUTIES.md
 */

import type { NextFunction, Response } from 'express';
import type { Knex } from 'knex';
import type { AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { isCanonicalCognitoSub as isCanonicalSub } from '../auth/cognitoSub';
import { getEconomyInfra } from '../economy/infra';
import { ensureAdminSchema } from './adminSchema';
import { logger } from '../config/logger';

export const ADMIN_ROLES = [
  'owner',
  'executive',
  'admin',
  'trust_safety_lead',
  'moderator',
  'support',
  'analyst_readonly',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  'staff.manage',
  'kill.global.write',
  'kill.soft.write',
  'economy.credit',
  'economy.withdraw.approve',
  'economy.withdraw.reject',
  'users.ban',
  'users.ban.mass',
  'users.unban',
  'users.capabilities',
  'child_safety.force',
  'live.force_end',
  'comms.broadcast',
  'comms.broadcast.all',
  'config.flags.write',
  'config.version.write',
  'audit.export',
  'content.moderate',
  'reports.resolve',
  'reports.resolve.child_safety',
  'growth.rankings',
  'growth.feed_priority',
  'dsar.manage',
  'dsar.execute',
  'teams.approve',
  'appeals.resolve',
  'strikes.write',
  'users.message',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Named bootstrap — used when DB row missing so first boot is not locked out. */
export const BOOTSTRAP_STAFF_ROLES: Record<string, AdminRole> = {
  '26522274-e001-70aa-51b6-bcbbdffc43bb': 'owner', // Alex
  '267272c4-e041-70d2-f112-3d309424c968': 'admin', // Melzi
};

export const ROLE_DISPLAY: Record<AdminRole, string> = {
  owner: 'Owner',
  executive: 'Executive',
  admin: 'Administrator',
  trust_safety_lead: 'Trust & Safety Lead',
  moderator: 'Moderator',
  support: 'Support',
  analyst_readonly: 'Analyst (readonly)',
};

/** Soft credit cap for non-owner roles (per request). Owner unrestricted. */
export const ADMIN_CREDIT_SOFT_CAP = 25_000;

type PermSet = ReadonlySet<AdminPermission>;

function set(...perms: AdminPermission[]): PermSet {
  return new Set(perms);
}

const ALL_PERMS: PermSet = new Set(ADMIN_PERMISSIONS);

const ROLE_PERMISSIONS: Record<AdminRole, PermSet> = {
  owner: ALL_PERMS,
  executive: set(
    'kill.soft.write',
    'users.ban',
    'users.unban',
    'live.force_end',
    'comms.broadcast',
    'comms.broadcast.all',
    'config.flags.write',
    'audit.export',
    'content.moderate',
    'reports.resolve',
    'growth.rankings',
    'growth.feed_priority',
    'dsar.manage',
    'appeals.resolve',
    'users.message',
  ),
  // Mel (admin): ops + fraud + withdraw reject — never coin/gem credit (owner-only).
  admin: set(
    'kill.soft.write',
    'economy.withdraw.reject',
    'users.ban',
    'users.unban',
    'users.capabilities',
    'child_safety.force',
    'live.force_end',
    'comms.broadcast',
    'config.flags.write',
    'config.version.write',
    'audit.export',
    'content.moderate',
    'reports.resolve',
    'reports.resolve.child_safety',
    'growth.rankings',
    'growth.feed_priority',
    'dsar.manage',
    'teams.approve',
    'appeals.resolve',
    'strikes.write',
    'users.message',
  ),
  trust_safety_lead: set(
    'users.ban',
    'users.unban',
    'child_safety.force',
    'live.force_end',
    'comms.broadcast',
    'config.flags.write',
    'content.moderate',
    'reports.resolve',
    'reports.resolve.child_safety',
    'dsar.manage',
    'appeals.resolve',
    'strikes.write',
    'users.message',
  ),
  moderator: set(
    'users.ban',
    'live.force_end',
    'content.moderate',
    'reports.resolve',
    'strikes.write',
    'users.message',
  ),
  support: set('dsar.manage', 'users.message'),
  analyst_readonly: set(),
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function permissionsForRole(role: AdminRole): AdminPermission[] {
  return Array.from(ROLE_PERMISSIONS[role] || []);
}

export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) === true;
}

export type StaffRecord = {
  sub: string;
  role: AdminRole;
  displayName: string | null;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  source: 'db' | 'bootstrap';
};

async function getDb(): Promise<Knex | null> {
  try {
    const { db } = getEconomyInfra();
    await ensureAdminSchema(db);
    return db;
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err) }, '[admin-rbac] db unavailable');
    return null;
  }
}

function rowToStaff(row: any, source: 'db' | 'bootstrap'): StaffRecord {
  return {
    sub: String(row.sub || ''),
    role: row.role as AdminRole,
    displayName: row.display_name != null ? String(row.display_name) : null,
    notes: row.notes != null ? String(row.notes) : null,
    updatedBy: row.updated_by != null ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    source,
  };
}

/** Ensure Alex/Melzi rows exist (idempotent). */
export async function seedBootstrapStaff(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date().toISOString();
  for (const [sub, role] of Object.entries(BOOTSTRAP_STAFF_ROLES)) {
    await db.raw(
      `INSERT INTO admin_staff (sub, role, display_name, notes, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (sub) DO NOTHING`,
      [
        sub,
        role,
        sub === '26522274-e001-70aa-51b6-bcbbdffc43bb' ? 'Alex' : 'Melzi',
        'bootstrap seed',
        'system',
        now,
        now,
      ],
    );
  }
}

export async function resolveStaffRole(sub: string): Promise<StaffRecord | null> {
  const actor = String(sub || '').trim();
  if (!isCanonicalSub(actor)) return null;

  const db = await getDb();
  if (db) {
    try {
      await seedBootstrapStaff();
      const row = await db('admin_staff').where({ sub: actor }).first();
      if (row && isAdminRole(row.role)) {
        return rowToStaff(row, 'db');
      }
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err), actor }, '[admin-rbac] resolve failed');
    }
  }

  const bootstrap = BOOTSTRAP_STAFF_ROLES[actor];
  if (bootstrap) {
    return {
      sub: actor,
      role: bootstrap,
      displayName: actor === '26522274-e001-70aa-51b6-bcbbdffc43bb' ? 'Alex' : 'Melzi',
      notes: 'bootstrap fallback (db unavailable or unset)',
      updatedBy: 'system',
      updatedAt: null,
      createdAt: null,
      source: 'bootstrap',
    };
  }

  // Prefer deny: allowlisted without assigned role cannot use console.
  return null;
}

export async function listStaffRecords(): Promise<StaffRecord[]> {
  const db = await getDb();
  const out: StaffRecord[] = [];
  const seen = new Set<string>();

  if (db) {
    try {
      await seedBootstrapStaff();
      const rows = await db('admin_staff').orderBy('updated_at', 'desc');
      for (const row of rows) {
        if (!isAdminRole(row.role)) continue;
        const rec = rowToStaff(row, 'db');
        out.push(rec);
        seen.add(rec.sub);
      }
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err) }, '[admin-rbac] list failed');
    }
  }

  for (const [sub, role] of Object.entries(BOOTSTRAP_STAFF_ROLES)) {
    if (seen.has(sub)) continue;
    out.push({
      sub,
      role,
      displayName: sub === '26522274-e001-70aa-51b6-bcbbdffc43bb' ? 'Alex' : 'Melzi',
      notes: 'bootstrap',
      updatedBy: 'system',
      updatedAt: null,
      createdAt: null,
      source: 'bootstrap',
    });
  }

  return out;
}

export async function upsertStaffRole(input: {
  sub: string;
  role: AdminRole;
  displayName?: string | null;
  notes?: string | null;
  actorUserId: string;
}): Promise<StaffRecord> {
  const sub = String(input.sub || '').trim();
  if (!isCanonicalSub(sub)) throw new Error('INVALID_SUB');
  if (!isAdminRole(input.role)) throw new Error('INVALID_ROLE');

  const db = await getDb();
  if (!db) throw new Error('DB_UNAVAILABLE');

  const now = new Date().toISOString();
  await db.raw(
    `INSERT INTO admin_staff (sub, role, display_name, notes, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sub) DO UPDATE SET
       role = EXCLUDED.role,
       display_name = EXCLUDED.display_name,
       notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at`,
    [
      sub,
      input.role,
      input.displayName ?? null,
      input.notes ?? null,
      input.actorUserId,
      now,
      now,
    ],
  );

  const row = await db('admin_staff').where({ sub }).first();
  return rowToStaff(row, 'db');
}

export async function deleteStaffRole(sub: string): Promise<boolean> {
  const actor = String(sub || '').trim();
  if (!isCanonicalSub(actor)) return false;
  // Never remove bootstrap owner via API — must stay reachable.
  if (BOOTSTRAP_STAFF_ROLES[actor] === 'owner') {
    throw new Error('CANNOT_REMOVE_OWNER');
  }
  const db = await getDb();
  if (!db) throw new Error('DB_UNAVAILABLE');
  const n = await db('admin_staff').where({ sub: actor }).del();
  return n > 0;
}

export function attachStaffToRequest(req: AuthedRequest, staff: StaffRecord): void {
  req.user = {
    ...(req.user || { sub: staff.sub }),
    sub: staff.sub,
    adminRole: staff.role,
    adminPermissions: permissionsForRole(staff.role),
    adminStaff: staff,
  };
}

/**
 * Middleware factory: after requireAdmin (allowlist + role loaded).
 * Returns 403 FORBIDDEN_PERMISSION when the actor lacks the permission.
 */
export function requirePermission(...needed: AdminPermission[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = String(req.user?.adminRole || '') as AdminRole;
    if (!isAdminRole(role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        code: 'ADMIN_ROLE_REQUIRED',
        detail: 'Allowlisted but no console role assigned — Owner must grant a role on Access',
      });
    }
    for (const perm of needed) {
      if (!roleHasPermission(role, perm)) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          code: 'FORBIDDEN_PERMISSION',
          detail: `Missing permission: ${perm}`,
          required: needed,
          role,
        });
      }
    }
    return next();
  };
}

export function mePayload(staff: StaffRecord) {
  return {
    ok: true,
    actorUserId: staff.sub,
    authMode: 'cognito-allowlist+rbac',
    role: staff.role,
    roleDisplay: ROLE_DISPLAY[staff.role],
    permissions: permissionsForRole(staff.role),
    staffSource: staff.source,
    displayName: staff.displayName,
  };
}
