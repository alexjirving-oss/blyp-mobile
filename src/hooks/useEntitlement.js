// useEntitlement.js
//
// React hook exposing the current user's plan + capabilities.
// Returns null while the first load is in flight; callers should treat null as
// "still loading" and fail-open (assume access) for AI gating to avoid flashing
// a paywall at someone who actually has the feature.

import { useEffect, useState } from 'react';
import { useAuth } from './useCommon';
import { subscribeEntitlement, getEntitlementCached } from '../services/entitlementService';

export function useEntitlement() {
  const { uid } = useAuth();
  const [ent, setEnt] = useState(getEntitlementCached());

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeEntitlement(uid, setEnt);
    return unsub;
  }, [uid]);

  return ent;
}

/** Convenience: is the premium AI capability available right now? Fail-closed while loading. */
export function useHasAI() {
  const ent = useEntitlement();
  return ent ? !!ent.capabilities.ai : false;
}

export default useEntitlement;
