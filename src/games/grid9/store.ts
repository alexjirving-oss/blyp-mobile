import {
  createEmptyGrid9Session,
  type Grid9ClientSession,
  type Grid9ConnectionStatus,
} from './reconcile';

type Listener = () => void;

let session: Grid9ClientSession = createEmptyGrid9Session();
const listeners = new Set<Listener>();

export function getGrid9Session(): Grid9ClientSession {
  return session;
}

export function subscribeGrid9Session(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function replaceGrid9Session(next: Grid9ClientSession): Grid9ClientSession {
  session = next;
  emit();
  return session;
}

export function patchGrid9Session(
  patch: Partial<Grid9ClientSession> | ((current: Grid9ClientSession) => Grid9ClientSession),
): Grid9ClientSession {
  const next = typeof patch === 'function' ? patch(session) : { ...session, ...patch };
  return replaceGrid9Session(next);
}

export function setGrid9ConnectionStatus(connectionStatus: Grid9ConnectionStatus): void {
  if (session.connectionStatus === connectionStatus) return;
  patchGrid9Session({ connectionStatus });
}

export function resetGrid9Session(): Grid9ClientSession {
  return replaceGrid9Session(createEmptyGrid9Session());
}
