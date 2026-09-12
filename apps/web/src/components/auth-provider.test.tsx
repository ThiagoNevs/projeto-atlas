import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';

import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { User } from 'oidc-client-ts';

import { createJsdomTestEnvironment } from '../test/jsdom-test-environment.ts';
import { authenticatedFetch } from '../lib/auth-transport.ts';

const environment = createJsdomTestEnvironment();
environment.container.remove();

process.env.NEXT_PUBLIC_AUTH_ISSUER = 'http://127.0.0.1:3199';
process.env.NEXT_PUBLIC_AUTH_CLIENT_ID = 'atlas-web';
process.env.NEXT_PUBLIC_AUTH_AUDIENCE = 'atlas-api';
process.env.NEXT_PUBLIC_AUTH_SCOPE = 'openid profile';
process.env.NEXT_PUBLIC_AUTH_REDIRECT_URI = 'http://localhost/auth/callback';
process.env.NEXT_PUBLIC_AUTH_POST_LOGOUT_REDIRECT_URI = 'http://localhost/';

const { act, createElement, useEffect } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AuthProvider, useAuth } = await import('./auth-provider.tsx');
type AuthContextValue = import('./auth-provider.tsx').AuthContextValue;
type AuthOidcClient = import('./auth-provider.tsx').AuthOidcClient;

const actor = {
  id: 'human:oidc:v1:test-actor',
  kind: 'HUMAN' as const,
  displayName: 'Pessoa Atlas',
  permissions: ['atlas:access'],
};

