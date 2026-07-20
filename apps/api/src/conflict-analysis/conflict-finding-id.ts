import { createHash } from 'node:crypto';

export const CONFLICT_FINDING_ID_PATTERN = /^finding_[0-9a-f]{24}$/;

export function createConflictFindingId(identity: string): string {
  return `finding_${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}
