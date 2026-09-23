import { PgBoss } from 'pg-boss';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

const EXPECTED_SCHEMA_VERSION = 42;
const SCHEMA_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

async function main(): Promise<void> {
  loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const schema = (process.env.CONNECTOR_EXECUTION_SCHEMA ?? 'pgboss').trim();
  if (!SCHEMA_PATTERN.test(schema)) throw new Error('CONNECTOR_EXECUTION_SCHEMA is invalid.');

  const boss = new PgBoss({
    connectionString,
    schema,
    max: 1,
    migrate: true,
    schedule: false,
    supervise: false,
    useListenNotify: false,
    application_name: 'atlas-connector-execution-migration',
  });
  try {
    await boss.start();
    const version = await boss.schemaVersion();
    const drift = await boss.detectSchemaDrift();
    if (version !== EXPECTED_SCHEMA_VERSION || !drift.ok) {
      throw new Error('pg-boss schema compatibility validation failed.');
    }
    process.stdout.write(
      `Connector Execution schema ${schema} is compatible at version ${version}.\n`,
    );
  } finally {
    await boss.stop({ graceful: true, close: true }).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(`Connector Execution migration failed (${errorType}).\n`);
  process.exitCode = 1;
});
