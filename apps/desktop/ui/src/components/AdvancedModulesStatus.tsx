import { useQuery } from '@tanstack/react-query';
import { getModules } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export function AdvancedModulesStatus() {
  const query = useQuery({ queryKey: ['modules'], queryFn: getModules, retry: false });
  return <Card><CardHeader><CardTitle>Optional modules</CardTitle><CardDescription>Planning works independently of recording, processing, assessment and assistance.</CardDescription></CardHeader>
    <CardContent className="grid gap-2 text-sm text-muted">
      {query.isLoading && <p>Loading optional module status…</p>}
      {query.error && <p role="status">Optional module status unavailable. Planning remains available.</p>}
      {query.data?.modules.map((module) => <p key={module.module_id}><span className="capitalize">{module.module_id}</span>: {module.state === 'unconfigured' ? 'Not configured' : module.state}</p>)}
    </CardContent></Card>;
}
