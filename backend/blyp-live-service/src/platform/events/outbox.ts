import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { logger } from '../../config/logger';
import type { RegisteredEventType } from './eventRegistry';
import { validateEventPayload, validateEventVersion } from './eventRegistry';

export type DomainEventEnvelope = {
  eventId: string;
  eventType: RegisteredEventType;
  eventVersion: number;
  occurredAt: string;
  aggregate: { type: string; id: string };
  actorUserId: string | null;
  correlationId: string;
  payload: Record<string, unknown>;
};

export type DomainEventInput = Omit<DomainEventEnvelope, 'eventId' | 'occurredAt' | 'payload'> & {
  eventId?: string;
  occurredAt?: string;
  payload: unknown;
};

export interface DomainEventPublisher {
  publish(event: DomainEventEnvelope): Promise<void>;
  close?(): Promise<void>;
}

type OutboxRow = {
  event_id: string;
  event_type: RegisteredEventType;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  actor_user_id: string | null;
  correlation_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
  attempts: number;
};

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToEnvelope(row: OutboxRow): DomainEventEnvelope {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    occurredAt: asIso(row.occurred_at),
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    actorUserId: row.actor_user_id,
    correlationId: row.correlation_id,
    payload: row.payload,
  };
}

export async function enqueueDomainEvent(
  connection: Knex | Knex.Transaction,
  input: DomainEventInput
): Promise<DomainEventEnvelope> {
  validateEventVersion(input.eventType, input.eventVersion);
  const payload = validateEventPayload(input.eventType, input.payload);
  const event: DomainEventEnvelope = {
    eventId: input.eventId || randomUUID(),
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    occurredAt: input.occurredAt || new Date().toISOString(),
    aggregate: input.aggregate,
    actorUserId: input.actorUserId,
    correlationId: input.correlationId,
    payload,
  };

  await connection('domain_outbox').insert({
    event_id: event.eventId,
    event_type: event.eventType,
    event_version: event.eventVersion,
    aggregate_type: event.aggregate.type,
    aggregate_id: event.aggregate.id,
    actor_user_id: event.actorUserId,
    correlation_id: event.correlationId,
    payload: JSON.stringify(event.payload),
    occurred_at: event.occurredAt,
  });
  return event;
}

async function claimBatch(db: Knex, workerId: string, batchSize: number): Promise<OutboxRow[]> {
  return db.transaction(async (trx) => {
    const result = await trx.raw(
      `
        WITH candidates AS (
          SELECT event_id
          FROM domain_outbox
          WHERE published_at IS NULL
            AND available_at <= CURRENT_TIMESTAMP
            AND (locked_at IS NULL OR locked_at < CURRENT_TIMESTAMP - interval '2 minutes')
          ORDER BY created_at ASC, event_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ?
        )
        UPDATE domain_outbox AS pending
        SET locked_at = CURRENT_TIMESTAMP,
            locked_by = ?,
            attempts = pending.attempts + 1
        FROM candidates
        WHERE pending.event_id = candidates.event_id
        RETURNING pending.*
      `,
      [batchSize, workerId]
    );
    return (result.rows || []) as OutboxRow[];
  });
}

async function markPublished(db: Knex, row: OutboxRow, workerId: string) {
  await db('domain_outbox')
    .where({ event_id: row.event_id, locked_by: workerId })
    .update({
      published_at: db.fn.now(),
      locked_at: null,
      locked_by: null,
      last_error: null,
    });
}

async function markFailed(db: Knex, row: OutboxRow, workerId: string, error: unknown, maxAttempts: number) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  if (row.attempts >= maxAttempts) {
    await db.transaction(async (trx) => {
      await trx('domain_outbox_dead_letters')
        .insert({
          event_id: row.event_id,
          event_type: row.event_type,
          event_version: row.event_version,
          aggregate_type: row.aggregate_type,
          aggregate_id: row.aggregate_id,
          actor_user_id: row.actor_user_id,
          correlation_id: row.correlation_id,
          payload: JSON.stringify(row.payload),
          occurred_at: row.occurred_at,
          attempts: row.attempts,
          last_error: message,
        })
        .onConflict('event_id')
        .merge({
          attempts: row.attempts,
          last_error: message,
          dead_lettered_at: trx.fn.now(),
        });
      await trx('domain_outbox')
        .where({ event_id: row.event_id, locked_by: workerId })
        .delete();
    });
    logger.error({ eventId: row.event_id, eventType: row.event_type, attempts: row.attempts }, '[outbox_dead_lettered]');
    return;
  }

  const delayMs = Math.min(60_000, 1000 * 2 ** Math.max(0, row.attempts - 1));
  await db('domain_outbox')
    .where({ event_id: row.event_id, locked_by: workerId })
    .update({
      available_at: db.raw("CURRENT_TIMESTAMP + (? * interval '1 millisecond')", [delayMs]),
      locked_at: null,
      locked_by: null,
      last_error: message,
    });
}

export async function dispatchOutboxBatch(
  db: Knex,
  publisher: DomainEventPublisher,
  options: { workerId: string; batchSize?: number; maxAttempts?: number }
): Promise<number> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 50, 200));
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 10, 100));
  const rows = await claimBatch(db, options.workerId, batchSize);

  for (const row of rows) {
    try {
      const event = rowToEnvelope(row);
      validateEventVersion(event.eventType, event.eventVersion);
      validateEventPayload(event.eventType, event.payload);
      await publisher.publish(event);
      await markPublished(db, row, options.workerId);
    } catch (error) {
      await markFailed(db, row, options.workerId, error, maxAttempts);
    }
  }
  return rows.length;
}

export async function replayDeadLetter(db: Knex, eventId: string): Promise<void> {
  await db.transaction(async (trx) => {
    const row = await trx('domain_outbox_dead_letters').where({ event_id: eventId }).forUpdate().first();
    if (!row) throw new Error(`Dead-letter event not found: ${eventId}`);
    if (row.replayed_at) throw new Error(`Dead-letter event was already replayed: ${eventId}`);

    await trx('domain_outbox').insert({
      event_id: row.event_id,
      event_type: row.event_type,
      event_version: row.event_version,
      aggregate_type: row.aggregate_type,
      aggregate_id: row.aggregate_id,
      actor_user_id: row.actor_user_id,
      correlation_id: row.correlation_id,
      payload: row.payload,
      occurred_at: row.occurred_at,
      attempts: 0,
      available_at: trx.fn.now(),
    });
    await trx('domain_outbox_dead_letters').where({ event_id: eventId }).update({ replayed_at: trx.fn.now() });
  });
}
