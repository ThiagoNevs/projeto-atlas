'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

import { API_URL } from '../lib/api';
import {
  parseAuthenticatedActor,
  safeReturnTo,
  type AuthStatus,
  type AuthenticatedActor,
} from '../lib/auth';
import {
  clearAuthenticatedTransport,
  configureAuthenticatedTransport,
} from '../lib/auth-transport';
import { clearFindingReviewPendingAttempts } from '../lib/pending-auth-cleanup';

export interface AuthContextValue {
  status: AuthStatus;
  actor: AuthenticatedActor | null;
  error: string | null;
  login(): Promise<void>;
  logout(): Promise<void>;
}

export interface PublicAuthConfig {
  authority: string;
  clientId: string;
  audience: string;
  scope: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthOidcClient {
  readonly settings: { redirect_uri: string };
  getUser(): Promise<User | null>;
  signinRedirect(args: { state: { returnTo: string } }): Promise<void>;
  signinRedirectCallback(): Promise<User>;
  removeUser(): Promise<void>;
  signoutRedirect(): Promise<void>;
}

export type AuthOidcClientFactory = (config: PublicAuthConfig) => AuthOidcClient;

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} é obrigatório.`);
  return normalized;
}

export function readPublicAuthConfig(): PublicAuthConfig {
  const config = {
    authority: required('NEXT_PUBLIC_AUTH_ISSUER', process.env.NEXT_PUBLIC_AUTH_ISSUER),
    clientId: required('NEXT_PUBLIC_AUTH_CLIENT_ID', process.env.NEXT_PUBLIC_AUTH_CLIENT_ID),
    audience: required('NEXT_PUBLIC_AUTH_AUDIENCE', process.env.NEXT_PUBLIC_AUTH_AUDIENCE),
    scope: required('NEXT_PUBLIC_AUTH_SCOPE', process.env.NEXT_PUBLIC_AUTH_SCOPE),
    redirectUri: required(
      'NEXT_PUBLIC_AUTH_REDIRECT_URI',
      process.env.NEXT_PUBLIC_AUTH_REDIRECT_URI,
    ),
    postLogoutRedirectUri: required(
      'NEXT_PUBLIC_AUTH_POST_LOGOUT_REDIRECT_URI',
      process.env.NEXT_PUBLIC_AUTH_POST_LOGOUT_REDIRECT_URI,
    ),
  };
  if (config.scope.split(/\s+/).includes('offline_access')) {
    throw new Error('NEXT_PUBLIC_AUTH_SCOPE não pode solicitar offline_access.');
  }
  for (const [name, value] of [
    ['NEXT_PUBLIC_AUTH_ISSUER', config.authority],
    ['NEXT_PUBLIC_AUTH_REDIRECT_URI', config.redirectUri],
    ['NEXT_PUBLIC_AUTH_POST_LOGOUT_REDIRECT_URI', config.postLogoutRedirectUri],
  ] as const) {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error(`${name} deve usar HTTPS fora do ambiente local.`);
    }
  }
  return config;
}

function createUserManager(config: PublicAuthConfig): UserManager {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.postLogoutRedirectUri,
    response_type: 'code',
    scope: config.scope,
    resource: config.audience,
    extraTokenParams: { resource: config.audience },
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    stateStore: new WebStorageStateStore({
      prefix: 'atlas:oidc:transaction:',
      store: window.sessionStorage,
    }),
    userStore: new WebStorageStateStore({
      prefix: 'atlas:oidc:memory:',
      store: new InMemoryWebStorage(),
    }),
  });
}

function clearOidcTransactionState(): void {
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) =>
      window.sessionStorage.key(index),
    ).filter((key): key is string => key?.startsWith('atlas:oidc:transaction:') ?? false);
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // The OIDC callback will still fail closed if transient storage is unavailable.
  }
}

async function loadActor(user: User): Promise<AuthenticatedActor> {
  const response = await fetch(`${API_URL}/auth/me`, {
    cache: 'no-store',
    headers: { Accept: 'application/json', Authorization: `Bearer ${user.access_token}` },
  });
  if (!response.ok)
    throw new Error(
      response.status === 403 ? 'Acesso negado.' : 'Não foi possível validar a sessão.',
    );
  const actor = parseAuthenticatedActor(await response.json());
  if (!actor) throw new Error('A API retornou uma identidade inválida.');
  return actor;
}

export function AuthProvider({
  children,
  clientFactory = createUserManager,
}: {
  children: ReactNode;
  clientFactory?: AuthOidcClientFactory;
}) {
  const managerRef = useRef<AuthOidcClient | null>(null);
  const loginFlight = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<AuthStatus>('unknown');
  const [actor, setActor] = useState<AuthenticatedActor | null>(null);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (): Promise<void> => {
    const manager = managerRef.current;
    if (!manager) return;
    if (!loginFlight.current) {
      const returnTo = safeReturnTo(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      loginFlight.current = manager.signinRedirect({ state: { returnTo } }).finally(() => {
        loginFlight.current = null;
      });
    }
    try {
      await loginFlight.current;
    } catch {
      clearAuthenticatedTransport();
      setActor(null);
      setError('Não foi possível iniciar a autenticação. Tente novamente.');
      setStatus('error');
    }
  }, []);

  const invalidateAndLogin = useCallback(async (): Promise<void> => {
    clearAuthenticatedTransport();
    setActor(null);
    setStatus('unauthenticated');
    await managerRef.current?.removeUser();
    await login();
  }, [login]);

  const establish = useCallback(
    async (user: User): Promise<void> => {
      if (!user.access_token || user.expired)
        throw new Error('A credencial de acesso é inválida ou expirou.');
      const loadedActor = await loadActor(user);
      configureAuthenticatedTransport(user.access_token, invalidateAndLogin);
      setActor(loadedActor);
      setStatus('authenticated');
      setError(null);
    },
    [invalidateAndLogin],
  );

  useEffect(() => {
    let active = true;
    let manager: AuthOidcClient;
    try {
      manager = clientFactory(readPublicAuthConfig());
      managerRef.current = manager;
    } catch (configurationError) {
      const message =
        configurationError instanceof Error
          ? configurationError.message
          : 'Configuração de autenticação inválida.';
      void Promise.resolve().then(() => {
        if (!active) return;
        setError(message);
        setStatus('error');
      });
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        const callbackParameters = new URLSearchParams(window.location.search);
        const isCallback =
          window.location.pathname === new URL(manager.settings.redirect_uri).pathname &&
          (callbackParameters.has('code') || callbackParameters.has('error'));
        if (isCallback) {
          try {
            const user = await manager.signinRedirectCallback();
            if (!active) return;
            await establish(user);
            if (!active) return;
            const state = user.state as { returnTo?: unknown } | undefined;
            window.history.replaceState(null, '', safeReturnTo(state?.returnTo));
            return;
          } finally {
            clearOidcTransactionState();
          }
        }
        const user = await manager.getUser();
        if (!active) return;
        if (user && !user.expired) await establish(user);
        else setStatus('unauthenticated');
      } catch (bootstrapError) {
        clearAuthenticatedTransport();
        if (!active) return;
        setActor(null);
        setError(bootstrapError instanceof Error ? bootstrapError.message : 'Falha ao autenticar.');
        setStatus('error');
      }
    })();

    return () => {
      active = false;
      clearAuthenticatedTransport();
      managerRef.current = null;
    };
  }, [clientFactory, establish]);

  const logout = useCallback(async (): Promise<void> => {
    const manager = managerRef.current;
    clearAuthenticatedTransport();
    clearFindingReviewPendingAttempts();
    clearOidcTransactionState();
    setActor(null);
    setStatus('unauthenticated');
    if (!manager) return;
    await manager.removeUser();
    try {
      await manager.signoutRedirect();
    } catch {
      window.location.assign('/');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, actor, error, login, logout }),
    [status, actor, error, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return value;
}
