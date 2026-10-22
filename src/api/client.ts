/**
 * mapi transport + typed read-only API surface for the QXGPS trackers.
 *
 * SAFETY POLICY (hard requirement — never relax):
 * this module is READ-ONLY toward the vendor platform. Only login plus Get*
 * and get* calls are allowed. NEVER add a Set*, Add*, Del*, BatchCmd,
 * setSimCmd, write, command or mark-read call here or anywhere in the tree.
 *
 * Every envelope here is VERIFIED against docs/protocol-notes.md (live
 * session 2026-10-04; §1 login, §3 session, §4 read calls, §5 probe notes)
 * and docs/protocol-notes.md (pcap-decoded payload shapes). All three
 * feature surfaces are resolved on the wire (captured 2026-10-04; verbatim
 * request/response pairs documented in docs/protocol-notes.md):
 * getFences → fence.Get, getTrack → location.QueryLocation, getAlarms →
 * alarm.Get (with `simei` as a one-element array).
 *
 * Only rpc() talks to the wire.
 */

import {
  AlarmItem,
  AlarmListResponse,
  AlarmQuery,
  AlarmTypeListResponse,
  ContactResponse,
  DeviceConfig,
  DeviceDetail,
  DeviceListResponse,
  ERR_SESSION_EXPIRED,
  ExpireImeiResponse,
  FamilyInfo,
  FenceItem,
  FenceListResponse,
  LoginResponse,
  MapiEnvelope,
  MapiError,
  parseFenceItems,
  RunInfoResponse,
  Session,
  SessionExpiredError,
  SimResponse,
  TrackDay,
  TrackPoint,
  QueryTrackDateResponse,
  TrackQueryResponse,
} from './types';
import { mapQueryLocationPoint } from '../lib/track';
import { clearSession, getState, SESSION_EXPIRED_NOTICE, setSession } from '../state';
import { md5 } from '../lib/md5';

/**
 * Vendor mapi endpoint.
 *
 * Default: https://www.gps666.net/mapi — the official web portal's endpoint.
 * It answers HTTPS with `Access-Control-Allow-Origin: *` and allows
 * `Content-Type` on preflight, so a page can read the JSON without a relay.
 * The browser attaches its own Origin and User-Agent; that is accepted.
 *
 * Build-time override: VITE_MAPI_URL. Set it to `/mapi` for the bundled
 * same-origin relay (server/relay.mjs), which strips the browser headers and
 * replays the request with the vendor Dart app's exact header set. A relative
 * URL is safe here: the service-worker's navigation fallback already denies
 * /^\/mapi/ and /^\/rvsgeo/.
 */
const envMapiUrl = import.meta.env?.VITE_MAPI_URL;
export const MAPI_URL =
  typeof envMapiUrl === 'string' && envMapiUrl !== ''
    ? envMapiUrl
    : 'https://www.gps666.net/mapi';

/** Abort a request that takes longer than this. */
const RPC_TIMEOUT_MS = 15_000;

/**
 * Merchant / white-label id for QXHL (docs/protocol-notes.md §0-§1).
 * This is NOT a login-method enum: the web portal's bundled config sends
 * type:58 for this white-label, and type:2 fails every login with
 * 268697633 "Account not registered" even with correct credentials.
 */
export const MERCHANT_TYPE = 58;

/**
 * localStorage key holding the persisted session
 * ({sid, familyid, uid, account} only — the password is NEVER persisted).
 */
const SESSION_STORAGE_KEY = 'qxgps.session';

/**
 * This browser only. Lets a reload sign back in after the vendor sid expires.
 * Cleared by logout(). Never written to the repo.
 */
const CREDS_KEY = 'qxgps.credentials';

let reloginPromise: Promise<Session> | null = null;

/** Per-call transport options. */
interface RpcOptions {
  /** Internal: set on the single stale-sid retry. */
  retried?: boolean;
  /**
   * false sends the request without ?sid= regardless of the loaded session —
   * required by user.Login, which must not carry a stale sid. Other callers
   * are unaffected: unlike the old module-wide omitSid flag, concurrent
   * requests keep sending the current sid while a login is in flight.
   */
  withSession?: boolean;
}
/**
 * Transport helper: POST {module, func, params} straight to the vendor HTTPS
 * mapi URL, appending the session as ?sid= when logged in. A normal browser
 * fetch — no header rewriting. Throws MapiError when errcode !== 0. On the
 * stale-sid errcode (268697631) it signs in again from this browser's stored
 * login once, then drops the session if that fails.
 *
 * `params` may be a thunk; it is evaluated per attempt so a stale-sid retry
 * re-reads rotating credentials (familyid/sfamily) from the fresh session.
 *
 * The browser sets content-type plus its own Origin, User-Agent and
 * Sec-Fetch-* headers. The vendor HTTPS endpoint allows that (CORS *).
 */
