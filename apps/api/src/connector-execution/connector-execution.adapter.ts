import type { ConstructorOptions, PgBoss } from 'pg-boss';

export const CONNECTOR_EXECUTION_BOSS_FACTORY = Symbol('CONNECTOR_EXECUTION_BOSS_FACTORY');

export type ConnectorExecutionBossFactory = (options: ConstructorOptions) => Promise<PgBoss>;

export const createPgBoss: ConnectorExecutionBossFactory = async (options) => {
  const { PgBoss } = await import('pg-boss');
  return new PgBoss(options);
};
