import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--db-radius-control)] border border-line bg-surface px-2 py-1 text-xs font-medium text-ink',
        className,
      )}
      {...props}
    />
  );
}
