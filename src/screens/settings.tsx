/**
 * Settings screen — PWA install, connectivity (browser + vendor API), app
 * info, alarms, read-only safety, and the signed-in account/session.
 *
 * READ-ONLY SAFETY (hard requirement — never relax): this screen must only
 * ever call read-only API functions. The vendor API check below uses the
 * vendor's own read-only bootstrap call, usermgr.GetUiFilePath (verified in
 * docs/protocol-notes.md: no session, no side effects).
 *
 * SIDE EFFECT (module scope): this module is imported by src/app.tsx at app
 * boot, so the listener below runs once regardless of which screen is shown.
 * It mirrors navigator.onLine onto <html data-connection="online|offline"> so
 * the header status dot in src/styles.css works on every screen.
 */
declare const __APP_VERSION__: string;

import { useCallback, useEffect, useState } from 'preact/hooks';
import { credentialsForNativeMonitor, logout, MAPI_URL, rpc } from '../api/client';
import {
  DEFAULT_MONITOR_INTERVAL_SEC,
  MAX_MONITOR_INTERVAL_SEC,
  MIN_MONITOR_INTERVAL_SEC,
} from '../lib/monitor-shared';
import {
  fetchNativeMonitorStatus,
  isTauriShell,
  loadBackgroundMonitorPrefs,
  openAndroidBatterySettings,
  requestAndroidNotificationPermission,
  saveBackgroundMonitorPrefs,
  syncNativeBackgroundMonitor,
  type MonitorStatus,
} from '../native/monitor';
import { MapiError, type MapiEnvelope } from '../api/types';
import { requestAlarmAlerts } from '../alerts';
import { AlarmsScreen } from './alarms';
import { DASH, fmtTs } from '../lib/format';
import { useAppState } from '../state';

const syncConnectionAttr = (): void => {
  document.documentElement.dataset.connection = navigator.onLine ? 'online' : 'offline';
};
syncConnectionAttr();
addEventListener('online', syncConnectionAttr);
addEventListener('offline', syncConnectionAttr);

/** The install-prompt event is not in lib.dom; declare the small slice we use. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** usermgr.GetUiFilePath response (verified: frame 67 — path, version 111). */
interface UiFilePathResponse extends MapiEnvelope {
  path?: string;
  version?: number;
}

type RelayStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; version: number | null; path: string | null }
  | { status: 'error'; message: string };

type CacheStatus =
  | { status: 'checking' }
  | { status: 'unavailable' }
  | { status: 'ok'; total: number; entries: { name: string; count: number }[] };

/** Vendor HTTPS mapi the browser calls directly. */
const UPSTREAM_HOST = 'www.gps666.net';

