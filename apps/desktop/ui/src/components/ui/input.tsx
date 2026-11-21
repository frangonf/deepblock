import type { InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'db-control min-h-9 w-full px-3 py-2 text-sm text-ink transition placeholder:text-muted',
        className,
      )}
      {...props}
    />
  );
}
