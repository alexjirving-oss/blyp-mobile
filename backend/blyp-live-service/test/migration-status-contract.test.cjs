'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getMigrationStatus,
  platformMigrations,
} = require('../dist/platform/migrations/runner');

function createFakeDb({ ledgerExists, appliedIds = [] }) {
  const calls = [];

  function db(table) {
    calls.push({ kind: 'table', table });
    assert.equal(table, 'platform_schema_migrations');

    return {
      select(column) {
        calls.push({ kind: 'select', column });
        assert.equal(column, 'migration_id');

        return {
          async orderBy(orderColumn, direction) {
            calls.push({ kind: 'orderBy', orderColumn, direction });
            assert.equal(orderColumn, 'migration_id');
            assert.equal(direction, 'asc');
            return appliedIds.map((migration_id) => ({ migration_id }));
          },
        };
      },
    };
  }

  db.raw = async (sql) => {
    calls.push({ kind: 'raw', sql });
    assert.match(sql, /^\s*SELECT\b/i);
    assert.match(sql, /to_regclass\('platform_schema_migrations'\)/);
    assert.doesNotMatch(
      sql,
      /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
      'migration status must not execute mutating SQL'
    );
    return { rows: [{ ledger_exists: ledgerExists }] };
  };

  return { db, calls };
}

test('migration CLI is database-only and closes its pool without constructing Redis', () => {
  const cliSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'platform', 'migrations', 'cli.ts'),
    'utf8'
  );

  assert.match(cliSource, /createEconomyDb\(\)/);
  assert.match(cliSource, /await db\.destroy\(\)/);
  assert.doesNotMatch(cliSource, /getEconomyInfra|\bredis\b/i);
});

test('migration status reports a missing ledger without creating or reading it', async () => {
  const { db, calls } = createFakeDb({ ledgerExists: false });

  const status = await getMigrationStatus(db);

  assert.equal(status.ledgerExists, false);
  assert.deepEqual(
    status.migrations.map(({ id, applied }) => ({ id, applied })),
    platformMigrations.map(({ id }) => ({ id, applied: false }))
  );
  assert.deepEqual(calls.map(({ kind }) => kind), ['raw']);
});

test('migration status reads applied IDs when the ledger already exists', async () => {
  const appliedIds = [platformMigrations[0].id, platformMigrations.at(-1).id];
  const { db, calls } = createFakeDb({ ledgerExists: true, appliedIds });

  const status = await getMigrationStatus(db);

  assert.equal(status.ledgerExists, true);
  assert.deepEqual(
    status.migrations.filter(({ applied }) => applied).map(({ id }) => id),
    appliedIds
  );
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ['raw', 'table', 'select', 'orderBy']
  );
});
