import { Toaster } from 'sonner';
import { useThemeMode } from '@/hooks/use-theme-mode';

export function ThemedToaster() {
  const mode = useThemeMode();
  return <Toaster richColors theme={mode} />;
}
