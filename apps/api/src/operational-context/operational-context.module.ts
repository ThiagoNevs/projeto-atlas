import { Global, MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';

import { OperationalLogger } from './operational-logger.service';
import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  providers: [RequestContextService, OperationalLogger, RequestContextMiddleware],
  exports: [RequestContextService, OperationalLogger],
})
export class OperationalContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