export async function rpc<T extends MapiEnvelope = MapiEnvelope>(
  module: string,
  func: string,
  params: Record<string, unknown> | (() => Record<string, unknown>) = {},
  opts: RpcOptions = {},
): Promise<T> {
  const session = opts.withSession === false ? null : getSession();
  const url = session
    ? `${MAPI_URL}?sid=${encodeURIComponent(session.sid)}`
    : MAPI_URL;

  const paramsNow = typeof params === 'function' ? params() : params;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ module, func, params: paramsNow }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`mapi http ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as unknown;
    if (body === null || typeof body !== 'object') {
      throw new Error('mapi response is not a JSON object');
    }
    const envelope = body as MapiEnvelope;
    if (typeof envelope.errcode !== 'number') {
      throw new Error('mapi response is missing errcode');
    }
    if (envelope.errcode !== 0) {
      const message = String(envelope.error_message ?? '');
      if (envelope.errcode === ERR_SESSION_EXPIRED && opts.withSession !== false) {
        // Stale sid. If this browser kept the login, sign in again once and
        // retry the read. Otherwise drop the session so the shell shows login.
        // A withSession:false request carries no sid, so this code is an
        // ordinary MapiError for it — never a reason to drop the session.
        if (!opts.retried && loadCredentials()) {
          try {
            await reloginOnce();
            return rpc(module, func, params, { retried: true });
          } catch {
            // Stored login failed — fall through and show the login screen.
          }
        }
        storeSession(null);
        clearSession(SESSION_EXPIRED_NOTICE);
        throw new SessionExpiredError(message);
      }
      throw new MapiError(envelope.errcode, message);
    }
    return body as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`mapi request timed out after ${RPC_TIMEOUT_MS}ms: ${module}.${func}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Session persistence — localStorage 'qxgps.session'                  */
/* ------------------------------------------------------------------ */

/**
 * Persist the session (or clear it with null). Only {sid, familyid, uid,
 * account} is written — the password is memory-only and must never be stored.
 * Storage failures (private mode, quota) degrade to in-memory sessions.
 */
function storeSession(session: Session | null): void {
  try {
    if (session === null) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        sid: session.sid,
        familyid: session.familyid,
        uid: session.uid,
        account: session.account,
      }),
    );
  } catch {
    // storage unavailable — the in-memory session still works for this tab
  }
}

