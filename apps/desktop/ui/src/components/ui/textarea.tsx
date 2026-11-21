import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'db-control min-h-28 w-full px-4 py-3 text-sm leading-relaxed text-ink transition placeholder:text-muted',
        className,
      )}
      {...props}
    />
  );
}
