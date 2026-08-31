import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

const FINDING_TYPE = 'DUPLICATE_HOSTNAME_ACROSS_ASSETS';

type FindingListItem = {
  findingId?: unknown;
  type?: unknown;
  normalizedHostname?: unknown;
};

type FindingInventoryResponse = {
  items?: unknown;
};

export type FindingReviewFixture = {
  findingId: string;
  hostname: string;
  runId: string;
};

export async function createFindingReviewFixture(
  request: APIRequestContext,
  apiUrl: string,
): Promise<FindingReviewFixture> {
  const runId = randomUUID();
  const hostname = `pw-review-${runId.slice(0, 12)}`;
  const observedAt = new Date().toISOString();

  for (const suffix of ['a', 'b']) {
    const response = await request.post(`${apiUrl}/ingestion/assets`, {
      data: {
        source: 'playwright-browser-e2e',
        sourceAssetId: `${runId}-${suffix}`,
        hostname,
        type: 'SERVER',
        lastSeenAt: observedAt,
      },
    });

    if (!response.ok()) {
      throw new Error(
        `Failed to create browser E2E asset ${suffix}: HTTP ${response.status()} ${await response.text()}`,
      );
    }
  }

  const findingsResponse = await request.get(`${apiUrl}/conflict-analysis/findings`, {
    params: {
      hostname,
      pageSize: '100',
      type: FINDING_TYPE,
    },
  });

  if (!findingsResponse.ok()) {
    throw new Error(
      `Failed to load browser E2E finding for ${hostname}: HTTP ${findingsResponse.status()} ${await findingsResponse.text()}`,
    );
  }

  const body = (await findingsResponse.json()) as FindingInventoryResponse;
  const items = Array.isArray(body.items) ? (body.items as FindingListItem[]) : [];
  const matches = items.filter(
    (item) =>
      item.type === FINDING_TYPE &&
      item.normalizedHostname === hostname &&
      typeof item.findingId === 'string',
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${FINDING_TYPE} finding for hostname ${hostname}; received ${matches.length} matching item(s) from ${items.length} returned item(s).`,
    );
  }

  return {
    findingId: matches[0]!.findingId as string,
    hostname,
    runId,
  };
}
