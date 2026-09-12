import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  authenticatedFetch,
  clearAuthenticatedTransport,
  configureAuthenticatedTransport,
} from './auth-transport.ts';
import { parseAuthenticatedActor, safeReturnTo } from './auth.ts';

afterEach(() => clearAuthenticatedTransport());

test('parses only the safe /auth/me projection with atlas access', () => {
  assert.deepEqual(
    parseAuthenticatedActor({
      id: 'human:oidc:v1:actor',
      kind: 'HUMAN',
      displayName: 'Pessoa Atlas',
      permissions: ['atlas:access'],
    }),
    {
      id: 'human:oidc:v1:actor',
      kind: 'HUMAN',
      displayName: 'Pessoa Atlas',
      permissions: ['atlas:access'],
    },
  );
  assert.equal(
    parseAuthenticatedActor({
      id: 'human:oidc:v1:actor',
      kind: 'HUMAN',
      permissions: [],
    }),
    null,
  );
  assert.equal(
    parseAuthenticatedActor({
      id: 'human:oidc:v1:actor',
      kind: 'HUMAN',
      permissions: ['atlas:access'],
      token: 'must-not-pass',
    }),
    null,
  );
});

test('allows only internal relative returnTo values', () => {
  assert.equal(
    safeReturnTo('/conflict-review-cases?caseId=1#detail'),
    '/conflict-review-cases?caseId=1#detail',
  );
  assert.equal(safeReturnTo('https://evil.example/steal'), '/');
  assert.equal(safeReturnTo('//evil.example/steal'), '/');
  assert.equal(safeReturnTo('javascript:alert(1)'), '/');
  assert.equal(safeReturnTo(undefined, '/safe'), '/safe');
});

test('attaches the in-memory access token without persisting it', async () => {
  const localStorage = new Map<string, string>();
  const sessionStorage = new Map<string, string>();
  configureAuthenticatedTransport('access-token-value', async () => undefined);
  let received: RequestInit | undefined;
  await authenticatedFetch(
    'http://api.test/assets',
    { headers: { Accept: 'application/json' } },
    async (_url, init) => {
      received = init;
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(new Headers(received?.headers).get('Authorization'), 'Bearer access-token-value');
  assert.equal(localStorage.size, 0);
  assert.equal(sessionStorage.size, 0);
  clearAuthenticatedTransport();
  let clearedRequest: RequestInit | undefined;
  await authenticatedFetch('http://api.test/assets', {}, async (_url, init) => {
    clearedRequest = init;
    return new Response(null, { status: 200 });
  });
  assert.equal(new Headers(clearedRequest?.headers).get('Authorization'), null);
});

test('coalesces concurrent 401 responses into one reauthentication', async () => {
  let reauthCalls = 0;
  let release!: () => void;
  const reauth = new Promise<void>((resolve) => {
    release = resolve;
  });
  configureAuthenticatedTransport('expired-token', async () => {
    reauthCalls += 1;
    await reauth;
  });
  const fetch401 = async () => new Response(null, { status: 401 });
  const first = authenticatedFetch('http://api.test/assets', {}, fetch401);
  const second = authenticatedFetch('http://api.test/audit', {}, fetch401);
  await Promise.resolve();
  assert.equal(reauthCalls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(reauthCalls, 1);
});

test('does not reauthenticate on 403 and keeps the token in memory', async () => {
  let reauthCalls = 0;
  let received: RequestInit | undefined;
  configureAuthenticatedTransport('valid-but-forbidden', async () => {
    reauthCalls += 1;
  });
  const response = await authenticatedFetch('http://api.test/audit', {}, async (_url, init) => {
    received = init;
    return new Response(null, { status: 403 });
  });
  assert.equal(response.status, 403);
  assert.equal(reauthCalls, 0);
  assert.equal(new Headers(received?.headers).get('Authorization'), 'Bearer valid-but-forbidden');
});
