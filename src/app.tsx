/**
 * App shell: hash-routed screens behind a session gate. No session => the
 * login screen only; with a session => header + nav + the routed screen.
 *
 * SESSION EXPIRY: the rpc() transport (src/api/client.ts) drops the session
 * when the vendor answers errcode 268697631 (stale sid). The listeners below
 * are the app-wide backstop for that error escaping a screen's own catch —
 * any uncaught stale-sid MapiError clears the session and lands on the login
 * screen with SESSION_EXPIRED_NOTICE.
 */

import { Component, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LiveScreen } from './screens/live';
import { HistoryScreen } from './screens/history';
import { DeviceScreen } from './screens/device';
import { SettingsScreen } from './screens/settings';
import { LoginScreen } from './screens/login';
import { credentialsForNativeMonitor, hasStoredCredentials, restoreLogin } from './api/client';
import { isTauriShell, loadBackgroundMonitorPrefs, syncNativeBackgroundMonitor } from './native/monitor';
import { MapiError } from './api/types';
import { startAlarmAlerts } from './alerts';
import { APP_TITLE } from './brand';
import { clearSession, getState, SESSION_EXPIRED_NOTICE, useAppState } from './state';
import './screens/login.css';

/** Hash routes: #/live #/history #/device #/settings. Alarms live under Settings. */
const ROUTES = {
  live: { label: 'Live', emoji: '📍', Screen: LiveScreen },
  history: { label: 'History', emoji: '🗓️', Screen: HistoryScreen },
  device: { label: 'Device', emoji: '📱', Screen: DeviceScreen },
  settings: { label: 'Settings', emoji: '⚙️', Screen: SettingsScreen },
} as const;

type RouteKey = keyof typeof ROUTES;

/** Vendor errcode for a stale/expired sid (docs/protocol-notes.md §4). */
const ERR_STALE_SID = 268697631;

function routeFromHash(hash: string): RouteKey {
  const key = hash.replace(/^#\/?/, '');
  return key in ROUTES ? (key as RouteKey) : 'live';
}

/** The expired-session path: the vendor rejected our sid (stale-sid errcode). */
function isSessionExpiredError(err: unknown): boolean {
  return err instanceof MapiError && err.errcode === ERR_STALE_SID;
}

/**
 * Keeps a crash inside one routed screen from blanking the whole shell. An
 * expired-session error is not shown here — the gate below re-renders the
 * login screen in its place.
 */
class ScreenBoundary extends Component<{ children: ComponentChildren }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    if (isSessionExpiredError(error)) {
      clearSession(SESSION_EXPIRED_NOTICE);
    }
  }

  render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    if (isSessionExpiredError(error)) {
      return null;
    }
    return (
      <section class="card">
        <h3 class="card-title">Screen failed to load</h3>
        <p class="card-note">{error instanceof Error ? error.message : String(error)}</p>
        <button class="btn btn-quiet" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </section>
    );
  }
}

export function App() {
  const [route, setRoute] = useState<RouteKey>(() => routeFromHash(location.hash));
  const { session, sessionMeta, selectedSimei, deviceNames } = useAppState();
  const [booting, setBooting] = useState(() => !getState().session && hasStoredCredentials());

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash(location.hash));
    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!booting) return;
    let cancelled = false;
    restoreLogin().finally(() => {
      if (!cancelled) setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [booting]);

  useEffect(() => {
    if (!session) return;
    if (isTauriShell() && loadBackgroundMonitorPrefs().enabled) return;
    return startAlarmAlerts();
  }, [session]);

  useEffect(() => {
    if (!session || !isTauriShell()) return;
    const prefs = loadBackgroundMonitorPrefs();
    if (!prefs.enabled) return;
    const creds = credentialsForNativeMonitor();
    void syncNativeBackgroundMonitor(prefs, session, creds?.password ?? null);
  }, [session]);

  useEffect(() => {
    const expireIfStaleSid = (err: unknown): boolean => {
      if (!isSessionExpiredError(err)) return false;
      clearSession(SESSION_EXPIRED_NOTICE);
      return true;
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (expireIfStaleSid(event.reason)) {
        event.preventDefault();
      }
    };
    const onWindowError = (event: ErrorEvent) => {
      if (expireIfStaleSid(event.error)) {
        event.preventDefault();
      }
    };
    addEventListener('unhandledrejection', onRejection);
    addEventListener('error', onWindowError);
    return () => {
      removeEventListener('unhandledrejection', onRejection);
      removeEventListener('error', onWindowError);
    };
  }, []);

  if (booting) {
    return (
      <div class="login-wrap">
        <p class="muted">Signing in…</p>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  const { Screen } = ROUTES[route];
  const deviceLabel = selectedSimei ? deviceNames[selectedSimei] : '';

  return (
    <div class="shell">
      <header class="header">
        <h1 class="header-title">{APP_TITLE}</h1>
        <span class="header-status">
          {sessionMeta?.account ?? 'Signed in'}
          {deviceLabel ? ` · ${deviceLabel}` : ''}
        </span>
      </header>
      <nav class="nav">
        {(Object.keys(ROUTES) as RouteKey[]).map((key) => (
          <a
            key={key}
            href={`#/${key}`}
            class={key === route ? 'nav-link nav-link-active' : 'nav-link'}
          >
            <span class="nav-emoji" aria-hidden="true">{ROUTES[key].emoji}</span>
            <span class="nav-label">{ROUTES[key].label}</span>
          </a>
        ))}
      </nav>
      <main class="content">
        <ScreenBoundary>
          <Screen />
        </ScreenBoundary>
      </main>
    </div>
  );
}
