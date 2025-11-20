// useIsAdmin: determines if current user has admin role from users/{uid} doc.
// Security: read-only; relies on server-managed role assignment.

import { useEffect, useState } from 'react';
import { db, auth, firebaseEnabled } from '../config/firebase';

export default function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = null;
    const user = auth.currentUser;
    if (!firebaseEnabled || !user) { setLoading(false); setIsAdmin(false); return; }
    try {
      unsub = db.collection('users').doc(user.uid).onSnapshot(snap => {
        const data = snap?.data?.() || snap?.data?.() || snap?.data?.() || snap?.data(); // compat guards
        const roles = data?.roles || [];
        setIsAdmin(roles.includes('admin') || data?.isAdmin === true);
        setLoading(false);
      });
    } catch (e) {
      setLoading(false); setIsAdmin(false);
    }
    return () => { if (unsub) unsub(); };
  }, [auth.currentUser]);

  return { isAdmin, loading };
}
