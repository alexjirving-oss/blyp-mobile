import React, { createContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { isGrid9Enabled } from '../../config/Grid9Flags';
import { getGrid9Connection, type Grid9Connection } from './connection';
import { getGrid9Session, subscribeGrid9Session } from './store';
import type { Grid9ClientSession } from './reconcile';

export interface Grid9ContextValue {
  session: Grid9ClientSession;
  connection: Grid9Connection;
  enabled: boolean;
}

export const Grid9Context = createContext<Grid9ContextValue | null>(null);

export function Grid9Provider({
  children,
  autoConnect = true,
  enabled = isGrid9Enabled(),
}: {
  children: ReactNode;
  autoConnect?: boolean;
  enabled?: boolean;
}) {
  const connection = getGrid9Connection();

  useEffect(() => {
    if (!autoConnect || !enabled) {
      return () => {
        connection.close();
      };
    }
    void connection.connect().catch((error: unknown) => {
      if (__DEV__) {
        console.warn('[grid9] connect failed', error);
      }
    });
    return () => {
      connection.close();
    };
  }, [autoConnect, connection, enabled]);

  const session = useSyncExternalStore(
    subscribeGrid9Session,
    getGrid9Session,
    getGrid9Session,
  );

  const value = useMemo<Grid9ContextValue>(
    () => ({ session, connection, enabled }),
    [session, connection, enabled],
  );

  return <Grid9Context.Provider value={value}>{children}</Grid9Context.Provider>;
}
