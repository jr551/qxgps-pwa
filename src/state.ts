/**
 * Tiny app store: session + selectedSimei. Plain object + listener set; no
 * external state library. Components subscribe with useAppState().
 *
 * Session lifecycle: the login screen installs a session with setSession();
 * client.logout() and the stale-sid path (errcode 268697631) tear it down
 * with clearSession(). A teardown may carry a notice for the login screen.
 */

import { useEffect, useState } from 'preact/hooks';
import type { Session } from './api/types';

/** Login-screen notice for the stale-sid path (errcode 268697631). */
export const SESSION_EXPIRED_NOTICE = 'session expired, please sign in';

/** Who signed in and when; set alongside the session by the login screen. */
export interface SessionMeta {
  account: string;
  /** Unix ms when the current session was established. */
  loginAt: number;
}

export interface AppState {
  session: Session | null;
  sessionMeta: SessionMeta | null;
  /** Login-screen notice (e.g. SESSION_EXPIRED_NOTICE); cleared by setSession(). */
  sessionNotice: string | null;
  selectedSimei: string | null;
  /** simei → friendly name (car_number, or "Device <imei>"). */
  deviceNames: Record<string, string>;
}

/**
 * Session identity survives a page reload. api/client.ts owns its own
 * 'qxgps.session' key for restoring the session itself; this key is ours and
 * holds only the account + login time — never a password.
 */
const META_KEY = 'qxgps.sessionMeta';
const SELECTED_KEY = 'qxgps.selectedSimei';
const NAMES_KEY = 'qxgps.deviceNames';

function loadSelected(): string | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    return raw && raw !== '' ? raw : null;
  } catch {
    return null;
  }
}

function loadNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value !== '') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function loadMeta(): SessionMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      const { account, loginAt } = parsed as Partial<SessionMeta>;
      if (typeof account === 'string' && typeof loginAt === 'number') {
        return { account, loginAt };
      }
    }
  } catch {
    // Unreadable or unavailable storage — the app works without it.
  }
  return null;
}

function saveMeta(meta: SessionMeta | null): void {
  try {
    if (meta) {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } else {
      localStorage.removeItem(META_KEY);
    }
  } catch {
    // Storage unavailable (private mode, quota) — ignore.
  }
}

let state: AppState = {
  session: null,
  sessionMeta: loadMeta(),
  sessionNotice: null,
  selectedSimei: loadSelected(),
  deviceNames: loadNames(),
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Install the session (passing null drops it). A successful sign-in passes the
 * account + login time; omitting `meta` keeps whatever is already stored, so
 * client-side session re-hydration never wipes it.
 */
export function setSession(session: Session | null, meta?: SessionMeta | null): void {
  const sessionMeta = session === null ? null : meta === undefined ? state.sessionMeta : meta;
  saveMeta(sessionMeta);
  setState({ session, sessionMeta, sessionNotice: null });
}

/**
 * Drop the session (local only — never a vendor call). An optional notice is
 * shown on the login screen, e.g. SESSION_EXPIRED_NOTICE after a stale sid.
 * The selected device and remembered names are account-scoped and are dropped
 * too: the previous account's simei must not leak into the next account's
 * queries.
 */
export function clearSession(notice?: string): void {
  saveMeta(null);
  try {
    localStorage.removeItem(SELECTED_KEY);
    localStorage.removeItem(NAMES_KEY);
  } catch {
    // Storage unavailable — the in-memory clear still applies.
  }
  setState({
    session: null,
    sessionMeta: null,
    sessionNotice: notice ?? null,
    selectedSimei: null,
    deviceNames: {},
  });
}

export function setSelectedSimei(simei: string | null): void {
  try {
    if (simei) localStorage.setItem(SELECTED_KEY, simei);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    // Storage unavailable — the choice still holds for this visit.
  }
  setState({ selectedSimei: simei });
}

/** Remember friendly names from a GetRunInfo (or similar) device list. */
export function rememberDevices(
  items: ReadonlyArray<{ simei: string; car_number: string; imei: number }>,
): void {
  const next = { ...state.deviceNames };
  let changed = false;
  for (const item of items) {
    if (!item.simei) continue;
    const trimmed = item.car_number.trim();
    const label = trimmed !== '' ? trimmed : `Device ${item.imei}`;
    if (next[item.simei] !== label) {
      next[item.simei] = label;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  setState({ deviceNames: next });
}

/** Subscribe a component to the store; re-renders on every change. */
export function useAppState(): AppState {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
