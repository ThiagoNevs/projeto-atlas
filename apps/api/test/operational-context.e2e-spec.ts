import {
  BadRequestException,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import request from 'supertest';

import {
  OperationalLogger,
  type OperationalLogRecord,
} from '../src/operational-context/operational-logger.service';
import { OperationalContextModule } from '../src/operational-context/operational-context.module';
import { RequestContextMiddleware } from '../src/operational-context/request-context.middleware';
import { RequestContextService } from '../src/operational-context/request-context.service';
import {
  canonicalUuidV4,
  resolveRequestContext,
  type RequestContext,
} from '../src/operational-context/request-context.types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface OperationalLogSpy {
  mockClear(): void;
  readonly mock: {
    readonly calls: readonly (readonly [OperationalLogRecord])[];
  };
}

@Injectable()
class DeterministicBarrier {
  private waiters: Array<() => void> = [];

  wait(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      if (this.waiters.length === 2) {
        const pair = this.waiters.splice(0, 2);
        pair.forEach((release) => release());
      }
    });
  }
}

@Controller('operational-test')
class OperationalTestController {
  constructor(
    private readonly context: RequestContextService,
    private readonly barrier: DeterministicBarrier,
  ) {}

  @Get('ok')
  ok() {
    return this.context.getContext();
  }

  @Get('barrier/:label')
  async crossBarrier(@Param('label') label: string) {
    const before = this.context.getContext();
    await this.barrier.wait();
    await Promise.resolve();
    const after = this.context.getContext();
    return { label, before, after };
  }

  @Get('template/:label')
  template(@Param('label') label: string) {
    return { label };
  }

  @Get('bad-request')
  badRequest(): never {
    throw new BadRequestException();
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedException();
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException();
  }

  @Get('failure')
  failure(): never {
    throw new InternalServerErrorException();
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException();
  }

  @Post('sensitive')
  @HttpCode(204)
  sensitive(): void {}
}

