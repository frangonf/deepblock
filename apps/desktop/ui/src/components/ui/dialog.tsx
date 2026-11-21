import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        className={cn(
          'db-dialog fixed left-1/2 top-1/2 z-50 w-[min(92vw,42rem)] -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[var(--db-radius-modal)] border border-line bg-surface p-6',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close aria-label="Close dialog" className="absolute right-4 top-4 rounded-full p-2 text-muted transition hover:bg-raised hover:text-ink">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-2', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('db-section-title pr-8 text-ink', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted', className)} {...props} />;
}
