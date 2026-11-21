import { datasetChangedEvent } from '@/lib/dataset';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeftRight,
  BarChart4,
  BookOpenText,
  KanbanSquare,
  LayoutGrid,
  type LucideIcon,
  Monitor,
  NotebookPen,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  initializeDataset,
  refreshDatasetIdentity,
  getMode,
  getWsUrl,
  setMode,
  type InteractionMode,
} from '@/lib/api';
import { useNoteUnloadWarning } from '@/hooks/use-note-autosave';
import { useBlockNotifications } from '@/hooks/use-block-notifications';
import { useConfig } from '@/hooks/use-config';
import { useDayPlan } from '@/hooks/use-day-plan';
import { useDesktopDistribution } from '@/hooks/use-desktop-distribution';
import { useSelectedDate } from '@/hooks/use-selected-date';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
const ActivityWatchPage = lazy(() => import('@/pages/ActivityWatchPage').then((module) => ({ default: module.ActivityWatchPage })));
const PlannerPage = lazy(() => import('@/pages/PlannerPage').then((module) => ({ default: module.PlannerPage })));
const ComparePage = lazy(() => import('@/pages/ComparePage').then((module) => ({ default: module.ComparePage })));
const RealityPage = lazy(() => import('@/pages/RealityPage').then((module) => ({ default: module.RealityPage })));
const ReviewPage = lazy(() => import('@/pages/ReviewPage').then((module) => ({ default: module.ReviewPage })));
const NotesPage = lazy(() => import('@/pages/NotesPage').then((module) => ({ default: module.NotesPage })));
const BacklogPage = lazy(() => import('@/pages/BacklogPage').then((module) => ({ default: module.BacklogPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const HelpPage = lazy(() => import('@/pages/HelpPage').then((module) => ({ default: module.HelpPage })));

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

const baseNavItems: NavItem[] = [
  { to: '/planner', label: 'Planner', icon: LayoutGrid },
  { to: '/compare', label: 'Compare', icon: ArrowLeftRight },
  { to: '/reality', label: 'Reality', icon: Activity },
  { to: '/review', label: 'Review', icon: BarChart4 },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/backlog', label: 'Backlog', icon: KanbanSquare },
  { to: '/settings', label: 'Settings', icon: Settings2 },
  { to: '/help', label: 'Help', icon: BookOpenText },
];

function routeTitle(pathname: string) {
  switch (pathname) {
    case '/compare':
      return 'Compare revisions';
    case '/reality':
      return 'Observed activity';
    case '/review':
      return 'Day review';
    case '/activitywatch':
      return 'ActivityWatch explorer';
    case '/notes':
      return 'Daily notes';
    case '/backlog':
      return 'Backlog';
    case '/settings':
      return 'Settings';
    case '/help':
      return 'Help';
    default:
      return 'Planner';
  }
}

function DatasetApp() {
  useNoteUnloadWarning();
  const location = useLocation();
  const [selectedDate] = useSelectedDate();
  const queryClient = useQueryClient();
  const modeQuery = useQuery({ queryKey: ['mode'], queryFn: getMode });
  const configQuery = useConfig();
  const distributionQuery = useDesktopDistribution();
  const todayPlanQuery = useDayPlan();
  const modeMutation = useMutation({
    mutationFn: (mode: InteractionMode) => setMode(mode),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mode'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
    let hasConnectedOnce = false;
    let disconnectToastShown = false;
    let reconnectDelayMs = 250;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer !== null) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000);
    };

    const connect = async () => {
      try {
        const wsUrl = await getWsUrl();
        if (cancelled) return;

        const currentSocket = new WebSocket(wsUrl);
        socket = currentSocket;

        currentSocket.onopen = () => {
          const isReconnect = hasConnectedOnce;
          hasConnectedOnce = true;
          disconnectToastShown = false;
          reconnectDelayMs = 250;
          if (isReconnect) {
            void refreshDatasetIdentity().then(() => queryClient.invalidateQueries()).catch(() => {});
          }
        };
        currentSocket.onmessage = (event) => {
          const payload = JSON.parse(event.data) as { event?: string };
          if (payload.event === 'dataset_replaced') void refreshDatasetIdentity().catch(() => {});
          if (payload.event === 'refresh') {
            void queryClient.invalidateQueries();
          }
          if (payload.event === 'mode_changed') {
            void queryClient.invalidateQueries({ queryKey: ['mode'] });
          }
        };
        currentSocket.onerror = () => {
          currentSocket.close();
        };
        currentSocket.onclose = () => {
          if (socket === currentSocket) {
            socket = null;
          }
          if (cancelled) {
            return;
          }
          if (hasConnectedOnce && !disconnectToastShown) {
            disconnectToastShown = true;
            toast.warning('Realtime sync disconnected. The app will continue with manual refreshes.');
          }
          scheduleReconnect();
        };
      } catch {
        if (!cancelled) {
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      socket?.close();
    };
  }, [queryClient]);

  useBlockNotifications(configQuery.data, todayPlanQuery.data);

  const currentMode = modeQuery.data?.mode ?? 'reflect';
  const nextMode: InteractionMode = currentMode === 'focus' ? 'reflect' : 'focus';
  const title = useMemo(() => routeTitle(location.pathname), [location.pathname]);
  const activityWatchAvailable = Boolean(
    distributionQuery.data?.activitywatch.enabled && distributionQuery.data?.activitywatch.server_reachable,
  );
  const navItems = useMemo(() => {
    const items = [...baseNavItems];
    if (activityWatchAvailable) {
      items.splice(3, 0, { to: '/activitywatch', label: 'ActivityWatch', icon: Monitor });
    }
    return items;
  }, [activityWatchAvailable]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <span className="text-sm text-muted">Workspace / {title}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => modeMutation.mutate(nextMode)}
          disabled={modeMutation.isPending || modeQuery.isLoading}
          title="Focus: work on your plan. Reflect: review your day. This shared marker does not change reminders or block editing."
          aria-label={`Current intent: ${currentMode}. Switch to ${nextMode}`}
        >
          Intent: {currentMode}
        </Button>
      </header>
      <div className="app-workspace">
        <aside className="app-sidebar">
          <NavLink to="/planner" className="app-brand" aria-label="DeepBlock planner">
            <span className="app-brand-mark" aria-hidden="true" />
            DeepBlock
          </NavLink>
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={`${to}?date=${selectedDate}`}
                className={({ isActive }) => cn('app-nav-item', isActive && 'app-nav-item--active')}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main id="main-content" tabIndex={-1} className="min-w-0">
          <h1 className="db-page-title">{title}</h1>
          <Suspense fallback={<div role="status" className="p-6 text-sm text-muted">Loading page…</div>}>
            <Routes>
              <Route path="/" element={<PlannerPage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/reality" element={<RealityPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/activitywatch" element={<ActivityWatchPage available={activityWatchAvailable} />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/backlog" element={<BacklogPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/help" element={<HelpPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void initializeDataset().then(() => { if (active) setReady(true); }).catch((error: unknown) => { if (active) setError(String(error)); });
    const replaced = () => setChanged(true);
    window.addEventListener(datasetChangedEvent, replaced);
    return () => { active = false; window.removeEventListener(datasetChangedEvent, replaced); };
  }, []);
  if (changed) return <main className="p-8"><h1>Dataset replaced</h1><p>Reload to view the restored data. Older unsaved drafts remain available under Data recovery in Settings.</p><Button onClick={() => window.location.reload()}>Reload restored data</Button></main>;
  if (!ready) return <main className="p-8"><p role={error ? 'alert' : undefined}>{error || 'Connecting to planning storage…'}</p>{error && <Button onClick={() => window.location.reload()}>Retry</Button>}</main>;
  return <DatasetApp />;
}
