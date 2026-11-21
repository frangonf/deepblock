import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn('db-tabs inline-flex flex-wrap border-b border-line', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'db-tab inline-flex min-h-9 items-center gap-2 px-3 py-2 text-sm text-muted transition data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps) {
  return <TabsPrimitive.Content className={cn('mt-3', className)} {...props} />;
}