describe('operational request context', () => {
  let module: TestingModule;
  let app: INestApplication;
  let logger: OperationalLogger;
  let logSpy: OperationalLogSpy;
  let warnSpy: OperationalLogSpy;
  let errorSpy: OperationalLogSpy;
  let debugSpy: OperationalLogSpy;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [OperationalContextModule],
      controllers: [OperationalTestController],
      providers: [DeterministicBarrier],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
    logger = module.get(OperationalLogger);
    logSpy = jest.spyOn(logger, 'log');
    warnSpy = jest.spyOn(logger, 'warn');
    errorSpy = jest.spyOn(logger, 'error');
    debugSpy = jest.spyOn(logger, 'debug');
  });

  beforeEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
    debugSpy.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates a fresh server UUID v4 and returns both context headers', async () => {
    const first = await request(serverOf(app)).get('/operational-test/ok').expect(200);
    const second = await request(serverOf(app)).get('/operational-test/ok').expect(200);

    for (const response of [first, second]) {
      expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
      expect(response.headers['x-correlation-id']).toBe(response.headers['x-request-id']);
      expect(response.body).toEqual({
        requestId: response.headers['x-request-id'],
        correlationId: response.headers['x-correlation-id'],
      });
    }
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('parses correlation input strictly without trimming, arrays or control characters', () => {
    const uuid = 'a987fbc9-4bed-4078-8f07-9141ba07c9f3';
    expect(canonicalUuidV4(uuid)).toBe(uuid);
    expect(canonicalUuidV4(uuid.toUpperCase())).toBe(uuid);
    for (const invalid of [undefined, null, [uuid], ` ${uuid}`, `${uuid} `, `${uuid}\r\n`]) {
      expect(canonicalUuidV4(invalid)).toBeNull();
    }
    expect(Object.isFrozen(resolveRequestContext(uuid).context)).toBe(true);
  });

  it('accepts one UUID v4 correlation ID and canonicalizes uppercase hex', async () => {
    const correlationId = 'A987FBC9-4BED-4078-8F07-9141BA07C9F3';
    const response = await request(serverOf(app))
      .get('/operational-test/ok')
      .set('X-Correlation-ID', correlationId)
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe(correlationId.toLowerCase());
    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.headers['x-request-id']).not.toBe(response.headers['x-correlation-id']);
  });

  it.each([
    ['invalid', 'not-a-uuid'],
    ['wrong UUID version', 'a987fbc9-4bed-5078-8f07-9141ba07c9f3'],
    [
      'multiple candidates',
      'a987fbc9-4bed-4078-8f07-9141ba07c9f3, b987fbc9-4bed-4078-8f07-9141ba07c9f3',
    ],
  ])('falls back safely for %s correlation input', async (_label, correlationId) => {
    const response = await request(serverOf(app))
      .get('/operational-test/ok')
      .set('X-Correlation-ID', correlationId)
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe(response.headers['x-request-id']);
  });

  it('ignores an incoming request ID and always replaces it', async () => {
    const supplied = 'a987fbc9-4bed-4078-8f07-9141ba07c9f3';
    const response = await request(serverOf(app))
      .get('/operational-test/ok')
      .set('X-Request-ID', supplied)
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.headers['x-request-id']).not.toBe(supplied);
  });

  it.each([
    ['/operational-test/bad-request', 400],
    ['/operational-test/unauthorized', 401],
    ['/operational-test/forbidden', 403],
    ['/not-a-route', 404],
    ['/operational-test/conflict', 409],
    ['/operational-test/failure', 500],
  ])('keeps context headers on %s responses', async (path, statusCode) => {
    const response = await request(serverOf(app)).get(path).expect(statusCode);
    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.headers['x-correlation-id']).toBe(response.headers['x-request-id']);
  });

  it('isolates concurrent async chains deterministically without sleeps', async () => {
    for (let repetition = 0; repetition < 10; repetition += 1) {
      const [left, right] = await Promise.all([
        request(serverOf(app)).get(`/operational-test/barrier/left-${repetition}`).expect(200),
        request(serverOf(app)).get(`/operational-test/barrier/right-${repetition}`).expect(200),
      ]);

      for (const response of [left, right]) {
        const body = response.body as {
          before: RequestContext;
          after: RequestContext;
        };
        expect(body.before).toEqual(body.after);
        expect(body.before.requestId).toBe(response.headers['x-request-id']);
      }
      const leftBody = left.body as { before: RequestContext };
      const rightBody = right.body as { before: RequestContext };
      expect(leftBody.before.requestId).not.toBe(rightBody.before.requestId);
    }
  });

  it('logs one allowlisted completion record with the route template and no query', async () => {
    await request(serverOf(app))
      .get('/operational-test/template/template-value?secret=query-secret')
      .expect(200);
    await nextTurn();

    const completion = recordsOf(logSpy).find(
      (record) => record.event === 'http.request.completed',
    );
    expect(completion).toEqual(
      expect.objectContaining({
        method: 'GET',
        route: '/operational-test/template/:label',
        statusCode: 200,
      }),
    );
    expect(JSON.stringify(completion)).not.toContain('template-value');
    expect(JSON.stringify(completion)).not.toContain('query-secret');
  });

  it('uses UNMATCHED rather than the requested URL when no route resolves', async () => {
    await request(serverOf(app)).get('/unmatched-sensitive-path?secret=query-secret').expect(404);
    await nextTurn();

    const completions = recordsOf(logSpy).filter(
      (record) => record.event === 'http.request.completed',
    );
    expect(completions).toHaveLength(1);
    expect(completions[0]).toEqual(
      expect.objectContaining({ route: 'UNMATCHED', statusCode: 404 }),
    );
    expect(JSON.stringify(completions)).not.toContain('unmatched-sensitive-path');
    expect(JSON.stringify(completions)).not.toContain('query-secret');
  });

  it('never copies sensitive request material into operational records', async () => {
    await request(serverOf(app))
      .post('/operational-test/sensitive?token=query-secret')
      .set('Authorization', 'Bearer access-token-secret')
      .set('Cookie', 'session=cookie-secret')
      .set('X-Correlation-ID', 'raw-correlation-secret')
      .send({ password: 'body-secret', clientSecret: 'oauth-secret' })
      .expect(204);
    await nextTurn();

    const serialized = JSON.stringify([
      ...recordsOf(logSpy),
      ...recordsOf(warnSpy),
      ...recordsOf(errorSpy),
      ...recordsOf(debugSpy),
    ]);
    for (const secret of [
      'query-secret',
      'access-token-secret',
      'cookie-secret',
      'raw-correlation-secret',
      'body-secret',
      'oauth-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('drops non-allowlisted keys even when runtime input bypasses TypeScript', () => {
    const nestLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const isolatedLogger = new OperationalLogger(new RequestContextService());
    const record = Object.assign(
      { event: 'ALLOWLIST_TEST' },
      { authorization: 'Bearer allowlist-secret', body: { password: 'body-secret' } },
    ) as OperationalLogRecord;

    try {
      isolatedLogger.log(record);
      expect(nestLog).toHaveBeenCalledWith({ event: 'ALLOWLIST_TEST' });
      expect(JSON.stringify(nestLog.mock.calls)).not.toContain('allowlist-secret');
      expect(JSON.stringify(nestLog.mock.calls)).not.toContain('body-secret');
    } finally {
      nestLog.mockRestore();
    }
  });

  it('emits one distinct aborted event and never duplicates it on a later finish', () => {
    const middleware = module.get(RequestContextMiddleware);
    const response = new TestResponse();

    middleware.use({ headers: {}, method: 'GET' }, response, () => undefined);
    response.emit('close');
    response.writableEnded = true;
    response.emit('finish');

    const aborted = recordsOf(warnSpy).filter((record) => record.event === 'http.request.aborted');
    const completed = recordsOf(logSpy).filter(
      (record) => record.event === 'http.request.completed',
    );
    expect(aborted).toHaveLength(1);
    expect(completed).toHaveLength(0);
  });
});

class TestResponse extends EventEmitter {
  statusCode = 200;
  writableEnded = false;

  setHeader(): void {}

  override once(event: 'finish' | 'close', listener: () => void): this {
    return super.once(event, listener);
  }
}

function recordsOf(spy: OperationalLogSpy): OperationalLogRecord[] {
  return spy.mock.calls.map(([record]) => record);
}

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
