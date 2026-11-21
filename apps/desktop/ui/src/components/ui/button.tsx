import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'db-button inline-flex items-center justify-center gap-2 rounded-[var(--db-radius-control)] text-sm font-medium transition disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-accent text-on-action enabled:hover:bg-action-hover enabled:active:bg-action-active',
        secondary: 'border border-control-border bg-surface text-ink enabled:hover:bg-raised',
        outline: 'border border-control-border bg-transparent text-ink enabled:hover:bg-raised',
        ghost: 'text-muted hover:bg-raised hover:text-ink',
        danger: 'bg-danger text-on-danger enabled:hover:bg-[var(--db-danger-hover)]',
      },
      size: {
        default: 'min-h-9 px-4 py-2',
        sm: 'min-h-9 px-3 text-sm',
        lg: 'h-11 px-5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
