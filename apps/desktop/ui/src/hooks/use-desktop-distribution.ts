import { useQuery } from '@tanstack/react-query';

import { getDesktopDistributionStatus } from '@/lib/api';

export function useDesktopDistribution() {
  return useQuery({
    queryKey: ['desktop-distribution'],
    queryFn: getDesktopDistributionStatus,
  });
}
