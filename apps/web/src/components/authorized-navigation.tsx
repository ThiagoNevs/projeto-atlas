'use client';

import { ATLAS_PERMISSIONS, type AtlasPermission } from '@atlas/shared';
import Link from 'next/link.js';

import { PermissionBoundary } from './permission-boundary';

const ITEMS: readonly { href: string; label: string; permission: AtlasPermission }[] = [
  { href: '/', label: 'Dashboard', permission: ATLAS_PERMISSIONS.inventoryRead },
  { href: '/assets', label: 'Ativos', permission: ATLAS_PERMISSIONS.inventoryRead },
  { href: '/conflicts', label: 'Conflitos', permission: ATLAS_PERMISSIONS.conflictRead },
  {
    href: '/conflict-findings',
    label: 'Achados de identidade e rede',
    permission: ATLAS_PERMISSIONS.analysisRead,
  },
  {
    href: '/conflict-review-cases',
    label: 'Casos de revisão',
    permission: ATLAS_PERMISSIONS.reviewCaseRead,
  },
  {
    href: '/network-discovery',
    label: 'Descoberta de rede',
    permission: ATLAS_PERMISSIONS.discoveryRead,
  },
  { href: '/audit', label: 'Auditoria', permission: ATLAS_PERMISSIONS.auditRead },
  {
    href: '/data-quality',
    label: 'Qualidade dos dados',
    permission: ATLAS_PERMISSIONS.inventoryRead,
  },
  {
    href: '/data-sources',
    label: 'Fontes de dados',
    permission: ATLAS_PERMISSIONS.inventoryRead,
  },
];

export function AuthorizedNavigation() {
  return (
    <nav aria-label="Navegação principal">
      {ITEMS.map((item) => (
        <PermissionBoundary key={item.href} permission={item.permission} fallback={null}>
          <Link href={item.href}>{item.label}</Link>
        </PermissionBoundary>
      ))}
    </nav>
  );
}
