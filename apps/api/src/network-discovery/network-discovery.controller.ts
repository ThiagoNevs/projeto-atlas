import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { CurrentActor as Actor } from '../auth/current-actor.decorator';
import type { CurrentActor } from '../auth/auth.types';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { CreateNetworkDiscoveryProfileDto } from './dto/create-network-discovery-profile.dto';
import { UpdateNetworkDiscoveryProfileDto } from './dto/update-network-discovery-profile.dto';
import { NetworkDiscoveryService } from './network-discovery.service';

@Controller('network-discovery')
export class NetworkDiscoveryController {
  constructor(private readonly networkDiscoveryService: NetworkDiscoveryService) {}

  @Get('profiles')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryRead)
  findProfiles() {
    return this.networkDiscoveryService.findProfiles();
  }

  @Post('profiles')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryConfigure)
  createProfile(@Body() payload: CreateNetworkDiscoveryProfileDto, @Actor() actor: CurrentActor) {
    return this.networkDiscoveryService.createProfile(payload, actor);
  }

  @Get('profiles/:id')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryRead)
  findProfile(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.networkDiscoveryService.findProfile(id);
  }

  @Patch('profiles/:id')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryConfigure)
  updateProfile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: UpdateNetworkDiscoveryProfileDto,
    @Actor() actor: CurrentActor,
  ) {
    return this.networkDiscoveryService.updateProfile(id, payload, actor);
  }

  @Post('profiles/:id/run')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryExecute)
  runProfile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Actor() actor: CurrentActor,
  ) {
    return this.networkDiscoveryService.runProfile(id, actor);
  }

  @Get('runs')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryRead)
  findRuns() {
    return this.networkDiscoveryService.findRuns();
  }

  @Get('runs/:id')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryRead)
  findRun(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.networkDiscoveryService.findRun(id);
  }
}
