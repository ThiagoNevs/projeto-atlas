import { describe, expect, it } from '@jest/globals';

import {
  API_CONNECTION_ERROR_MESSAGE,
  ApiError,
  normalizeApiError,
} from '../../web/src/lib/api-error';
import { getAuditActionLabel, getEventLabel } from '../../web/src/lib/labels';

describe('Frontend presentation helpers', () => {
  it('translates a fetch TypeError into the controlled connection message', () => {
    expect(normalizeApiError(new TypeError('Failed to fetch')).message).toBe(
      API_CONNECTION_ERROR_MESSAGE,
    );
  });

  it('recognizes an equivalent network failure without an HTTP response', () => {
    expect(normalizeApiError(new Error('Network request failed')).message).toBe(
      API_CONNECTION_ERROR_MESSAGE,
    );
  });

  it('preserves a structured message returned by the backend', () => {
    const structuredError = new ApiError('Hostname é obrigatório.', 400);

    expect(normalizeApiError(structuredError)).toBe(structuredError);
    expect(normalizeApiError(structuredError).message).toBe('Hostname é obrigatório.');
  });

  it('does not expose the raw Failed to fetch message', () => {
    expect(normalizeApiError(new TypeError('Failed to fetch')).message).not.toContain(
      'Failed to fetch',
    );
  });

  it('translates the CSV import event for the asset timeline', () => {
    expect(getEventLabel('ASSET_IMPORTED_FROM_CSV')).toBe('Ativo importado');
  });

  it('translates the CSV import action for the audit screen', () => {
    expect(getAuditActionLabel('ASSET_IMPORTED_FROM_CSV')).toBe('Ativo importado');
  });
});
