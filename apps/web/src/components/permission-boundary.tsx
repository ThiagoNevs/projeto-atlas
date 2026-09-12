'use client';

import type { AtlasPermission } from '@atlas/shared';
import type { ReactNode } from 'react';

import { hasPermission } from '../lib/auth';
import { useAuth } from './auth-provider';

export function usePermission(permission: AtlasPermission): boolean {
  const { actor, status } = useAuth();
  return status === 'authenticated' && hasPermission(actor, permission);
}

export function AccessDenied() {
  return (
    <main className="page-shell" role="alert">
      <p className="eyebrow">Acesso protegido</p>
      <h1>Acesso negado</h1>
      <p>Você não possui permissão para acessar esta funcionalidade.</p>
    </main>
  );
}

export function PermissionBoundary({
  permission,
  children,
  fallback = <AccessDenied />,
}: {
  permission: AtlasPermission;
  children?: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>;
}