function user(overrides: Partial<User> = {}): User {
  return {
    access_token: 'browser-access-token',
    expired: false,
    state: { returnTo: '/conflict-review-cases?caseId=1' },
    ...overrides,
  } as User;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function authorizationFromTransport(): Promise<string | null> {
  let authorization: string | null = null;
  await authenticatedFetch('http://api.test/probe', {}, async (_url, init) => {
    authorization = new Headers(init.headers).get('Authorization');
    return new Response(null, { status: 204 });
  });
  return authorization;
}

let current: AuthContextValue | null = null;

function Probe({ children }: { children?: ReactNode }) {
  const value = useAuth();
  useEffect(() => {
    current = value;
  }, [value]);
  return createElement('div', { 'data-status': value.status }, children);
}

async function render(client: AuthOidcClient): Promise<Root> {
  const root = createRoot(environment.container);
  await act(async () => {
    root.render(
      createElement(AuthProvider, { clientFactory: () => client, children: createElement(Probe) }),
    );
    await flush();
  });
  return root;
}

function client(overrides: Partial<AuthOidcClient> = {}): AuthOidcClient {
  return {
    settings: { redirect_uri: 'http://localhost/auth/callback' },
    getUser: async () => null,
    signinRedirect: async () => undefined,
    signinRedirectCallback: async () => user(),
    removeUser: async () => undefined,
    signoutRedirect: async () => undefined,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

afterEach(async () => {
  environment.window.history.replaceState(null, '', '/');
  environment.window.localStorage.clear();
  environment.window.sessionStorage.clear();
  environment.container.replaceChildren();
  current = null;
  globalThis.fetch = originalFetch;
});

after(() => environment.cleanup());

test('starts unknown and becomes unauthenticated only after bootstrap completes', async () => {
  const pending = deferred<User | null>();
  const root = await render(client({ getUser: () => pending.promise }));
  try {
    assert.equal(current?.status, 'unknown');
    await act(async () => {
      pending.resolve(null);
      await flush();
    });
    assert.equal(current?.status, 'unauthenticated');
  } finally {
    await act(async () => root.unmount());
  }
});

test('establishes an authenticated session from /auth/me without persisting the token', async () => {
  globalThis.fetch = async () => Response.json(actor);
  const root = await render(client({ getUser: async () => user() }));
  try {
    assert.equal(current?.status, 'authenticated');
    assert.deepEqual(current?.actor, actor);
    assert.equal(await authorizationFromTransport(), 'Bearer browser-access-token');
    assert.deepEqual(Object.keys(environment.window.localStorage), []);
    assert.deepEqual(Object.keys(environment.window.sessionStorage), []);
  } finally {
    await act(async () => root.unmount());
  }
});

test('processes callback, removes transient state and rejects an absolute returnTo', async () => {
  environment.window.history.replaceState(null, '', '/auth/callback?code=code&state=state');
  environment.window.sessionStorage.setItem('atlas:oidc:transaction:state', 'transient');
  globalThis.fetch = async () => Response.json(actor);
  const root = await render(
    client({
      signinRedirectCallback: async () =>
        user({ state: { returnTo: 'https://evil.example/steal' } }),
    }),
  );
  try {
    assert.equal(current?.status, 'authenticated');
    assert.equal(environment.window.location.pathname, '/');
    assert.equal(environment.window.sessionStorage.getItem('atlas:oidc:transaction:state'), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test('fails closed on callback or /auth/me errors and cleans transaction state', async () => {
  environment.window.history.replaceState(null, '', '/auth/callback?code=code&state=state');
  environment.window.sessionStorage.setItem('atlas:oidc:transaction:state', 'transient');
  const root = await render(
    client({ signinRedirectCallback: async () => Promise.reject(new Error('state inválido')) }),
  );
  try {
    assert.equal(current?.status, 'error');
    assert.equal(current?.actor, null);
    assert.match(current?.error ?? '', /state inválido/);
    assert.equal(environment.window.sessionStorage.getItem('atlas:oidc:transaction:state'), null);
    assert.equal(await authorizationFromTransport(), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test('processes an OIDC error callback and removes its transient transaction state', async () => {
  environment.window.history.replaceState(
    null,
    '',
    '/auth/callback?error=access_denied&state=state',
  );
  environment.window.sessionStorage.setItem('atlas:oidc:transaction:state', 'transient');
  let callbackCalls = 0;
  const root = await render(
    client({
      signinRedirectCallback: async () => {
        callbackCalls += 1;
        throw new Error('acesso recusado pelo provedor');
      },
    }),
  );
  try {
    assert.equal(callbackCalls, 1);
    assert.equal(current?.status, 'error');
    assert.equal(current?.actor, null);
    assert.equal(environment.window.sessionStorage.getItem('atlas:oidc:transaction:state'), null);
    assert.equal(await authorizationFromTransport(), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test('login is single-flight and carries only the validated current relative URL', async () => {
  const pending = deferred<void>();
  const states: Array<{ state: { returnTo: string } }> = [];
  environment.window.history.replaceState(null, '', '/audit?page=2#events');
  const root = await render(
    client({
      signinRedirect: async (args) => {
        states.push(args);
        await pending.promise;
      },
    }),
  );
  try {
    const first = current?.login();
    const second = current?.login();
    await flush();
    assert.equal(states.length, 1);
    assert.equal(states[0]?.state.returnTo, '/audit?page=2#events');
    pending.resolve();
    await Promise.all([first, second]);
  } finally {
    await act(async () => root.unmount());
  }
});

test('login failure is controlled, fail-closed and allows another attempt', async () => {
  let calls = 0;
  const root = await render(
    client({
      signinRedirect: async () => {
        calls += 1;
        if (calls === 1) throw new Error('internal provider details');
      },
    }),
  );
  try {
    await act(async () => {
      await current?.login();
      await flush();
    });
    assert.equal(current?.status, 'error');
    assert.equal(current?.actor, null);
    assert.equal(current?.error, 'Não foi possível iniciar a autenticação. Tente novamente.');
    assert.doesNotMatch(current?.error ?? '', /internal provider details/);
    assert.equal(await authorizationFromTransport(), null);

    await act(async () => {
      await current?.login();
      await flush();
    });
    assert.equal(calls, 2);
  } finally {
    await act(async () => root.unmount());
  }
});

test('logout clears token and Finding Review pending envelopes before standard OIDC logout', async () => {
  let removed = 0;
  let signedOut = 0;
  globalThis.fetch = async () => Response.json(actor);
  const root = await render(
    client({
      getUser: async () => user(),
      removeUser: async () => {
        removed += 1;
      },
      signoutRedirect: async () => {
        signedOut += 1;
      },
    }),
  );
  try {
    environment.window.sessionStorage.setItem('atlas:pending-review-case:finding', '{}');
    environment.window.sessionStorage.setItem('unrelated', 'preserve');
    await act(async () => {
      await current?.logout();
      await flush();
    });
    assert.equal(current?.status, 'unauthenticated');
    assert.equal(current?.actor, null);
    assert.equal(await authorizationFromTransport(), null);
    assert.equal(
      environment.window.sessionStorage.getItem('atlas:pending-review-case:finding'),
      null,
    );
    assert.equal(environment.window.sessionStorage.getItem('unrelated'), 'preserve');
    assert.deepEqual([removed, signedOut], [1, 1]);
  } finally {
    await act(async () => root.unmount());
  }
});

test('/auth/me 403 is localized as access denied without starting another login', async () => {
  let loginCalls = 0;
  globalThis.fetch = async () => new Response(null, { status: 403 });
  const root = await render(
    client({
      getUser: async () => user(),
      signinRedirect: async () => {
        loginCalls += 1;
      },
    }),
  );
  try {
    assert.equal(current?.status, 'error');
    assert.equal(current?.error, 'Acesso negado.');
    assert.equal(loginCalls, 0);
  } finally {
    await act(async () => root.unmount());
  }
});
