import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { RequestContext } from './request-context.types';

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  runWithContext<TResult>(context: RequestContext, callback: () => TResult): TResult {
    return this.storage.run(context, callback);
  }

  getContext(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.getContext()?.requestId;
  }

  getCorrelationId(): string | undefined {
    return this.getContext()?.correlationId;
  }
}
