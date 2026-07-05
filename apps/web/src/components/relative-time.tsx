'use client';

import { useSyncExternalStore } from 'react';

import { formatRelativeTime } from '@/lib/format';

const subscribe = () => () => undefined;

export function RelativeTime({ value, className }: { value: string | null; className?: string }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <span className={className} aria-hidden={!hydrated}>
      {hydrated ? formatRelativeTime(value) : '\u00A0'}
    </span>
  );
}
