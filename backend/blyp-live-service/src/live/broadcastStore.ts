import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { ensureBroadcastSchema } from './broadcastSchema';
import {
  encryptBroadcastSecret,
  decryptBroadcastSecret,
  type BroadcastRtmpSecret,
} from './broadcastSecretCrypto';
import type { BroadcastPlatform, BroadcastProfile } from './broadcastRtmpValidate';

export type BroadcastPhase =
  | 'idle'
  | 'preflight'
  | 'provisioning'
  | 'starting'
  | 'live'
  | 'stopped'
  | 'failed';

export type BroadcastDestinationStatus =
  | 'pending'
  | 'connecting'
  | 'live'
  | 'degraded'
  | 'failed';

export type BroadcastSessionRow = {
  session_id: string;
  host_user_id: string;
  region: string;
  hls_url: string | null;
  phase: BroadcastPhase;
  worker_id: string | null;
  worker_base_url: string | null;
  provisioning_eta_seconds: number | null;
  error_detail: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type BroadcastDestinationRow = {
  destination_id: string;
  session_id: string;
  platform: BroadcastPlatform;
  profile: BroadcastProfile;
  rtmp_url_ciphertext: string;
  stream_key_ciphertext: string;
  status: BroadcastDestinationStatus;
  expires_at: Date | null;
  last_error: string | null;
  relay_path: string | null;
  created_at: Date;
  updated_at: Date;
};

async function db(): Promise<Knex> {
  const { db: knex } = getEconomyInfra();
  await ensureBroadcastSchema(knex);
  return knex;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function upsertBroadcastSession(input: {
  sessionId: string;
  hostUserId: string;
  region: string;
  hlsUrl?: string | null;
  phase?: BroadcastPhase;
  workerId?: string | null;
  workerBaseUrl?: string | null;
  provisioningEtaSeconds?: number | null;
  errorDetail?: string | null;
}): Promise<void> {
  const knex = await db();
  const existing = await knex('broadcast_sessions').where({ session_id: input.sessionId }).first();
  const patch = {
    host_user_id: input.hostUserId,
    region: input.region,
    hls_url: input.hlsUrl ?? existing?.hls_url ?? null,
    phase: input.phase ?? existing?.phase ?? 'idle',
    worker_id: input.workerId !== undefined ? input.workerId : existing?.worker_id ?? null,
    worker_base_url:
      input.workerBaseUrl !== undefined ? input.workerBaseUrl : existing?.worker_base_url ?? null,
    provisioning_eta_seconds:
      input.provisioningEtaSeconds !== undefined
        ? input.provisioningEtaSeconds
        : existing?.provisioning_eta_seconds ?? null,
    error_detail: input.errorDetail !== undefined ? input.errorDetail : existing?.error_detail ?? null,
    updated_at: knex.fn.now(),
  };

  if (existing) {
    await knex('broadcast_sessions').where({ session_id: input.sessionId }).update(patch);
    return;
  }

  await knex('broadcast_sessions').insert({
    session_id: input.sessionId,
    ...patch,
    metadata: {},
    created_at: knex.fn.now(),
  });
}

export async function getBroadcastSession(sessionId: string): Promise<BroadcastSessionRow | null> {
  const knex = await db();
  const row = await knex('broadcast_sessions').where({ session_id: sessionId }).first();
  return (row as BroadcastSessionRow | undefined) || null;
}

export async function listBroadcastDestinations(sessionId: string): Promise<BroadcastDestinationRow[]> {
  const knex = await db();
  const rows = await knex('broadcast_session_destinations')
    .where({ session_id: sessionId })
    .orderBy('created_at', 'asc');
  return rows as BroadcastDestinationRow[];
}

export async function replaceBroadcastDestinations(
  sessionId: string,
  destinations: Array<{
    platform: BroadcastPlatform;
    profile: BroadcastProfile;
    rtmpUrl: string;
    streamKey: string;
    expiresAt?: string | null;
    relayPath?: string | null;
  }>,
): Promise<BroadcastDestinationRow[]> {
  const knex = await db();
  await knex('broadcast_session_destinations').where({ session_id: sessionId }).del();

  if (!destinations.length) return [];

  const rows = destinations.map((d) => {
    const secret: BroadcastRtmpSecret = { rtmpUrl: d.rtmpUrl, streamKey: d.streamKey };
    const urlCipher = encryptBroadcastSecret(secret);
    return {
      destination_id: randomUUID(),
      session_id: sessionId,
      platform: d.platform,
      profile: d.profile,
      rtmp_url_ciphertext: urlCipher,
      stream_key_ciphertext: urlCipher,
      status: 'pending' as BroadcastDestinationStatus,
      expires_at: d.expiresAt ? new Date(d.expiresAt) : null,
      last_error: null,
      relay_path: d.relayPath ?? null,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    };
  });

  await knex('broadcast_session_destinations').insert(rows);
  return listBroadcastDestinations(sessionId);
}

export function decodeDestinationSecret(row: BroadcastDestinationRow): BroadcastRtmpSecret {
  return decryptBroadcastSecret(row.rtmp_url_ciphertext);
}

export async function updateBroadcastPhase(
  sessionId: string,
  phase: BroadcastPhase,
  fields?: {
    errorDetail?: string | null;
    workerId?: string | null;
    workerBaseUrl?: string | null;
    provisioningEtaSeconds?: number | null;
    hlsUrl?: string | null;
  },
): Promise<void> {
  const knex = await db();
  const patch: Record<string, unknown> = {
    phase,
    updated_at: knex.fn.now(),
  };
  if (fields?.errorDetail !== undefined) patch.error_detail = fields.errorDetail;
  if (fields?.workerId !== undefined) patch.worker_id = fields.workerId;
  if (fields?.workerBaseUrl !== undefined) patch.worker_base_url = fields.workerBaseUrl;
  if (fields?.provisioningEtaSeconds !== undefined) {
    patch.provisioning_eta_seconds = fields.provisioningEtaSeconds;
  }
  if (fields?.hlsUrl !== undefined) patch.hls_url = fields.hlsUrl;
  await knex('broadcast_sessions').where({ session_id: sessionId }).update(patch);
}

export async function updateDestinationStatus(
  destinationId: string,
  status: BroadcastDestinationStatus,
  lastError?: string | null,
): Promise<void> {
  const knex = await db();
  await knex('broadcast_session_destinations')
    .where({ destination_id: destinationId })
    .update({
      status,
      last_error: lastError ?? null,
      updated_at: knex.fn.now(),
    });
}

export async function updateDestinationCredentials(
  sessionId: string,
  platform: BroadcastPlatform,
  secret: BroadcastRtmpSecret,
  expiresAt?: string | null,
): Promise<BroadcastDestinationRow | null> {
  const knex = await db();
  const cipher = encryptBroadcastSecret(secret);
  const updated = await knex('broadcast_session_destinations')
    .where({ session_id: sessionId, platform })
    .update({
      rtmp_url_ciphertext: cipher,
      stream_key_ciphertext: cipher,
      expires_at: expiresAt ? new Date(expiresAt) : null,
      status: 'pending',
      last_error: null,
      updated_at: knex.fn.now(),
    })
    .returning('*');
  const row = Array.isArray(updated) ? updated[0] : null;
  return (row as BroadcastDestinationRow | undefined) || null;
}

export async function markBroadcastStopped(sessionId: string): Promise<void> {
  const knex = await db();
  await knex('broadcast_sessions')
    .where({ session_id: sessionId })
    .update({ phase: 'stopped', updated_at: knex.fn.now() });
  await knex('broadcast_session_destinations')
    .where({ session_id: sessionId })
    .update({ status: 'failed', last_error: 'session_ended', updated_at: knex.fn.now() });
}

export function publicDestinationView(row: BroadcastDestinationRow) {
  return {
    destinationId: row.destination_id,
    platform: row.platform,
    profile: row.profile,
    status: row.status,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    lastError: row.last_error,
    relayPath: row.relay_path,
  };
}

export function publicSessionView(row: BroadcastSessionRow, destinations: BroadcastDestinationRow[]) {
  return {
    sessionId: row.session_id,
    phase: row.phase,
    region: row.region,
    workerAssigned: Boolean(row.worker_id),
    provisioningEtaSeconds: row.provisioning_eta_seconds,
    message:
      row.phase === 'provisioning'
        ? `Provisioning broadcast servers (~${row.provisioning_eta_seconds ?? 45}s)...`
        : null,
    errorDetail: row.error_detail,
    destinations: destinations.map(publicDestinationView),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : nowIso(),
  };
}
