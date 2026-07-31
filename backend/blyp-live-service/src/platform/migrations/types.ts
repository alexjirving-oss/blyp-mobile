import type { Knex } from 'knex';

export type PlatformMigration = {
  id: string;
  description: string;
  transactional: boolean;
  reversible: boolean;
  up(db: Knex | Knex.Transaction): Promise<void>;
  down?(db: Knex | Knex.Transaction): Promise<void>;
};
