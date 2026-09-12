import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { createFindingReviewFixture } from './finding-review-fixture';

const apiUrl = 'http://127.0.0.1:3101';

async function login(page: Page, username: string) {
  let authorization = '';
  const authMeResponse = page.waitForResponse((candidate) => {
    if (candidate.url() !== `${apiUrl}/auth/me`) return false;
    authorization = candidate.request().headers().authorization ?? '';
    return true;
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entre para acessar o Atlas' })).toBeVisible();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.locator('input[name="login"]').fill(username);
  await page.locator('input[name="password"]').fill('test-only-password');
  await page.getByRole('button', { name: 'Sign-in' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const response = await authMeResponse;
  if (!response.ok()) {
    throw new Error(
      `OIDC login reached /auth/me but was rejected: HTTP ${response.status()} ${await response.text()}`,
    );
  }
  const actor = (await response.json()) as { permissions?: unknown };
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  return { authorization, actor };
}

test('creates, reviews, decides and resolves a finding review case', async ({ page, request }) => {
  const { authorization, actor } = await login(page, 'atlas-browser-user');
  const tokenPayload = authorization.replace(/^Bearer /, '').split('.')[1];
  const claims = tokenPayload
    ? (JSON.parse(Buffer.from(tokenPayload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >)
    : null;
  await expect(page.getByText('Atlas Browser User')).toBeVisible();
  expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
  expect(claims).toMatchObject({
    aud: apiUrl,
    client_id: 'atlas-web',
    groups: ['atlas-user', 'atlas-admin'],
    sub: 'atlas-browser-user',
  });
  expect(actor.permissions).toContain('ingestion:execute');
  const browserStorage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(browserStorage.local).toEqual([]);
  expect(browserStorage.session.some((key) => /token/i.test(key))).toBe(false);
  expect(browserStorage.session.some((key) => key.startsWith('atlas:oidc:transaction:'))).toBe(
    false,
  );

  const fixture = await createFindingReviewFixture(request, apiUrl, authorization);
  const decisionJustification = `Decisão browser E2E ${fixture.runId}`;
  const resolutionJustification = `Resolução browser E2E ${fixture.runId}`;
  const reopenJustification = `Reabertura browser E2E ${fixture.runId}`;

  await page.getByRole('link', { name: 'Achados de identidade e rede' }).click();
  await page.getByRole('textbox', { name: 'Hostname', exact: true }).fill(fixture.hostname);
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();

  const findingCard = page.getByRole('article').filter({ hasText: fixture.hostname });
  await expect(findingCard).toContainText(fixture.findingId);
  await findingCard.getByRole('link', { name: 'Criar caso de revisão' }).click();

  await page.getByRole('button', { name: 'Criar caso', exact: true }).click();
  const detail = page.getByLabel('Detalhe do caso');
  await expect(detail.getByText('Aberto', { exact: true }).first()).toBeVisible();

  await detail.getByLabel('Novo estado').selectOption('IN_REVIEW');
  await detail.getByRole('button', { name: 'Confirmar alteração' }).click();
  await expect(detail.getByText('Em análise', { exact: true }).first()).toBeVisible();

  await detail.getByRole('radio', { name: /Mesmo ativo/ }).check();
  await detail.getByLabel('Justificativa', { exact: true }).fill(decisionJustification);
  await detail.getByRole('button', { name: 'Revisar decisão' }).click();
  await detail.getByRole('button', { name: 'Registrar decisão' }).click();
  const decisionSection = detail.getByLabel('Decisão de identidade');
  await decisionSection.getByText('Histórico de decisões (1)', { exact: true }).click();
  await expect(decisionSection.getByText('Atual', { exact: true })).toBeVisible();

  await detail.getByLabel('Justificativa da resolução').fill(resolutionJustification);
  await detail.getByRole('button', { name: 'Revisar resolução' }).click();
  await detail.getByRole('button', { name: 'Resolver caso' }).click();
  await expect(detail.getByText('Resolvido', { exact: true }).first()).toBeVisible();
  await expect(
    decisionSection.getByText(decisionJustification, { exact: true }).first(),
  ).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Corrigir decisão' })).toHaveCount(0);
  await detail.getByLabel('Justificativa da reabertura').fill(reopenJustification);
  await detail.getByRole('button', { name: 'Revisar reabertura' }).click();
  await expect(detail.getByRole('button', { name: 'Reabrir investigação' })).toBeVisible();

  await expect(
    detail.getByRole('listitem').filter({ hasText: 'Decisão de identidade registrada' }),
  ).toBeVisible();
  await expect(
    detail.getByRole('listitem').filter({ hasText: 'Investigação concluída' }),
  ).toBeVisible();
});

test('enforces Viewer and Analyst permissions across UI and direct API calls', async ({
  browser,
  request,
}) => {
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  const viewer = await login(viewerPage, 'atlas-viewer-user');
  expect(viewer.actor.permissions).toContain('inventory:read');
  expect(viewer.actor.permissions).not.toContain('inventory:maintain');
  await viewerPage.getByRole('link', { name: 'Ativos', exact: true }).click();
  await expect(viewerPage.getByRole('heading', { name: 'Ativos', exact: true })).toBeVisible();
  await expect(viewerPage.getByRole('link', { name: 'Adicionar ativo' })).toHaveCount(0);
  await expect(viewerPage.getByRole('link', { name: 'Auditoria' })).toHaveCount(0);
  const denied = await request.post(`${apiUrl}/assets/manual`, {
    headers: { Authorization: viewer.authorization },
    data: {},
  });
  expect(denied.status()).toBe(403);
  await viewerPage.getByRole('button', { name: 'Sair' }).click();
  await viewerContext.close();

  const analystContext = await browser.newContext();
  const analystPage = await analystContext.newPage();
  const analyst = await login(analystPage, 'atlas-analyst-user');
  expect(analyst.actor.permissions).toContain('review-case:manage');
  expect(analyst.actor.permissions).not.toContain('inventory:status:update');
  await analystPage.getByRole('link', { name: 'Ativos', exact: true }).click();
  await expect(analystPage.getByRole('link', { name: 'Adicionar ativo' })).toBeVisible();
  await expect(analystPage.getByRole('link', { name: 'Importar ativos' })).toHaveCount(0);
  await analystPage.getByRole('link', { name: 'Adicionar ativo' }).click();
  const identifier = `analyst-${randomUUID()}`;
  await analystPage.getByLabel('Identificador principal').fill(identifier);
  await analystPage
    .getByLabel('Motivo do cadastro')
    .fill('Validação browser E2E de autorização granular');
  await analystPage.getByRole('button', { name: 'Declarar ativo' }).click();
  await expect(
    analystPage.getByText('Ativo declarado com sucesso. Abrindo o detalhe…'),
  ).toBeVisible();
  await analystPage.waitForURL(/\/assets\/[0-9a-f-]{36}$/);
  await expect(analystPage.getByRole('heading', { name: 'Identificação' })).toBeVisible();
  await expect(
    analystPage.getByRole('heading', { name: 'Alterar status administrativo' }),
  ).toHaveCount(0);
  await expect(analystPage.getByRole('link', { name: 'Casos de revisão' })).toBeVisible();
  await analystContext.close();
});
