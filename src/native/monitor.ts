/**
 * Tauri native background monitor bridge (Android APK).
 * No-op in the browser PWA.
 */

import {
  clampMonitorIntervalSec,
  DEFAULT_MONITOR_INTERVAL_SEC,
} from '../lib/monitor-shared';

const SETTINGS_KEY = 'qxgps.backgroundMonitor';

export interface BackgroundMonitorPrefs {
  enabled: boolean;
  intervalSec: number;
}

export function loadBackgroundMonitorPrefs(): BackgroundMonitorPrefs {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { enabled: false, intervalSec: DEFAULT_MONITOR_INTERVAL_SEC };
    }
    const parsed = JSON.parse(raw) as Partial<BackgroundMonitorPrefs>;
    return {
      enabled: Boolean(parsed.enabled),
      intervalSec: clampMonitorIntervalSec(
        typeof parsed.intervalSec === 'number'
          ? parsed.intervalSec
          : DEFAULT_MONITOR_INTERVAL_SEC,
      ),
    };
  } catch {
    return { enabled: false, intervalSec: DEFAULT_MONITOR_INTERVAL_SEC };
  }
}

export function saveBackgroundMonitorPrefs(prefs: BackgroundMonitorPrefs): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      enabled: prefs.enabled,
      intervalSec: clampMonitorIntervalSec(prefs.intervalSec),
    }),
  );
}

export function isTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export interface MonitorStatus {
  enabled: boolean;
  interval_sec: number;
  last_poll_ok: boolean;
  last_poll_at: string | null;
  last_error: string | null;
  android_service_running: boolean;
}

/** Push session + stored login to the native monitor store and apply prefs. */
export async function syncNativeBackgroundMonitor(
  prefs: BackgroundMonitorPrefs,
  session: { sid: string; familyid?: string; account?: string },
  password: string | null,
): Promise<MonitorStatus> {
  if (!isTauriShell()) {
    saveBackgroundMonitorPrefs(prefs);
    return {
      enabled: prefs.enabled,
      interval_sec: prefs.intervalSec,
      last_poll_ok: false,
      last_poll_at: null,
      last_error: null,
      android_service_running: false,
    };
  }

  if (!session.familyid) {
    throw new Error('Session is missing familyid — sign in again.');
  }
  if (prefs.enabled && !password) {
    throw new Error(
      'Background monitoring needs stored login credentials. Sign out and sign in again on this device.',
    );
  }

  await invoke('monitor_sync_session', {
    payload: {
      sid: session.sid,
      familyid: session.familyid,
      account: session.account ?? '',
      password: password ?? '',
    },
  });

  const status = await invoke<MonitorStatus>('monitor_apply_prefs', {
    payload: {
      enabled: prefs.enabled,
      interval_sec: clampMonitorIntervalSec(prefs.intervalSec),
    },
  });
  saveBackgroundMonitorPrefs(prefs);
  return status;
}

export async function fetchNativeMonitorStatus(): Promise<MonitorStatus | null> {
  if (!isTauriShell()) return null;
  return invoke<MonitorStatus>('monitor_get_status');
}

export async function requestAndroidNotificationPermission(): Promise<void> {
  if (!isTauriShell()) return;
  await invoke('monitor_request_post_notifications', {});
}

export async function openAndroidBatterySettings(): Promise<void> {
  if (!isTauriShell()) return;
  await invoke('monitor_open_battery_optimization_settings', {});
}
