import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import { CreateNetworkDiscoveryProfileDto } from './dto/create-network-discovery-profile.dto';
import { UpdateNetworkDiscoveryProfileDto } from './dto/update-network-discovery-profile.dto';
import { NetworkDiscoveryService } from './network-discovery.service';

@Controller('network-discovery')
export class NetworkDiscoveryController {
  constructor(private readonly networkDiscoveryService: NetworkDiscoveryService) {}

  @Get('profiles')
  findProfiles() {
    return this.networkDiscoveryService.findProfiles();
  }

  @Post('profiles')
  createProfile(@Body() payload: CreateNetworkDiscoveryProfileDto) {
    return this.networkDiscoveryService.createProfile(payload);
  }

  @Get('profiles/:id')
  findProfile(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.networkDiscoveryService.findProfile(id);
  }

  @Patch('profiles/:id')
  updateProfile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: UpdateNetworkDiscoveryProfileDto,
  ) {
    return this.networkDiscoveryService.updateProfile(id, payload);
  }

  @Post('profiles/:id/run')
  runProfile(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.networkDiscoveryService.runProfile(id);
  }

  @Get('runs')
  findRuns() {
    return this.networkDiscoveryService.findRuns();
  }

  @Get('runs/:id')
  findRun(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.networkDiscoveryService.findRun(id);
  }
}
