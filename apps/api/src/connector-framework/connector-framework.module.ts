import { DynamicModule, Module } from '@nestjs/common';

import { ConnectorExecutionModule } from '../connector-execution/connector-execution.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SecretsModule } from '../secrets/secrets.module';
import { ConnectorDefinitionRegistry } from './connector-definition.registry';
import { ConnectorRunService } from './connector-run.service';
import { ConnectorRunWorker } from './connector-run.worker';
import { ConnectorRunReconciler } from './connector-run-reconciler.service';
import { CONNECTOR_DEFINITIONS, type ConnectorDefinition } from './connector-framework.types';
import { ConnectorManagementController } from './management/connector-management.controller';
import { ConnectorManagementService } from './management/connector-management.service';

@Module({
  imports: [ConnectorExecutionModule, IngestionModule, SecretsModule],
})
export class ConnectorFrameworkModule {
  static register(definitions: readonly ConnectorDefinition[]): DynamicModule {
    return {
      module: ConnectorFrameworkModule,
      controllers: [ConnectorManagementController],
      providers: [
        { provide: CONNECTOR_DEFINITIONS, useValue: Object.freeze([...definitions]) },
        ConnectorDefinitionRegistry,
        ConnectorRunService,
        ConnectorRunWorker,
        ConnectorRunReconciler,
        ConnectorManagementService,
      ],
      exports: [ConnectorDefinitionRegistry, ConnectorRunService],
    };
  }
}