function isStandalone(): boolean {
  if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) {
    return true;
  }
  // iOS Safari signals "added to home screen" via navigator.standalone.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function describeError(err: unknown): string {
  if (err instanceof MapiError) {
    return `mapi error ${err.errcode}: ${err.error_message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Short display form of an opaque session token: first 6 + last 4 chars, so
 * two tokens stay distinguishable while the full secret never hits the screen.
 */
function shortToken(value: string | undefined): string {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : DASH;
}

async function readCacheStatus(): Promise<CacheStatus> {
  if (!('caches' in window)) return { status: 'unavailable' };
  try {
    const names = await caches.keys();
    const entries: { name: string; count: number }[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      entries.push({ name, count: (await cache.keys()).length });
    }
    return {
      status: 'ok',
      total: entries.reduce((n, entry) => n + entry.count, 0),
      entries,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export function SettingsScreen() {
  const { session, sessionMeta } = useAppState();

  // (a) PWA install
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);
  const [installNote, setInstallNote] = useState<string | null>(null);

  // (b) connectivity
  const [online, setOnline] = useState(() => navigator.onLine);
  const [relay, setRelay] = useState<RelayStatus>({ status: 'idle' });

  // (c) app info
  const [cache, setCache] = useState<CacheStatus>({ status: 'checking' });

  const nativeShell = isTauriShell();
  const [bgMonitor, setBgMonitor] = useState(() => loadBackgroundMonitorPrefs());
  const [bgStatus, setBgStatus] = useState<MonitorStatus | null>(null);
  const [bgNote, setBgNote] = useState<string | null>(null);
  const [bgBusy, setBgBusy] = useState(false);

  useEffect(() => {
    if (!nativeShell || !session) return;
    void fetchNativeMonitorStatus().then(setBgStatus);
  }, [nativeShell, session]);

  const applyBackgroundMonitor = async (next: { enabled: boolean; intervalSec: number }): Promise<void> => {
    if (!session) return;
    setBgBusy(true);
    setBgNote(null);
    try {
      if (next.enabled) {
        await requestAndroidNotificationPermission();
      }
      const creds = credentialsForNativeMonitor();
      const status = await syncNativeBackgroundMonitor(
        { enabled: next.enabled, intervalSec: next.intervalSec },
        session,
        creds?.password ?? null,
      );
      setBgMonitor({ enabled: next.enabled, intervalSec: next.intervalSec });
      saveBackgroundMonitorPrefs({ enabled: next.enabled, intervalSec: next.intervalSec });
      setBgStatus(status);
    } catch (err) {
      setBgNote(describeError(err));
    } finally {
      setBgBusy(false);
    }
  };

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setInstallNote('Installed.');
    };
    const mql = matchMedia('(display-mode: standalone)');
    const onModeChange = () => setInstalled(mql.matches || isStandalone());

    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    mql.addEventListener('change', onModeChange);
    return () => {
      removeEventListener('beforeinstallprompt', onPrompt);
      removeEventListener('appinstalled', onInstalled);
      mql.removeEventListener('change', onModeChange);
    };
  }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    addEventListener('online', sync);
    addEventListener('offline', sync);
    return () => {
      removeEventListener('online', sync);
      removeEventListener('offline', sync);
    };
  }, []);

  const checkRelay = useCallback(async (): Promise<void> => {
    setRelay({ status: 'checking' });
    try {
      const res = await rpc<UiFilePathResponse>('usermgr', 'GetUiFilePath', {
        filename: 'en',
        version: 111,
      });
      setRelay({
        status: 'ok',
        version: typeof res.version === 'number' ? res.version : null,
        path: typeof res.path === 'string' ? res.path : null,
      });
    } catch (err) {
      setRelay({ status: 'error', message: describeError(err) });
    }
  }, []);

  useEffect(() => {
    void checkRelay();
  }, [checkRelay]);

  const rescanCache = useCallback(async (): Promise<void> => {
    setCache({ status: 'checking' });
    setCache(await readCacheStatus());
  }, []);

  useEffect(() => {
    let alive = true;
    void readCacheStatus().then((status) => {
      if (alive) setCache(status);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onInstall = async (): Promise<void> => {
    if (!installEvent) return;
    setInstalling(true);
    setInstallNote('Waiting for the browser install prompt…');
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallNote(choice.outcome === 'accepted' ? 'Install accepted.' : 'Install dismissed.');
    } catch (err) {
      setInstallNote(`Install prompt failed: ${describeError(err)}`);
    } finally {
      setInstallEvent(null);
      setInstalling(false);
    }
  };

  return (
    <section class="stack">
      <h2>Settings</h2>

      <div class="card-grid">
        {/* (a) PWA install */}
        <section class="card">
          <h3 class="card-title">Install app</h3>
          {installed ? (
            <div class="row">
              <span class="badge badge-ok">Installed</span>
              <span class="muted">Running as an installed app.</span>
            </div>
          ) : installEvent ? (
            <div class="row">
              <button class="btn btn-primary" onClick={() => void onInstall()} disabled={installing}>
                Install
              </button>
              <span class="muted">Adds QXGPS Lite to your launcher / home screen.</span>
            </div>
          ) : (
            <p class="muted">
              No install prompt available right now. In Chrome/Edge on Android, or Safari on iOS
              (Share → Add to Home Screen), install it from the browser.
            </p>
          )}
          {installNote ? <p class="card-note">{installNote}</p> : null}
        </section>

        {/* (b) connectivity */}
        <section class="card">
          <h3 class="card-title">Connectivity</h3>
          <div class="stack">
            <div class="row">
              <span class={online ? 'status-dot status-dot-ok' : 'status-dot status-dot-err'} />
              <span>{online ? 'Browser reports online' : 'Browser reports offline'}</span>
              <span class={online ? 'badge badge-ok' : 'badge badge-err'}>
                {online ? 'Online' : 'Offline'}
              </span>
            </div>
            <div class="row">
              <span
                class={
                  relay.status === 'ok'
                    ? 'status-dot status-dot-ok'
                    : relay.status === 'error'
                      ? 'status-dot status-dot-err'
                      : relay.status === 'checking'
                        ? 'status-dot status-dot-warn'
                        : 'status-dot'
                }
              />
              <span>Vendor API</span>
              {relay.status === 'ok' ? <span class="badge badge-ok">OK</span> : null}
              {relay.status === 'error' ? <span class="badge badge-err">Failed</span> : null}
              {relay.status === 'checking' ? <span class="badge badge-warn">Checking…</span> : null}
              {relay.status === 'idle' ? <span class="badge badge-muted">Not checked</span> : null}
              <button
                class="btn btn-quiet"
                onClick={() => void checkRelay()}
                disabled={relay.status === 'checking'}
              >
                Re-check
              </button>
            </div>
            {relay.status === 'ok' ? (
              <p class="card-note">
                Vendor API reachable — <span class="mono">usermgr.GetUiFilePath</span> returned
                UI language file version{' '}
                <span class="mono">{relay.version ?? 'unknown'}</span>
                {relay.path ? (
                  <>
                    {' '}
                    at <span class="mono">{relay.path}</span>
                  </>
                ) : null}
                .
              </p>
            ) : null}
            {relay.status === 'error' ? (
              <p class="card-note">
                Vendor API check failed: <span class="mono">{relay.message}</span>
              </p>
            ) : null}
          </div>
        </section>

        {nativeShell ? (
          <section class="card">
            <h3 class="card-title">Background monitoring (native)</h3>
            <p class="card-note">
              Polls <span class="mono">family.GetRunInfo</span> and{' '}
              <span class="mono">alarm.Get</span> on an interval while you are signed in — same
              read-only calls as the Live screen and in-tab alarm alerts. No Firebase or Play
              Services.
            </p>
            <label class="row" style="align-items: center; gap: 0.5rem">
              <input
                type="checkbox"
                checked={bgMonitor.enabled}
                disabled={bgBusy || !session}
                onChange={(event) => {
                  const enabled = (event.target as HTMLInputElement).checked;
                  void applyBackgroundMonitor({
                    enabled,
                    intervalSec: bgMonitor.intervalSec,
                  });
                }}
              />
              <span>Enable background device checks</span>
            </label>
            <div class="row" style="margin-top: var(--sp-sm)">
              <label>
                Interval (seconds){' '}
                <input
                  type="number"
                  min={MIN_MONITOR_INTERVAL_SEC}
                  max={MAX_MONITOR_INTERVAL_SEC}
                  step={60}
                  value={bgMonitor.intervalSec}
                  disabled={bgBusy || !bgMonitor.enabled}
                  onChange={(event) => {
                    const value = Number((event.target as HTMLInputElement).value);
                    if (!Number.isFinite(value)) return;
                    setBgMonitor((prev) => ({ ...prev, intervalSec: value }));
                  }}
                  onBlur={() => {
                    void applyBackgroundMonitor(bgMonitor);
                  }}
                />
              </label>
              <span class="muted">
                Default {DEFAULT_MONITOR_INTERVAL_SEC}s ({MIN_MONITOR_INTERVAL_SEC}–
                {MAX_MONITOR_INTERVAL_SEC}).
              </span>
            </div>
            {bgStatus ? (
              <p class="card-note">
                Last poll: {bgStatus.last_poll_at ?? 'never'}
                {bgStatus.last_poll_ok ? ' (ok)' : bgStatus.last_error ? ` — ${bgStatus.last_error}` : ''}
                {bgStatus.android_service_running ? ' · Android foreground service active' : ''}
              </p>
            ) : null}
            <div class="row" style="margin-top: var(--sp-sm)">
              <button
                class="btn btn-quiet"
                type="button"
                disabled={bgBusy}
                onClick={() => void requestAndroidNotificationPermission()}
              >
                Notification permission
              </button>
              <button
                class="btn btn-quiet"
                type="button"
                disabled={bgBusy}
                onClick={() => void openAndroidBatterySettings()}
              >
                Battery optimisation settings
              </button>
            </div>
            {bgNote ? <p class="card-note">{bgNote}</p> : null}
          </section>
        ) : null}

        {/* (c) app info */}
        <section class="card">
          <h3 class="card-title">App info</h3>
          <dl class="kv">
            <dt>Build version</dt>
            <dd class="mono">{__APP_VERSION__}</dd>
            <dt>Upstream host</dt>
            <dd class="mono">{UPSTREAM_HOST}</dd>
            <dt>Vendor API</dt>
            <dd class="mono">{MAPI_URL}</dd>
            <dt>Cache storage</dt>
            <dd>
              {cache.status === 'checking'
                ? 'Scanning…'
                : cache.status === 'unavailable'
                  ? 'Unavailable (needs HTTPS or localhost)'
                  : `${cache.total} cached entries`}
            </dd>
          </dl>
          {cache.status === 'ok' ? (
            <div class="row" style="margin-top: var(--sp-md)">
              {cache.entries.length === 0 ? (
                <span class="chip mono">no caches yet</span>
              ) : (
                cache.entries.map((entry) => (
                  <span class="chip mono" key={entry.name}>
                    {entry.name}: {entry.count}
                  </span>
                ))
              )}
            </div>
          ) : null}
          <div class="row" style="margin-top: var(--sp-md)">
            <button class="btn btn-quiet" onClick={() => void rescanCache()}>
              Re-scan cache
            </button>
          </div>
        </section>

        <section class="card alarms-card">
          <AlarmsScreen embedded />
          <div class="row" style="margin-top: var(--sp-md)">
            <button class="btn btn-quiet" type="button" onClick={() => requestAlarmAlerts()}>
              Enable alarm alerts
            </button>
            <span class="muted">Shows a browser notification when a new alarm arrives.</span>
          </div>
        </section>

        {/* (d) safety */}
        <section class="card">
          <h3 class="card-title">Read-only safety</h3>
          <p>
            This client is strictly read-only: it never sends device commands, config changes or
            account mutations.
          </p>
          <p class="card-note">
            Only login and Get*/get* calls are allowed anywhere in this app — no Set*, Add*, Del*,
            BatchCmd, setSimCmd, write, command or mark-read call may ever be added.
          </p>
        </section>

        {/* (e) account / session */}
        <section class="card">
          <h3 class="card-title">Account</h3>
          {session ? (
            <>
              <dl class="kv">
                <dt>Account</dt>
                <dd>{sessionMeta ? sessionMeta.account : DASH}</dd>
                <dt>Session (sid)</dt>
                <dd class="mono">{shortToken(session.sid)}</dd>
                <dt>Family id</dt>
                <dd class="mono">{shortToken(session.familyid)}</dd>
                <dt>Signed in</dt>
                <dd>{fmtTs(sessionMeta?.loginAt)}</dd>
              </dl>
              <div class="row" style="margin-top: var(--sp-md)">
                <button class="btn btn-quiet" onClick={() => logout()}>
                  Log out
                </button>
                <span class="muted">Signs out locally — the vendor session is left to expire.</span>
              </div>
            </>
          ) : (
            <p class="muted">Not signed in.</p>
          )}
        </section>
      </div>
    </section>
  );
}
