/**
 * Shared device-monitor logic for the PWA tab poller and the native (Tauri) shell.
 * Only uses verified read API fields from family.GetRunInfo and alarm.Get.
 */

/** Stable id for an alarm.Get row (wire has no row id). */
export function alarmItemId(imei: number, time: number, type: string): string {
  return `${imei}-${time}-${type}`;
}

export type LinkTone = 'online' | 'sleep' | 'offline';

export function linkToneFromState(state: string): LinkTone {
  if (state === 'e_line_on') return 'online';
  if (state === 'e_line_sleep') return 'sleep';
  return 'offline';
}

export function linkToneLabel(tone: LinkTone): string {
  if (tone === 'online') return 'Online';
  if (tone === 'sleep') return 'Sleep';
  return 'Offline';
}

/** Snapshot of fields we can verify from family.GetRunInfo items. */
export interface DeviceSnapshot {
  simei: string;
  car_number: string;
  state: string;
  power: number | null;
  last_com_time: number;
  expire: boolean;
}

export function deviceSnapshotFromRunInfoItem(item: {
  simei: string;
  car_number?: string;
  state: string;
  power?: number;
  last_com_time?: number;
  expire?: boolean;
}): DeviceSnapshot {
  return {
    simei: item.simei,
    car_number: item.car_number ?? '',
    state: item.state,
    power: typeof item.power === 'number' ? item.power : null,
    last_com_time: typeof item.last_com_time === 'number' ? item.last_com_time : 0,
    expire: Boolean(item.expire),
  };
}

/** Vendor `power` is treated as 0–100 % in the Live UI; threshold is heuristic. */
export const LOW_BATTERY_PERCENT = 20;

export type MonitorEventKind = 'link_state' | 'low_battery' | 'new_alarm';

export interface MonitorNotification {
  kind: MonitorEventKind;
  id: string;
  title: string;
  body: string;
}

export function diffDeviceSnapshots(
  previous: Map<string, DeviceSnapshot>,
  current: DeviceSnapshot[],
  primed: boolean,
): { next: Map<string, DeviceSnapshot>; events: MonitorNotification[] } {
  const next = new Map<string, DeviceSnapshot>();
  const events: MonitorNotification[] = [];

  for (const snap of current) {
    next.set(snap.simei, snap);
    const prior = previous.get(snap.simei);
    if (!prior) continue;
    if (!primed) continue;

    const label = snap.car_number || 'Device';
    const prevTone = linkToneFromState(prior.state);
    const nextTone = linkToneFromState(snap.state);
    if (prevTone !== nextTone) {
      events.push({
        kind: 'link_state',
        id: `link-${snap.simei}-${snap.state}-${snap.last_com_time}`,
        title: label,
        body: `Link state: ${linkToneLabel(prevTone)} → ${linkToneLabel(nextTone)}`,
      });
    }

    if (
      snap.power !== null &&
      prior.power !== null &&
      prior.power > LOW_BATTERY_PERCENT &&
      snap.power <= LOW_BATTERY_PERCENT
    ) {
      events.push({
        kind: 'low_battery',
        id: `battery-${snap.simei}-${snap.power}`,
        title: label,
        body: `Battery reported at ${snap.power}%`,
      });
    }
  }

  return { next, events };
}

export interface AlarmWireRow {
  imei: number;
  time: number;
  type: string;
  alarm_name: string;
  car_number?: string;
}

export function collectNewAlarmNotifications(
  seen: Set<string>,
  rows: AlarmWireRow[],
  deviceLabel: string,
  primed: boolean,
): { seen: Set<string>; events: MonitorNotification[]; primed: boolean } {
  const events: MonitorNotification[] = [];
  let nextPrimed = primed;

  for (const row of rows) {
    const id = alarmItemId(row.imei, row.time, row.type);
    if (seen.has(id)) continue;
    seen.add(id);
    if (nextPrimed) {
      const title = row.car_number || deviceLabel || 'QXGPS Lite';
      events.push({
        kind: 'new_alarm',
        id,
        title,
        body: row.alarm_name || row.type,
      });
    }
  }
  nextPrimed = true;
  return { seen, events, primed: nextPrimed };
}

export const DEFAULT_MONITOR_INTERVAL_SEC = 300;
export const MIN_MONITOR_INTERVAL_SEC = 120;
export const MAX_MONITOR_INTERVAL_SEC = 900;

export function clampMonitorIntervalSec(seconds: number): number {
  return Math.min(MAX_MONITOR_INTERVAL_SEC, Math.max(MIN_MONITOR_INTERVAL_SEC, Math.round(seconds)));
}
