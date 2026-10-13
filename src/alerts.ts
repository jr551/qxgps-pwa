/**
 * Browser notifications for new alarms.
 *
 * The vendor push channel is Firebase/JPush to the Android app, which a page
 * cannot subscribe to. alarm.Get is the same read the app uses as a fallback,
 * so while this tab is open we poll it and raise a Notification for alarms
 * that were not in the previous poll. Nothing is marked read.
 */

import { getAlarms, getRunInfo, getSession } from './api/client';
import { rememberDevices } from './state';

const SEEN_KEY = 'qxgps.seenAlarms';
const POLL_MS = 60_000;

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  try {
    const ids = [...seen].slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/** Ask for notification permission. Call from a click so the browser allows it. */
export function requestAlarmAlerts(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/** Poll alarm.Get and notify for alarms that appear after the first seed. */
export function startAlarmAlerts(): () => void {
  let stopped = false;
  const seen = loadSeen();
  let primed = seen.size > 0;

  const poll = async (): Promise<void> => {
    if (stopped || !getSession()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const info = await getRunInfo();
      const items = info.items ?? [];
      rememberDevices(items);
      const now = Math.floor(Date.now() / 1000);
      const fresh: Array<{ id: string; title: string; body: string }> = [];
      for (const item of items) {
        const alarms = await getAlarms(item.simei, {
          limit: 10,
          start: now - 2 * 24 * 3600,
          end: now,
        });
        for (const alarm of alarms) {
          if (seen.has(alarm.id)) continue;
          seen.add(alarm.id);
          if (primed) {
            const title = alarm.car_number || item.car_number || 'QXGPS Lite';
            fresh.push({ id: alarm.id, title, body: alarm.content || alarm.alarm_type });
          }
        }
      }
      primed = true;
      saveSeen(seen);
      for (const note of fresh.slice(0, 4)) {
        new Notification(note.title, { body: note.body, icon: '/icon-192.png', tag: note.id });
      }
    } catch {
      // The next poll retries. A failed read must not clear the seen set.
    }
  };

  void poll();
  const timer = window.setInterval(() => {
    void poll();
  }, POLL_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
