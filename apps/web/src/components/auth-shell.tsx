'use client';

import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from './auth-provider';

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'unknown') {
    return (
      <main className="auth-shell" aria-live="polite">
        <p>Validando sessão…</p>
      </main>
    );
  }
  if (auth.status === 'unauthenticated') {
    return (
      <main className="auth-shell">
        <p className="eyebrow">Acesso protegido</p>
        <h1>Entre para acessar o Atlas</h1>
        <p>Use sua identidade corporativa para continuar.</p>
        <button type="button" onClick={() => void auth.login()}>
          Entrar
        </button>
      </main>
    );
  }
  if (auth.status === 'error') {
    return (
      <main className="auth-shell" role="alert">
        <p className="eyebrow">Autenticação indisponível</p>
        <h1>Não foi possível iniciar sua sessão</h1>
        <p>{auth.error}</p>
        <button type="button" onClick={() => void auth.login()}>
          Tentar novamente
        </button>
      </main>
    );
  }
  return <>{children}</>;
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}

export function AuthenticatedUserMenu() {
  const auth = useAuth();
  if (auth.status !== 'authenticated' || !auth.actor) return null;
  return (
    <div className="auth-user">
      <span>{auth.actor.displayName ?? 'Usuário autenticado'}</span>
      <button type="button" onClick={() => void auth.logout()}>
        Sair
      </button>
    </div>
  );
}