/** Read back a persisted session; returns null when absent or unparsable. */
function restoreStoredSession(): Session | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.sid !== 'string' || rec.sid === '') return null;
    return {
      sid: rec.sid,
      familyid: typeof rec.familyid === 'string' && rec.familyid !== '' ? rec.familyid : undefined,
      uid: typeof rec.uid === 'string' && rec.uid !== '' ? rec.uid : undefined,
      account: typeof rec.account === 'string' && rec.account !== '' ? rec.account : undefined,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/**
 * Stable account uid = sid field A (docs/protocol-notes.md §3.1): the sid
 * is unpadded base64 of
 * "<19-digit id>_<login unix s>_<1>_<earlier unix s>_<per-login id>"; field A
 * also matches the jpush "uid_<A>_<ts>" id. Undefined when undecodable.
 */
function uidFromSid(sid: string): string | undefined {
  try {
    const padded = sid + '='.repeat((4 - (sid.length % 4)) % 4);
    const first = atob(padded).split('_')[0];
    return /^\d{15,}$/.test(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

function loadCredentials(): { account: string; password: string } | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.account !== 'string' || rec.account === '') return null;
    if (typeof rec.password !== 'string' || rec.password === '') return null;
    return { account: rec.account, password: rec.password };
  } catch {
    return null;
  }
}

function saveCredentials(account: string, password: string): void {
  try {
    localStorage.setItem(CREDS_KEY, JSON.stringify({ account, password }));
  } catch {
    // Storage unavailable — the in-memory session still works this visit.
  }
}

function clearCredentials(): void {
  try {
    localStorage.removeItem(CREDS_KEY);
  } catch {
    // ignore
  }
}

/** Account remembered on this browser, for the login form. Never the password. */
export function rememberedAccount(): string {
  return loadCredentials()?.account ?? '';
}

export function hasStoredCredentials(): boolean {
  return loadCredentials() !== null;
}

/**
 * Native (Tauri) background monitor only — reads the same stored login the PWA
 * uses for silent re-login. Never log or display the returned password.
 */
export function credentialsForNativeMonitor(): { account: string; password: string } | null {
  return loadCredentials();
}

function reloginOnce(): Promise<Session> {
  const creds = loadCredentials();
  if (!creds) return Promise.reject(new Error('no stored login'));
  if (!reloginPromise) {
    reloginPromise = login(creds.account, creds.password).finally(() => {
      reloginPromise = null;
    });
  }
  return reloginPromise;
}

/** Sign in again from this browser's stored login when no session is loaded. */
export async function restoreLogin(): Promise<boolean> {
  if (getState().session) return true;
  if (!hasStoredCredentials()) return false;
  try {
    await reloginOnce();
    return true;
  } catch {
    return false;
  }
}

/**
 * Log in (docs/protocol-notes.md §1-§2, VERIFIED). The account is sent as
 * the FULL email with the local part lowercased and the domain kept; pwd_md5
 * is the unsalted lowercase-hex MD5 of the trimmed password. familyid is
 * taken from THIS response's familys[0].sid because it rotates per login (§3.2).
 *
 * On success the account and password are kept in this browser's localStorage
 * so a later reload can sign in again. logout() deletes them.
 */
export async function login(email: string, password: string): Promise<Session> {
  const trimmedEmail = email.trim();
  const at = trimmedEmail.indexOf('@');
  const account =
    at === -1
      ? trimmedEmail.toLowerCase()
      : `${trimmedEmail.slice(0, at).toLowerCase()}@${trimmedEmail.slice(at + 1)}`;
  const trimmedPassword = password.trim();

  // Login must not send a stale ?sid= (§1) — suppressed per call, without
  // clearing the UI session, so a silent re-login does not flash the form and
  // concurrent reads keep using the current sid.
  const res = await rpc<LoginResponse>(
    'user',
    'Login',
    {
      account,
      pwd_md5: md5(trimmedPassword),
      info: '',
      lang: 'en',
      platform: 'web',
      type: MERCHANT_TYPE,
    },
    { withSession: false },
  );

  const session: Session = {
    sid: res.sid,
    familyid: res.familys?.[0]?.sid,
    uid: uidFromSid(res.sid),
    account,
    familys: res.familys,
    flag: res.flag,
    auth: res.auth,
  };
  saveCredentials(account, trimmedPassword);
  storeSession(session);
  setSession(session, { account: trimmedEmail, loginAt: Date.now() });
  return session;
}

/**
 * Current session: the in-memory one, or restored from localStorage
 * ('qxgps.session'). A restore hydrates the store so rpc() and the UI both
 * see it. Eagerly hydrated at module load below so a PWA reload comes back
 * logged in before first render.
 */
export function getSession(): Session | null {
  const current = getState().session;
  if (current) return current;
  const restored = restoreStoredSession();
  if (restored) setSession(restored);
  return restored;
}

/**
 * Local drop ONLY: clears the store and the persisted session. The vendor's
 * user/LoginOut is deliberately NOT called — the server-side session is left
 * to expire on its own (hard read-only policy).
 */
export function logout(): void {
  clearCredentials();
  storeSession(null);
  clearSession();
}

// Eager session restore for app startup (see getSession).
getSession();

/* ------------------------------------------------------------------ */
/* Read-only device/family API (docs/protocol-notes.md §4, VERIFIED) */
/* ------------------------------------------------------------------ */

/** familyid = familys[0].sid captured at login (rotates per login, §3.2). */
function requireFamilyId(): string {
  const familyid = getSession()?.familyid;
  if (!familyid) {
    throw new Error('not logged in or missing familyid — call login() first');
  }
  return familyid;
}

/**
 * family.GetFamilyList (§4 row 3). `familyid` must be non-empty — an empty
 * one is rejected with 268697607 Invalid parameter.
 */
export async function getFamilyList(): Promise<FamilyInfo> {
  // Params thunk: familyid is re-read on the stale-sid retry so the rotated
  // post-re-login token is used, not the dead one.
  return rpc<FamilyInfo>('family', 'GetFamilyList', () => ({
    f_limit_size: 0,
    familyid: requireFamilyId(),
    g_limit_size: 100,
    get_all: true,
    last_fid: '',
    last_gid: '',
  }));
}

/** family.GetExpireImei (§4 row 4). */
export async function getExpireImei(): Promise<ExpireImeiResponse> {
  return rpc<ExpireImeiResponse>('family', 'GetExpireImei', () => ({
    familyid: requireFamilyId(),
  }));
}

/** family.GetRunInfo — live polling state (§4 row 5). */
export async function getRunInfo(): Promise<RunInfoResponse> {
  return rpc<RunInfoResponse>('family', 'GetRunInfo', () => ({
    call_all_dev: true,
    call_simei: null,
    limit_size: 200,
    sfamily: requireFamilyId(),
  }));
}

/** family.GetDeviceList (§4 row 6). */
export async function getDeviceList(): Promise<DeviceListResponse> {
  return rpc<DeviceListResponse>('family', 'GetDeviceList', () => ({
    get_increment: true,
    get_total: true,
    familyid: requireFamilyId(),
    is_get_sim: false,
    limit_size: 20,
    is_get_follow: true,
    state: null,
  }));
}

/** device.GetDetail (§4 row 7). */
export async function getDetail(simei: string): Promise<DeviceDetail> {
  return rpc<DeviceDetail>('device', 'GetDetail', {
    get_additional: false,
    get_increment: true,
    is_get_follow: true,
    get_user: false,
    is_get_wx: true,
    simei,
  });
}

/** device.GetConfig, full config dump (§4 row 8). */
export async function getConfig(simei: string): Promise<DeviceConfig> {
  return rpc<DeviceConfig>('device', 'GetConfig', {
    simei,
    type: 'e_config_all',
  });
}

/**
 * sim.Get (§4 row 9). On this account the call answers 269877305 "SIM dealer
 * mismatch" — that is device/SIM state, not a bug; the MapiError message is
 * surfaced as-is for the UI to show.
 */
export async function simGet(iccid: string, simei: string): Promise<SimResponse> {
  return rpc<SimResponse>('sim', 'Get', { iccid, simei });
}

/** family.GetContact — seller contact (§4 row 10). */
export async function getContact(simei: string): Promise<ContactResponse> {
  return rpc<ContactResponse>('family', 'GetContact', { simei });
}

/**
 * alarm.GetAlarmTypeList — account alarm-type taxonomy
 * (LIVE PROBE 2026-10-04: module `alarm`, params `{}` or `{"simei"}` both
 * answer errcode 0; resolves the name left open in §5).
 */
export async function getAlarmTypes(simei?: string): Promise<AlarmTypeListResponse> {
  return rpc<AlarmTypeListResponse>('alarm', 'GetAlarmTypeList', simei ? { simei } : {});
}

/* ------------------------------------------------------------------ */
/* History track + alarm list (wire CAPTURED 2026-10-04)               */
/* ------------------------------------------------------------------ */

/**
 * QueryLocation page size: the server accepts 2000 and rejects 5000 with
 * 268697607; pages come back full with is_finish:false until the range is
 * exhausted (docs/protocol-notes.md §1.2).
 */
const TRACK_PAGE_SIZE = 2000;

/** Safety bound on pagination: 25 pages × 2000 = 50k points per request. */
const TRACK_MAX_PAGES = 25;

/** Vendor day boundaries are UTC+8 midnights (QueryTrackDate epochs). */
const VENDOR_DAY_OFFSET_S = 8 * 3600;

/** alarm.Get defaults: 90-day window (the captured range), 20-row list. */
const DEFAULT_ALARM_SPAN_S = 90 * 24 * 3600;
const DEFAULT_ALARM_LIMIT = 20;

/**
 * History track between two unix timestamps (seconds).
 *
 * RESOLVED — wire capture 2026-10-04 (verbatim pairs in
 * docs/protocol-notes.md § history track):
 *   → {"module":"location","func":"QueryLocation","params":{"simei":"<SIMEI>",
 *      "time_begin":1783369200,"time_end":1791145200,"limit_size":100}}
 *   ← {"data":[{"duration":0,"end_time":0,"lat":51501000,"lon":-121000,
 *      "ptype":0,"time":1788623103,"type":2,"wgs":"51.501000,-0.121000"}, …],
 *      "errcode":0,"error_message":"QueryLocation succeed.","is_finish":false}
 * Points arrive time-ascending; pages continue via time_begin = last.time + 1
 * while is_finish is false. (record.GetRecord — the name earlier probes guessed
 * — is the sound-recording feature, not track history.)
 */
export async function getTrack(simei: string, start: number, end: number): Promise<TrackDay[]> {
  const points: TrackPoint[] = [];
  let cursor = start;
  for (let page = 0; page < TRACK_MAX_PAGES; page++) {
    const res = await rpc<TrackQueryResponse>('location', 'QueryLocation', {
      simei,
      time_begin: cursor,
      time_end: end,
      limit_size: TRACK_PAGE_SIZE,
    });
    const batch = res.data ?? [];
    for (const w of batch) points.push(mapQueryLocationPoint(w));
    if (res.is_finish || batch.length === 0) break;
    cursor = batch[batch.length - 1].time + 1;
  }
  // Source order is time-ascending, so each vendor day is one contiguous group.
  const days: TrackDay[] = [];
  for (const p of points) {
    // Vendor day boundary is UTC+8 midnight (QueryTrackDate day epochs).
    const date = new Date((p.time + VENDOR_DAY_OFFSET_S) * 1000).toISOString().slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.date === date) last.points.push(p);
    else days.push({ date, points: [p] });
  }
  return days;
}

