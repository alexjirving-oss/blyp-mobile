import { createHash } from 'crypto';
import type { Knex } from 'knex';

export type FeatureFlagRow = {
  flag_key: string;
  enabled: boolean;
  rollout_percentage: number;
  allow_subjects: unknown;
  deny_subjects: unknown;
  configuration: unknown;
  description: string;
  updated_at: Date | string;
};

export type EvaluatedFeatureFlag = {
  key: string;
  enabled: boolean;
  configuration: Record<string, unknown>;
  updatedAt: string;
};

function stringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cohortBucket(flagKey: string, subject: string): number {
  const digest = createHash('sha256').update(`${flagKey}:${subject}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function evaluateFeatureFlag(row: FeatureFlagRow, subject: string): EvaluatedFeatureFlag {
  const allowSubjects = stringSet(row.allow_subjects);
  const denySubjects = stringSet(row.deny_subjects);
  const rolloutPercentage = Math.max(0, Math.min(Number(row.rollout_percentage) || 0, 100));

  let enabled = false;
  if (row.enabled && !denySubjects.has(subject)) {
    enabled = allowSubjects.has(subject) || cohortBucket(row.flag_key, subject) < rolloutPercentage;
  }

  return {
    key: row.flag_key,
    enabled,
    configuration: enabled ? objectValue(row.configuration) : {},
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getEvaluatedFeatureFlags(db: Knex, subject: string): Promise<EvaluatedFeatureFlag[]> {
  const rows = await db<FeatureFlagRow>('feature_flags')
    .select(
      'flag_key',
      'enabled',
      'rollout_percentage',
      'allow_subjects',
      'deny_subjects',
      'configuration',
      'description',
      'updated_at'
    )
    .orderBy('flag_key', 'asc');
  return rows.map((row) => evaluateFeatureFlag(row, subject));
}

export async function isFeatureEnabled(db: Knex, flagKey: string, subject: string): Promise<boolean> {
  const row = await db<FeatureFlagRow>('feature_flags').where({ flag_key: flagKey }).first();
  if (!row) return false;
  return evaluateFeatureFlag(row, subject).enabled;
}
