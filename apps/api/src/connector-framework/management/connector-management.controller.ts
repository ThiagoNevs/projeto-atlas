import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import type { CurrentActor } from '../../auth/auth.types';
import { CurrentActor as Actor } from '../../auth/current-actor.decorator';
import { ATLAS_PERMISSIONS } from '../../auth/permissions';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { throwConnectorHttpError } from './connector-management.errors';
import { ConnectorManagementService } from './connector-management.service';
import { CreateConnectorInstanceDto } from './dto/create-connector-instance.dto';
import { DeleteConnectorSecretReferenceDto } from './dto/delete-connector-secret-reference.dto';
import { SetConnectorSecretReferenceDto } from './dto/set-connector-secret-reference.dto';
import { UpdateConnectorInstanceDto } from './dto/update-connector-instance.dto';

@Controller('connectors')
export class ConnectorManagementController {
  constructor(private readonly management: ConnectorManagementService) {}

  @Get('definitions')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorRead)
  listDefinitions() {
    return this.management.listDefinitions();
  }

  @Get('instances')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorRead)
  listInstances() {
    return this.execute(() => this.management.listInstances());
  }

  @Post('instances')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorConfigure)
  createInstance(@Body() dto: CreateConnectorInstanceDto, @Actor() actor: CurrentActor) {
    return this.execute(() => this.management.createInstance(dto, actor));
  }

  @Get('instances/:id')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorRead)
  getInstance(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.execute(() => this.management.getInstance(id));
  }

  @Patch('instances/:id')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorConfigure)
  updateInstance(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateConnectorInstanceDto,
    @Actor() actor: CurrentActor,
  ) {
    return this.execute(() => this.management.updateInstance(id, dto, actor));
  }

  @Put('instances/:id/secret-references/:slot')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorConfigure)
  setSecretReference(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('slot') slot: string,
    @Body() dto: SetConnectorSecretReferenceDto,
    @Actor() actor: CurrentActor,
  ) {
    return this.execute(() => this.management.setSecretReference(id, slot, dto, actor));
  }

  @Delete('instances/:id/secret-references/:slot')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorConfigure)
  removeSecretReference(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('slot') slot: string,
    @Body() dto: DeleteConnectorSecretReferenceDto,
    @Actor() actor: CurrentActor,
  ) {
    return this.execute(() => this.management.removeSecretReference(id, slot, dto, actor));
  }

  @Post('instances/:id/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(ATLAS_PERMISSIONS.connectorExecute)
  requestRun(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Actor() actor: CurrentActor,
  ) {
    return this.execute(() => this.management.requestRun(id, actor, idempotencyKey ?? ''));
  }

  @Get('runs')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorRead)
  listRuns() {
    return this.execute(() => this.management.listRuns());
  }

  @Get('runs/:id')
  @RequirePermissions(ATLAS_PERMISSIONS.connectorRead)
  getRun(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.execute(() => this.management.getRun(id));
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throwConnectorHttpError(error);
    }
  }
}
