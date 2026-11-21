import { useEffect, useRef } from 'react';

import { type Block, type ClientConfig, type DayPlan } from '@/lib/api';
import {
  isNotificationPermissionGranted,
  requestNotificationPermission,
  sendRuntimeNotification,
} from '@/lib/runtime';
import { todayString } from '@/lib/utils';

type BlockReminderKind = 'start' | 'end';
type ScheduledBlockReminder = {
  key: string;
  block: Block;
  kind: BlockReminderKind;
  scheduledAt: number;
};

const POLL_INTERVAL_MS = 30_000;
const DELIVERY_WINDOW_MS = 15 * 60_000;

function blockStartMs(planDate: string, block: Block) {
  return new Date(`${planDate}T${block.start}:00`).getTime();
}

function reminderMessage(block: Block, kind: BlockReminderKind, minutesBefore: number) {
  const verb = kind === 'start' ? 'starts' : 'ends';
  const phrase = minutesBefore === 0 ? 'now' : `in ${minutesBefore} minute${minutesBefore === 1 ? '' : 's'}`;
  return `${block.label} ${verb} ${phrase}.`;
}

function shouldSkipBlock(block: Block) {
  return block.status === 'cancelled' || block.status === 'done';
}

function notificationCandidates(config: ClientConfig, plan: DayPlan) {
  if (plan.date !== todayString()) {
    return [] as ScheduledBlockReminder[];
  }

  const activeRevision = plan.revisions.at(-1);
  if (!activeRevision) {
    return [] as ScheduledBlockReminder[];
  }

  const minutesBeforeMs = config.notify_minutes_before * 60_000;

  return activeRevision.blocks.flatMap((block) => {
    if (shouldSkipBlock(block)) {
      return [] as ScheduledBlockReminder[];
    }

    const startMs = blockStartMs(plan.date, block);
    const endMs = startMs + (block.duration * 60_000);
    const candidates: ScheduledBlockReminder[] = [];

    if (config.notify_on_block_start) {
      const scheduledAt = startMs - minutesBeforeMs;
      candidates.push({
        key: `${plan.date}:${block.id}:start:${scheduledAt}`,
        block,
        kind: 'start',
        scheduledAt,
      });
    }

    if (config.notify_on_block_end) {
      const scheduledAt = endMs - minutesBeforeMs;
      candidates.push({
        key: `${plan.date}:${block.id}:end:${scheduledAt}`,
        block,
        kind: 'end',
        scheduledAt,
      });
    }

    return candidates;
  });
}

export function useBlockNotifications(config?: ClientConfig, plan?: DayPlan) {
  const sentNotificationsRef = useRef<Set<string>>(new Set());
  const permissionGrantedRef = useRef<boolean | null>(null);
  const permissionRequestedRef = useRef(false);

  useEffect(() => {
    if (!config || !plan || !config.notifications_enabled) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      let granted = permissionGrantedRef.current;
      if (granted === null) {
        granted = await isNotificationPermissionGranted();
        permissionGrantedRef.current = granted;
      }
      if (!granted && !permissionRequestedRef.current) {
        permissionRequestedRef.current = true;
        granted = await requestNotificationPermission();
        permissionGrantedRef.current = granted;
      }
      if (!granted || cancelled) {
        return;
      }

      const now = Date.now();
      for (const candidate of notificationCandidates(config, plan)) {
        if (sentNotificationsRef.current.has(candidate.key)) {
          continue;
        }
        if (now < candidate.scheduledAt || now > candidate.scheduledAt + DELIVERY_WINDOW_MS) {
          continue;
        }

        void sendRuntimeNotification({
          title: candidate.block.label,
          body: reminderMessage(candidate.block, candidate.kind, config.notify_minutes_before),
        });
        sentNotificationsRef.current.add(candidate.key);
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [config, plan]);
}
