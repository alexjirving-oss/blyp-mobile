import '../config/env';
import { getEconomyInfra } from '../economy/infra';
import { ensureEconomySchema } from '../economy/schema';
import { logger } from '../config/logger';

async function main() {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  logger.info('[migrate] economy schema ensured (idempotent ensure-on-boot path)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err: err?.message || String(err) }, '[migrate] failed');
    process.exit(1);
  });
