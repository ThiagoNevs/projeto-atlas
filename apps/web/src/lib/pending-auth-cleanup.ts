const REVIEW_PENDING_PREFIX = 'atlas:pending-review-';

export function clearFindingReviewPendingAttempts(): void {
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) =>
      window.sessionStorage.key(index),
    ).filter((key): key is string => key?.startsWith(REVIEW_PENDING_PREFIX) ?? false);
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in restrictive browser contexts.
  }
}