/**
 * Alarm history for a device.
 *
 * RESOLVED — wire capture 2026-10-04, cross-validated against the vendor
 * app's Alarm-message tab (verbatim pair in
 * docs/protocol-notes.md § alarms):
 *   → {"module":"alarm","func":"Get","params":{"limit_size":20,
 *      "start_time":1783369200,"end_time":1791145200,"simei":["<SIMEI>"]}}
 *   ← {"errcode":0,"error_message":"Get succeed.","items":[{"addr":
 *      "51.503000,-0.123000","alarm_name":"Equipment reset alarm",
 *      "car_number":"Car","devspeed":10,"fencename":"","imei":
 *      10000000002,"simei":"<SIMEI>","time":1790006361,"type":
 *      "e_alarm_remove_out"}, …],"last_fencename":"","last_imei":
 *      10000000002,"last_time":1788623367,"last_type":
 *      "e_alarm_power_cut_off","total":2}
 * `simei` MUST be sent as a one-element array — a bare string answers
 * 268697648 (the type shape, not the key name, was the old blocker).
 */
export async function getAlarms(simei: string, opts: AlarmQuery = {}): Promise<AlarmItem[]> {
  const end = opts.end ?? Math.floor(Date.now() / 1000);
  const start = opts.start ?? end - DEFAULT_ALARM_SPAN_S;
  const res = await rpc<AlarmListResponse>('alarm', 'Get', {
    simei: [simei],
    limit_size: opts.limit ?? DEFAULT_ALARM_LIMIT,
    start_time: start,
    end_time: end,
  });
  // Map each wire row onto the field names screens/alarms.tsx reads; `id` is
  // derived (the wire has no row id), is_read/photos are not carried by alarm.Get.
  return (res.items ?? []).map((w) => ({
    id: `${w.imei}-${w.time}-${w.type}`,
    alarm_type: w.type,
    send_time: w.time,
    record_time: w.time,
    content: w.alarm_name,
    message: w.addr,
    addr: w.addr,
    car_number: w.car_number,
    imei: w.imei,
    simei: w.simei,
    devspeed: w.devspeed,
    fencename: w.fencename,
  }));
}

