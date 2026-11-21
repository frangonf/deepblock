import { useQuery } from '@tanstack/react-query';

import { getPlan } from '@/lib/api';

export function useDayPlan(date?: string) {
  return useQuery({
    queryKey: ['plan', date ?? 'today'],
    queryFn: () => getPlan(date),
  });
}
