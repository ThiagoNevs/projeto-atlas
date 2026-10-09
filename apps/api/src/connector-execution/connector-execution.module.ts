import { Module } from '@nestjs/common';

import { CONNECTOR_EXECUTION_BOSS_FACTORY, createPgBoss } from './connector-execution.adapter';
import { ConnectorExecutionConfig } from './connector-execution.config';
import { ConnectorExecutionService } from './connector-execution.service';

@Module({
  providers: [
    ConnectorExecutionConfig,
    ConnectorExecutionService,
    { provide: CONNECTOR_EXECUTION_BOSS_FACTORY, useValue: createPgBoss },
  ],
  exports: [ConnectorExecutionConfig, ConnectorExecutionService],
})
export class ConnectorExecutionModule {}