/**
 * Geofence list for a device.
 *
 * RESOLVED (live probe 2026-10-04; verbatim capture):
 *   → {"module":"fence","func":"Get","params":{"simei":"<SIMEI>"}}
 *   ← {"errcode":0,"error_message":"Get succeed."}
 * Both test devices answer exactly this bare envelope (zero fences configured
 * on the account), so the wire ITEM shape is still PENDING — parseFenceItems()
 * handles the response defensively and passes raw item keys through. Item
 * fields on FenceItem are Dart-string candidates only until a device with
 * fences is captured.
 */
export async function getFences(simei: string): Promise<FenceItem[]> {
  return parseFenceItems(await rpc<FenceListResponse>('fence', 'Get', { simei }));
}

/**
 * Per-day mileage calendar (location.QueryTrackDate). Only `simei` is accepted
 * on the wire; `items[].date` is a UTC+8 midnight unix second and
 * `distance` is metres (vendor field; verified on sample captures).
 */
export async function getTrackCalendar(
  simei: string,
): Promise<Array<{ date: string; distanceMeters: number }>> {
  const res = await rpc<QueryTrackDateResponse>('location', 'QueryTrackDate', { simei });
  const rows = res.items ?? [];
  return rows.map((row) => ({
    date: new Date((row.date + VENDOR_DAY_OFFSET_S) * 1000).toISOString().slice(0, 10),
    distanceMeters: row.distance,
  }));
}
