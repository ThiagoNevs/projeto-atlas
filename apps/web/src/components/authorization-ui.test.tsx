import assert from 'node:assert/strict';
import test from 'node:test';

import { ATLAS_PERMISSIONS, type AtlasPermission } from '@atlas/shared';
import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { createJsdomTestEnvironment } from '../test/jsdom-test-environment.ts';
import { AuthContext, type AuthContextValue } from './auth-provider.tsx';
import { AuthorizedNavigation } from './authorized-navigation.tsx';
import { PermissionBoundary } from './permission-boundary.tsx';

const viewer = [
  ATLAS_PERMISSIONS.access,
  ATLAS_PERMISSIONS.inventoryRead,
  ATLAS_PERMISSIONS.analysisRead,
  ATLAS_PERMISSIONS.conflictRead,
  ATLAS_PERMISSIONS.reviewCaseRead,
  ATLAS_PERMISSIONS.discoveryRead,
] as const;

const analyst = [
  ...viewer,
  ATLAS_PERMISSIONS.inventoryMaintain,
  ATLAS_PERMISSIONS.inventoryExport,
  ATLAS_PERMISSIONS.conflictManage,
  ATLAS_PERMISSIONS.reviewCaseManage,
  ATLAS_PERMISSIONS.discoveryExecute,
  ATLAS_PERMISSIONS.auditRead,
] as const;

const admin = [
  ...analyst,
  ATLAS_PERMISSIONS.inventoryStatusUpdate,
  ATLAS_PERMISSIONS.inventoryImport,
  ATLAS_PERMISSIONS.discoveryConfigure,
  ATLAS_PERMISSIONS.ingestionExecute,
] as const;

function context(permissions: readonly AtlasPermission[]): AuthContextValue {
  return {
    status: 'authenticated',
    actor: { id: 'human:oidc:test:actor', kind: 'HUMAN', permissions: [...permissions] },
    error: null,
    login: async () => undefined,
    logout: async () => undefined,
  };
}

async function render(node: ReactNode, permissions: readonly AtlasPermission[]) {
  const environment = createJsdomTestEnvironment();
  const root = createRoot(environment.container);
  await act(async () => {
    root.render(createElement(AuthContext.Provider, { value: context(permissions) }, node));
    await Promise.resolve();
  });
  return {
    container: environment.container,
    close: async () => {
      await act(async () => root.unmount());
      environment.cleanup();
    },
  };
}

test('Viewer sees read navigation while privileged areas remain hidden', async () => {
  const harness = await render(createElement(AuthorizedNavigation), viewer);
  try {
    const text = harness.container.textContent ?? '';
    for (const label of [
      'Dashboard',
      'Ativos',
      'Conflitos',
      'Achados de identidade e rede',
      'Casos de revisão',
      'Descoberta de rede',
    ]) {
      assert.match(text, new RegExp(label));
    }
    assert.doesNotMatch(text, /Auditoria/);
  } finally {
    await harness.close();
  }
});

test('Analyst sees audit navigation and Admin keeps the same readable navigation', async () => {
  for (const permissions of [analyst, admin]) {
    const harness = await render(createElement(AuthorizedNavigation), permissions);
    try {
      assert.match(harness.container.textContent ?? '', /Auditoria/);
    } finally {
      await harness.close();
    }
  }
});

test('a denied deep link renders access denied and never mounts protected page work', async () => {
  let requests = 0;
  function ProtectedPage() {
    useEffect(() => {
      requests += 1;
    }, []);
    return createElement('button', null, 'Executar mutação');
  }
  const harness = await render(
    createElement(
      PermissionBoundary,
      { permission: ATLAS_PERMISSIONS.inventoryImport },
      createElement(ProtectedPage),
    ),
    viewer,
  );
  try {
    assert.match(harness.container.textContent ?? '', /Acesso negado/);
    assert.equal(harness.container.querySelector('button'), null);
    assert.equal(requests, 0);
  } finally {
    await harness.close();
  }
});

test('action boundaries hide Viewer mutations and expose only authorized Analyst/Admin actions', async () => {
  const actions = createElement(
    'div',
    null,
    createElement(
      PermissionBoundary,
      { permission: ATLAS_PERMISSIONS.reviewCaseManage, fallback: null },
      createElement('button', null, 'Operar caso'),
    ),
    createElement(
      PermissionBoundary,
      { permission: ATLAS_PERMISSIONS.inventoryStatusUpdate, fallback: null },
      createElement('button', null, 'Alterar status administrativo'),
    ),
  );
  const viewerHarness = await render(actions, viewer);
  try {
    assert.equal(viewerHarness.container.querySelectorAll('button').length, 0);
  } finally {
    await viewerHarness.close();
  }
  const analystHarness = await render(actions, analyst);
  try {
    assert.match(analystHarness.container.textContent ?? '', /Operar caso/);
    assert.doesNotMatch(analystHarness.container.textContent ?? '', /status administrativo/);
  } finally {
    await analystHarness.close();
  }
  const adminHarness = await render(actions, admin);
  try {
    assert.match(adminHarness.container.textContent ?? '', /Operar caso/);
    assert.match(adminHarness.container.textContent ?? '', /status administrativo/);
  } finally {
    await adminHarness.close();
  }
});
