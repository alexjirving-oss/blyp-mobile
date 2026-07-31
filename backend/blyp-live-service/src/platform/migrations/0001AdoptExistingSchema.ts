import { ensureEconomySchema } from '../../economy/schema';
import type { PlatformMigration } from './types';

export const adoptExistingSchemaMigration: PlatformMigration = {
  id: '0001_adopt_existing_schema',
  description: 'Adopt the existing economy, subscription, admin, and app-version schema as the migration baseline.',
  transactional: false,
  reversible: false,
  async up(db) {
    await ensureEconomySchema(db);
  },
};
