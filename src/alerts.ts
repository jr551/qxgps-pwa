/**
 * Browser notifications for new alarms.
 *
 * The vendor push channel is Firebase/JPush to the Android app, which a page
 * cannot subscribe to. alarm.Get is the same read the app uses as a fallback,
 * so while this tab is open we poll it and raise a Notification for alarms
 * that were not in the previous poll. Nothing is marked read.
 */

import { getAlarms, getRunInfo, getSession } from './api/client';
import {
  collectNewAlarmNotifications,
  deviceSnapshotFromRunInfoItem,
  diffDeviceSnapshots,
} from './lib/monitor-shared';
import { rememberDevices } from './state';

const SEEN_KEY = 'qxgps.seenAlarms';
const DEVICE_SNAP_KEY = 'qxgps.monitorDeviceSnap';
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

function loadDeviceSnapshots(): Map<string, ReturnType<typeof deviceSnapshotFromRunInfoItem>> {
  try {
    const raw = localStorage.getItem(DEVICE_SNAP_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const map = new Map<string, ReturnType<typeof deviceSnapshotFromRunInfoItem>>();
    for (const row of parsed) {
      if (row && typeof row === 'object' && typeof (row as { simei?: string }).simei === 'string') {
        map.set((row as { simei: string }).simei, row as ReturnType<typeof deviceSnapshotFromRunInfoItem>);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveDeviceSnapshots(map: Map<string, ReturnType<typeof deviceSnapshotFromRunInfoItem>>): void {
  try {
    localStorage.setItem(DEVICE_SNAP_KEY, JSON.stringify([...map.values()]));
  } catch {
    // ignore
  }
}

/** Poll alarm.Get and notify for alarms that appear after the first seed. */
export function startAlarmAlerts(): () => void {
  let stopped = false;
  const seen = loadSeen();
  let alarmPrimed = seen.size > 0;
  let deviceSnapshots = loadDeviceSnapshots();
  let devicePrimed = deviceSnapshots.size > 0;

  const poll = async (): Promise<void> => {
    if (stopped || !getSession()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const info = await getRunInfo();
      const items = info.items ?? [];
      rememberDevices(items);
      const snapshots = items.map((item) => deviceSnapshotFromRunInfoItem(item));
      const { next, events: deviceEvents } = diffDeviceSnapshots(
        deviceSnapshots,
        snapshots,
        devicePrimed,
      );
      deviceSnapshots = next;
      devicePrimed = true;
      saveDeviceSnapshots(deviceSnapshots);

      const now = Math.floor(Date.now() / 1000);
      const fresh: Array<{ id: string; title: string; body: string }> = [];
      for (const event of deviceEvents) {
        fresh.push({ id: event.id, title: event.title, body: event.body });
      }
      // The first pass seeds `seen` for EVERY device — alarmPrimed is a
      // per-poll flag: only alarms first observed on a later poll notify.
      // Snapshot it so device #1's seed pass does not unblock notifications
      // for alarms that pre-existed on the other devices.
      const seeded = alarmPrimed;
      for (const item of items) {
        const alarms = await getAlarms(item.simei, {
          limit: 10,
          start: now - 2 * 24 * 3600,
          end: now,
        });
        const collected = collectNewAlarmNotifications(
          seen,
          alarms.map((a) => ({
            imei: a.imei ?? 0,
            time: a.send_time,
            type: a.alarm_type,
            alarm_name: a.content,
            car_number: a.car_number,
          })),
          item.car_number || 'QXGPS Lite',
          seeded,
        );
        for (const event of collected.events) {
          fresh.push({ id: event.id, title: event.title, body: event.body });
        }
      }
      alarmPrimed = true;
      saveSeen(seen);
      for (const note of fresh.slice(0, 4)) {
        new Notification(note.title, { body: note.body, icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: note.id });
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
