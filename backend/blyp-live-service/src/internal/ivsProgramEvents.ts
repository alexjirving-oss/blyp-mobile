import { logger } from '../config/logger';
import { getSessionByStageArn, type CompositionState } from '../live/liveSessionStore';
import { updateSessionProgram } from '../live/liveSessionStore';
import { ensureProgram } from '../live/programEgress';
import { sweepStaleLiveDirectory } from '../admin/firestoreAdmin';

export function mapCompositionEventName(name: string): CompositionState | null {
  if (name === 'Destination Start') return 'ACTIVE';
  if (name === 'Session Start') return 'STARTING';
  if (name === 'Destination Reconnecting') return 'RECONNECTING';
  if (name === 'Session End' || name === 'Destination End') return 'STOPPED';
  if (name === 'Session Failure' || name === 'Destination Failure') return 'FAILED';
  return null;
}

export async function handleParticipantPublished(body: any): Promise<{ ok: true; ignored?: true; unmatched?: true }> {
  const detail = body?.detail || {};
  if (detail.event_name !== 'Participant Published') {
    return { ok: true, ignored: true };
  }
  const resources = Array.isArray(body?.resources) ? body.resources : [];
  const stageArn = String(resources[0] || detail.source_stage_arn || '').trim();
  if (!stageArn) return { ok: true, unmatched: true };
  const session = await getSessionByStageArn(stageArn);
  if (!session) return { ok: true, unmatched: true };
  await ensureProgram(session.sessionId, { hasPublisher: true });
  return { ok: true };
}

export async function handleCompositionState(body: any): Promise<{
  ok: true;
  ignored?: true;
  unmatched?: true;
  ensureProgramCalled?: boolean;
}> {
  const detail = body?.detail || {};
  const resources = Array.isArray(body?.resources) ? body.resources : [];
  const mapped = mapCompositionEventName(String(detail.event_name || ''));
  if (!mapped) return { ok: true, ignored: true };
  const stageArn = String(detail.stage_arn || '').trim();
  if (!stageArn) return { ok: true, unmatched: true };
  const session = await getSessionByStageArn(stageArn);
  if (!session) return { ok: true, unmatched: true };
  const compositionArn =
    typeof resources[0] === 'string' && resources[0].includes(':composition/')
      ? resources[0]
      : session.compositionArn;
  await updateSessionProgram(session.sessionId, {
    compositionState: mapped,
    ...(compositionArn ? { compositionArn } : {}),
  });
  if (mapped === 'FAILED' && session.status === 'LIVE') {
    void ensureProgram(session.sessionId, { hasPublisher: true });
    return { ok: true, ensureProgramCalled: true };
  }
  return { ok: true };
}

export async function handleLiveOrphanSweep(): Promise<{ ok: boolean; swept: number; ids: string[] }> {
  const out = await sweepStaleLiveDirectory({ staleMs: 90_000, limit: 40 });
  logger.warn({ swept: out.swept, ids: out.ids }, '[internal] live-orphan-sweep');
  return { ok: !!out.ok, swept: out.swept, ids: out.ids };
}
