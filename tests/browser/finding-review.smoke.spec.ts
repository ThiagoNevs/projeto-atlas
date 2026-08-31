import { expect, test } from '@playwright/test';

import { createFindingReviewFixture } from './finding-review-fixture';

const apiUrl = 'http://127.0.0.1:3101';

test('creates, reviews, decides and resolves a finding review case', async ({ page, request }) => {
  const fixture = await createFindingReviewFixture(request, apiUrl);
  const decisionJustification = `Decisão browser E2E ${fixture.runId}`;
  const resolutionJustification = `Resolução browser E2E ${fixture.runId}`;
  const reopenJustification = `Reabertura browser E2E ${fixture.runId}`;

  await page.goto(
    `/conflict-findings?type=DUPLICATE_HOSTNAME_ACROSS_ASSETS&hostname=${encodeURIComponent(fixture.hostname)}`,
  );

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
