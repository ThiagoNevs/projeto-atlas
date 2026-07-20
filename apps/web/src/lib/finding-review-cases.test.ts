import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFindingReviewIdempotencyKey,
  getFindingReviewCaseStatusLabel,
  getFindingReviewEventLabel,
  getFindingReviewStalenessLabel,
  serializeFindingReviewCaseQuery,
} from './finding-review-cases.ts';

test('traduz status, atualidade e eventos sem exibir enums técnicos', () => {
  assert.equal(getFindingReviewCaseStatusLabel('IN_REVIEW'), 'Em análise');
  assert.equal(getFindingReviewStalenessLabel('NO_LONGER_DETECTED'), 'Não detectado atualmente');
  assert.equal(getFindingReviewEventLabel('CASE_CREATED'), 'Caso criado');
});

test('serializa filtros e paginação com os nomes do contrato da API', () => {
  const query = serializeFindingReviewCaseQuery({
    status: 'OPEN',
    staleness: 'CURRENT',
    findingId: 'finding_0123456789abcdef01234567',
    page: 2,
    pageSize: 10,
    sortBy: 'updatedAt',
    sortDirection: 'asc',
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get('status'), 'OPEN');
  assert.equal(params.get('staleness'), 'CURRENT');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('sortBy'), 'updatedAt');
});

test('gera chave idempotente ASCII e preserva o UUID opaco', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const key = createFindingReviewIdempotencyKey(() => uuid);
  assert.equal(key, `atlas-ui-${uuid}`);
  assert.match(key, /^[A-Za-z0-9._~:+/=-]{1,128}$/);
});
