import { Module } from '@nestjs/common';

import { NetworkDiscoveryController } from './network-discovery.controller';
import { NetworkDiscoveryService } from './network-discovery.service';

@Module({
  controllers: [NetworkDiscoveryController],
  providers: [NetworkDiscoveryService],
})
export class NetworkDiscoveryModule {}
