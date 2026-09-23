import { Injectable } from '@nestjs/common';

const DEFAULT_SCHEMA = 'pgboss';
const SCHEMA_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} deve ser true ou false.`);
}

function readInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

@Injectable()
export class ConnectorExecutionConfig {
  readonly enabled = readBoolean('CONNECTOR_EXECUTION_ENABLED', false);
  readonly poolMax = readInteger('CONNECTOR_EXECUTION_POOL_MAX', 2, 1, 10);
  readonly payloadMaxBytes = readInteger(
    'CONNECTOR_EXECUTION_PAYLOAD_MAX_BYTES',
    65_536,
    1_024,
    1_048_576,
  );
  readonly shutdownTimeoutMs = readInteger(
    'CONNECTOR_EXECUTION_SHUTDOWN_TIMEOUT_MS',
    30_000,
    1_000,
    120_000,
  );
  readonly schema = (process.env.CONNECTOR_EXECUTION_SCHEMA ?? DEFAULT_SCHEMA).trim();
  readonly databaseUrl = this.enabled ? process.env.DATABASE_URL?.trim() : undefined;

  constructor() {
    if (!SCHEMA_PATTERN.test(this.schema)) {
      throw new Error('CONNECTOR_EXECUTION_SCHEMA contém identificador inválido.');
    }
    if (this.enabled && !this.databaseUrl) {
      throw new Error('DATABASE_URL é obrigatória quando Connector Execution está habilitado.');
    }
  }
}
