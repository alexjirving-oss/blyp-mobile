// Server-authoritative in-app admin entitlement.
// The live-service verifies the Cognito JWT, ADMIN_ALLOWLIST_SUBS and staff RBAC.

import { useCallback, useEffect, useState } from 'react';
import { getAdminAccess } from '../api/adminLiveApi';
import { useAuth } from './useCommon';

const SUCCESS_CACHE_MS = 60_000;
const DENIAL_CACHE_MS = 15_000;
const accessCache = new Map();
const pendingAccess = new Map();

const deniedAccess = (uid = null) => ({
  uid,
  isAdmin: false,
  role: null,
  permissions: [],
  staffSource: null,
});

export function normalizeAdminAccess(payload, expectedUid) {
  const uid = String(expectedUid || '').trim();
  const actorUserId = String(payload?.actorUserId || '').trim();
  const role = typeof payload?.role === 'string' ? payload.role.trim() : '';
  const permissions = Array.isArray(payload?.permissions)
    ? [...new Set(payload.permissions.filter((value) => typeof value === 'string' && value.trim()))]
    : [];
  const isAdmin = payload?.ok === true && !!uid && actorUserId === uid && !!role;

  if (!isAdmin) return deniedAccess(uid || null);
  return {
    uid,
    isAdmin: true,
    role,
    permissions,
    staffSource: payload?.staffSource || null,
  };
}

const readCachedAccess = (uid) => {
  const cached = accessCache.get(uid);
  if (!cached || cached.expiresAt <= Date.now()) {
    accessCache.delete(uid);
    return null;
  }
  return cached.value;
};

const loadAdminAccess = async (uid) => {
  const cached = readCachedAccess(uid);
  if (cached) return cached;
  if (pendingAccess.has(uid)) return pendingAccess.get(uid);

  const request = getAdminAccess()
    .then((payload) => {
      const value = normalizeAdminAccess(payload, uid);
      accessCache.set(uid, { value, expiresAt: Date.now() + SUCCESS_CACHE_MS });
      return value;
    })
    .catch((error) => {
      const status = Number(error?.status);
      if (status === 401 || status === 403) {
        const value = deniedAccess(uid);
        accessCache.set(uid, { value, expiresAt: Date.now() + DENIAL_CACHE_MS });
        return value;
      }
      throw error;
    })
    .finally(() => {
      pendingAccess.delete(uid);
    });

  pendingAccess.set(uid, request);
  return request;
};

export function clearAdminAccessCache() {
  accessCache.clear();
  pendingAccess.clear();
}

export default function useIsAdmin() {
  const { uid, authReady, isAuthenticated } = useAuth();
  const [access, setAccess] = useState(() => deniedAccess(uid || null));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const expectedUid = String(uid || '').trim();

    if (!authReady) {
      setAccess(deniedAccess(expectedUid || null));
      setLoading(true);
      return () => { cancelled = true; };
    }

    if (!isAuthenticated || !expectedUid) {
      setAccess(deniedAccess());
      setLoading(false);
      return () => { cancelled = true; };
    }

    const cached = readCachedAccess(expectedUid);
    if (cached) {
      setAccess(cached);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setAccess(deniedAccess(expectedUid));
    setLoading(true);
    loadAdminAccess(expectedUid)
      .then((next) => {
        if (cancelled) return;
        setAccess(next);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed. The mutating routes enforce the same server gate.
        setAccess(deniedAccess(expectedUid));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [uid, authReady, isAuthenticated]);

  const hasPermission = useCallback(
    (permission) => access.isAdmin && access.permissions.includes(permission),
    [access.isAdmin, access.permissions],
  );

  return {
    isAdmin: access.isAdmin,
    loading,
    role: access.role,
    permissions: access.permissions,
    staffSource: access.staffSource,
    hasPermission,
  };
}
