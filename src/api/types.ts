/**
 * Types for the QXGPS vendor "mapi" JSON API.
 *
 * Every shape below is grounded in docs/protocol-notes.md — summarised
 * interoperability research: decoded pcap frames 65-1484 of the vendor app
 * com.flu.qxhlgg 6.41.6 plus live-verified envelopes (2026-10-04). Shapes
 * captured by the 2026-10-04 bounded live probe are marked
 * `LIVE PROBE 2026-10-04`. Fields the research has NOT captured are explicitly
 * marked `PENDING: schema not yet verified`.
 *
 * READ-ONLY SAFETY: this module (and the whole tree) must never model or call a
 * vendor Set*, Add*, Del*, BatchCmd, setSimCmd, write, command or mark-read
 * function.
 */

/* ------------------------------------------------------------------ */
/* Transport envelope                                                  */
/* ------------------------------------------------------------------ */

/** Envelope carried by every mapi response (spread over the payload). */
export interface MapiEnvelope {
  errcode: number;
  error_message: string;
}

/**
 * Error-code legend (VERIFIED by live probes, docs/protocol-notes.md §4;
 * codes below the line discovered by the bounded live probe 2026-10-04).
 *
 * - 268697607 Invalid parameter — (module,func) exists, params wrong/missing.
 * - 268697608 Failed to call background logic service — pair exists (empty
 *   params reach the backend) but the call failed server-side.
 * - 268697610 User does not have permission — pair exists, account may not use it.
 * - 268697628 no sid / unknown (module,func) without sid.
 * - 268697631 stale sid — session expired, re-login.
 * - 268697633 account lookup failed (wrong account or wrong merchant type).
 * - 268697648 unknown (module,func) with a valid sid — ALSO returned when a
 *   request carries a param key outside the func's schema, so name-existence
 *   probes must send `{}` params to be conclusive.
 * - 269877305 SIM dealer mismatch — device/SIM state, not an envelope problem.
 */
export const ERR_SESSION_EXPIRED = 268697631;

/** Thrown by the rpc() transport when the vendor returns errcode !== 0. */
export class MapiError extends Error {
  readonly errcode: number;
  readonly error_message: string;

  constructor(errcode: number, error_message: string) {
    super(`mapi error ${errcode}: ${error_message}`);
    this.name = 'MapiError';
    this.errcode = errcode;
    this.error_message = error_message;
  }
}

/**
 * Typed stale-sid failure (errcode 268697631): rpc() drops the stored session
 * and surfaces this so the shell can re-login. NEVER auto-retried with
 * credentials — the client does not keep the password.
 */
export class SessionExpiredError extends MapiError {
  constructor(error_message = 'Login status has expired, please login again') {
    super(ERR_SESSION_EXPIRED, error_message);
    this.name = 'SessionExpiredError';
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/**
 * user.Login response (docs/protocol-notes.md §1, VERIFIED keys on the
 * test account: auth, errcode, error_message, familys, flag, is_check_email,
 * is_check_phone, is_need_check, is_register_phone, jpush, push_switch, sid,
 * zone). Unknown extra keys pass through untouched.
 */
export interface LoginResponse extends MapiEnvelope {
  /** Unpadded base64 session token; passed as ?sid= on every later call. */
  sid: string;
  familys?: SessionFamily[];
  flag?: string[];
  auth?: string[];
  zone?: number;
  /** "uid_<19-digit id>_<ms timestamp>". */
  jpush?: string;
  push_switch?: boolean;
  is_check_email?: boolean;
  is_check_phone?: boolean;
  is_need_check?: boolean;
  is_register_phone?: boolean;
}

/**
 * One entry of the login response's `familys[]` (docs/protocol-notes.md
 * §1, VERIFIED). `sid` here is the *familyid* — it ROTATES between logins, so
 * always take it from the current login response, never hardcode it (§3.2).
 */
export interface SessionFamily {
  auth?: string[];
  imei_count?: number;
  /** Family token used as familyid/sfamily in calls. Rotates per login. */
  sid: string;
  sname?: string;
  type?: string;
}

/**
 * A logged-in session (docs/protocol-notes.md §1, §3, VERIFIED). `sid` is
 * appended to every mapi URL as `?sid=<sid>` and is unpadded base64 of
 * "<19-digit account id>_<login unix s>_<1>_<earlier unix s>_<per-login id>".
 *
 * `account`, `familys`, `flag`, `auth` are passthrough identity/capability
 * fields from the login response (all optional). The persisted form
 * (localStorage 'qxgps.session') keeps only {sid, familyid, uid, account} —
 * the password is NEVER stored anywhere.
 */
export interface Session {
  sid: string;
  familyid?: string;
  /** Stable 19-digit account id (sid field A / jpush uid). */
  uid?: string;
  /** Normalised login account (local part lowercased). */
  account?: string;
  familys?: SessionFamily[];
  flag?: string[];
  auth?: string[];
}

/* ------------------------------------------------------------------ */
/* last_pos — position blob, string-encoded JSON                       */
/* ------------------------------------------------------------------ */

/**
 * Fix source of a position. Verified values: e_static_gps, e_wifi,
 * e_static_wifi, e_static_lbs, e_lbs; the vendor may emit more.
 */
export type LastPosType =
  | 'e_static_gps'
  | 'e_wifi'
  | 'e_static_wifi'
  | 'e_static_lbs'
  | 'e_lbs'
  | (string & {});

/** Ptype of a position; verified value: e_location_same. */
export type LastPosPType = 'e_location_same' | (string & {});

/**
 * The `last_pos` blob (VERIFIED frames 996, 1023, 1051, 1076, 1093, 1109,
 * 1292, 1425). In models it is carried as a STRING-encoded JSON value —
 * use parseLastPos() to decode it.
 */
export interface LastPos {
  /** Reverse-geocoded address; often empty. */
  addr: string;
  /** Latitude in degrees × 1e6 (51500000 → 51.500000°). */
  lat: number;
  /** Longitude in degrees × 1e6 (-120000 → -0.278457°). */
  lon: number;
  ptype: LastPosPType;
  /** Unix timestamp of the fix. */
  time: number;
  type: LastPosType;
  /** WGS84 decimal degrees as "lat,lon". */
  wgs: string;
}

/** Decode the string-encoded `last_pos` field; returns null when unparsable. */
export function parseLastPos(raw: string): LastPos | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as LastPos;
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Device state enums                                                  */
/* ------------------------------------------------------------------ */

/** Verified: e_line_sleep, e_line_on; the vendor may emit more. */
export type DeviceState = 'e_line_sleep' | 'e_line_on' | (string & {});

/** Verified: e_mode_nomal. */
export type DeviceMode = 'e_mode_nomal' | (string & {});

/** Verified: e_sex_man. */
export type UserSex = 'e_sex_man' | (string & {});

/** Verified: e_acc_power_interuupt. */
export type AccPower = 'e_acc_power_interuupt' | (string & {});

/** Verified: e_acc_empty. */
export type AccState = 'e_acc_empty' | (string & {});

/* ------------------------------------------------------------------ */
/* GetRunInfo (family.GetRunInfo)                                      */
/* ------------------------------------------------------------------ */

/** VERIFIED item shape of family.GetRunInfo (frames 996, 1093, 1425). */
export interface DeviceSummary {
  car_image: number;
  car_number: string;
  expire: boolean;
  iccid: string;
  /** Vendor encodes IMEI as a number (10000000001 — exceeds 2^32). */
  imei: number;
  last_com_time: number;
  /** String-encoded JSON; decode with parseLastPos(). */
  last_pos: string;
  power: number;
  /** Opaque base64 device token (the device identifier for API calls). */
  simei: string;
  state: DeviceState;
  version: string;
}

/** family.GetRunInfo response (frames 996, 1093, 1425). */
export interface RunInfoResponse extends MapiEnvelope {
  is_all: boolean;
  items: DeviceSummary[];
  /**
   * Polling cursor echoed on incremental polls.
   * PENDING: schema not yet verified (symbol realtimeid at 0x16a72e, no
   * response in the trace contains it).
   */
  realtimeid?: number | string;
}

/* ------------------------------------------------------------------ */
/* GetDetail (device.GetDetail)                                        */
/* ------------------------------------------------------------------ */

/** `detail` sub-object of device.GetDetail (frames 1023, 1051, ...). */
export interface DeviceDetailInfo {
  bck_phone: string;
  car_image: number;
  car_number: string;
  car_type: string;
  /** Far-future timestamp = device data-plan expiry. */
  end_dev_time: number;
  engine_num: string;
  frame_num: string;
  mode: DeviceMode;
  start_dev_time: number;
  user_addr: string;
  user_cer: string;
  user_mail: string;
  user_name: string;
  user_phone: string;
  user_sex: UserSex;
  user_unit: string;
}

/** device.GetDetail response (frames 1023-1484). */
export interface DeviceDetail extends MapiEnvelope {
  acc_power: AccPower;
  acc_state: AccState;
  /** Vendor sends null in the trace; non-null shape unknown. */
  additional: unknown;
  altitude: number;
  bind_phone: string;
  /** Present only with get_additional:true. */
  bind_seller_gname?: string;
  bind_time: number;
  /** Present only with get_additional:true. */
  bind_user_name?: string[];
  center_phone: string;
  day_distance: number;
  detail: DeviceDetailInfo;
  /** Present only once the device has gone offline at least once. */
  down_line_time?: number;
  enable_time: number;
  expire: boolean;
  /** With unit, e.g. "0V". */
  external_voltage: string;
  h5_domain: string;
  h5_domain_new: string;
  history: number;
  iccid: string;
  imei: number;
  last_com_time: number;
  /** String-encoded JSON; decode with parseLastPos(). */
  last_pos: string;
  mode_fun: string;
  power: number;
  /** 2 = JT/T808-2013. */
  protocol: number;
  protocol_name: string;
  record: number;
  signa_type: number;
  signa_val: number;
  /** 0-100 signal strength value. */
  signal_rate: number;
  start_dev_time: number;
  state: DeviceState;
  state_begin_time: number;
  /** Seconds elapsed since state_begin_time; increments between polls. */
  state_time: number;
  streetscape: number;
  up_line_time: number;
  /** Same value as `version` in the trace ("D9-A"). */
  ver: string;
  version: string;
}

/* ------------------------------------------------------------------ */
/* GetConfig (device.GetConfig)                                        */
/* ------------------------------------------------------------------ */

/**
 * `config.car_switch` — VERIFIED keys (frames 1032, 1087, 1410, 1436, 1447):
 * accalarm, alarmswitch, closeswitch, disconnswitch, dropalarm, fenceswitch,
 * indicatorlight, lbsswitch, lowpower, lowpowermodeswitch, offswitch,
 * openswitch, protect, rechage_sim, replaystate, reportloc, shakeswicth (sic),
 * sosswitch, soundswitch, speedswitch, statellite (sic), wifiswitch.
 * Values: 0/1, -1 presumably "default/not set" [INFERENCE].
 */
export type CarSwitch = Record<string, number>;

/** `config` sub-object of device.GetConfig. */
export interface DeviceConfigSection {
  after_sleep: number;
  alarm_space: number;
  car_switch: CarSwitch;
  dev_log: number;
  language: string;
  /** Positioning interval, seconds (600 = 10 min). */
  locint_val: number;
  pdis: number;
  phone_book: string;
  shake_value: number;
  sleep_intval: number;
  speed_value: number;
}

/** device.GetConfig response (frames 1032, 1087, 1410, 1436, 1447). */
export interface DeviceConfig extends MapiEnvelope {
  cmd_read: string[];
  cmd_type: string[];
  config: DeviceConfigSection;
  force_replay: number;
  history: number;
  is_open_chat: number;
  mode_fun: string;
  monitor: number;
  ontime_switch: number;
  open_push: number;
  phone_alarm: number;
  protocol: number;
  push_func: number;
  record: number;
  remoteswitch: number;
  shake_set: number;
  sms_msg: number;
  trace: number;
  track_add: number;
  vibration: number;
  volume: number;
}

/* ------------------------------------------------------------------ */
/* GetFamilyList / GetDeviceList (family.*)                            */
/* ------------------------------------------------------------------ */

/** Garage/group entry of family.GetFamilyList (frame 1098). */
export interface GarageInfo {
  imei_count: number;
  /** Opaque base64 group token (passed back as familyid/sfamily). */
  sid: string;
  sname: string;
}

/** family.GetFamilyList response (frame 1098). */
export interface FamilyInfo extends MapiEnvelope {
  /** Opaque base64 family token (passed back as sfamily/familyid). */
  familyid: string;
  familys_total: number;
  garages: GarageInfo[];
  garages_total: number;
  imei_count: number;
}

/** VERIFIED item shape of family.GetDeviceList (frames 1109, 1292). */
export interface DeviceListItem {
  bind_phone: string;
  bind_time: number;
  car_image: number;
  car_number: string;
  day_distance: number;
  end_dev_time: number;
  expire: boolean;
  family_name: string;
  groupname: string;
  iccid: string;
  imei: number;
  last_com_time: number;
  /** String-encoded JSON; decode with parseLastPos(). */
  last_pos: string;
  power: number;
  protocol: number;
  /** Opaque base64 group token. */
  sgid: string;
  signa_val: number;
  signal_rate: number;
  simei: string;
  start_dev_time: number;
  state: DeviceState;
  state_begin_time: number;
  state_time: number;
  version: string;
}

/** family.GetDeviceList response (frames 1109, 1292). */
export interface DeviceListResponse extends MapiEnvelope {
  all_total: number;
  down_total: number;
  items: DeviceListItem[];
  sleep_total: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/* Misc verified read responses                                        */
/* ------------------------------------------------------------------ */

/**
 * family.GetExpireImei response (docs/protocol-notes.md §4 row 4,
 * VERIFIED). Params: {"familyid"}.
 */
export interface ExpireImeiResponse extends MapiEnvelope {
  h5_domain: string;
  h5_domain_new: string;
}

/**
 * sim.Get response (docs/protocol-notes.md §4 row 9, VERIFIED envelope).
 * The success payload (SimMode symbol) was never captured — this account gets
 * errcode 269877305 (SIM dealer mismatch), which is device state, not a bug.
 * Parse defensively against the passthrough keys.
 */
export type SimResponse = MapiEnvelope & Record<string, unknown>;

/** `customer_phone` string-JSON of family.GetContact (docs/protocol-notes.md §4 row 10). */
export interface CustomerPhone {
  name: string;
  phone: string;
  wx: string;
  qq: string;
}

/**
 * family.GetContact response (docs/protocol-notes.md §4 row 10, VERIFIED).
 * `customer_phone` is a string-encoded JSON object — JSON.parse it into
 * CustomerPhone.
 */
export interface ContactResponse extends MapiEnvelope {
  customer_phone: string;
  sname: string;
}

/** One alarm-type taxonomy entry. */
export interface AlarmTypeItem {
  /** Display label, e.g. "Vibration alarm". */
  alarm_name: string;
  /** Stable type code; see the e_alarm_* list on AlarmItem.type. */
  alarm_type: string;
  /** Sort/priority weight (higher = more severe; 1..50 observed). */
  weight: number;
}

/**
 * alarm.GetAlarmTypeList response — LIVE PROBE 2026-10-04 (resolves the
 * GetAlarmTypeList name left open in docs/protocol-notes.md §5). Params:
 * `{}` or `{"simei"}`; both return the account-level taxonomy. 21 items on the
 * test account.
 */
export interface AlarmTypeListResponse extends MapiEnvelope {
  items: AlarmTypeItem[];
}

/* ------------------------------------------------------------------ */
/* History track — location.QueryLocation / location.QueryTrackDate    */
/* (wire CAPTURED 2026-10-04; verbatim pairs in                        */
/* docs/protocol-notes.md — history track)                               */
/* ------------------------------------------------------------------ */

/**
 * One raw track point on the wire (location.QueryLocation `data[]`).
 * CAPTURED 2026-10-04: `lat`/`lon` are integers ×1e6, `wgs` is the decimal
 * "lat,lon" string, `time` is unix seconds, `type` is a small int code
 * (1 = moving — carries `speed`/`direction`; 2 = static; 5 = event/stop;
 * code table only partly inferred from observed data), `ptype` int (0
 * observed), `duration`/`end_time` describe stops (0 on non-stop points).
 */
export interface TrackPointWire {
  duration: number;
  end_time: number;
  lat: number;
  lon: number;
  ptype: number;
  time: number;
  type: number;
  wgs: string;
  /** Degrees; moving points only. */
  direction?: number;
  /** Tenths of km/h (490 = 49 km/h); moving points only. */
  speed?: number;
}

/**
 * location.QueryLocation response — paged track points. `is_finish` false
 * means more pages exist (advance `time_begin` to last point time + 1).
 * `limit_size` cap is 2000 (5000 → 268697607).
 */
export interface TrackQueryResponse extends MapiEnvelope {
  data: TrackPointWire[];
  is_finish: boolean;
}

/**
 * location.QueryTrackDate response — per-day track calendar + mileage.
 * Day epochs are UTC+8 midnights (the vendor's day boundary).
 */
export interface QueryTrackDateResponse extends MapiEnvelope {
  date: number[];
  items: Array<{ date: number; distance: number }>;
}

/**
 * One normalised track point as produced by client.getTrack() and consumed by
 * lib/track.ts (its parsePoint accepts exactly these names).
 */
export interface TrackPoint {
  /** Unix seconds (wire `time`). */
  time: number;
  /** Decimal degrees (wire `lat`/1e6). */
  lat: number;
  /** Decimal degrees (wire `lon`/1e6). */
  lon: number;
  /** Wire point `type` code stringified ("1" moving, "2" static, "5" event). */
  type: string;
  /** Reverse-geocoded address when present (not carried by QueryLocation). */
  addr?: string;
  /** km/h. The wire value is tenths of km/h and is divided by 10 in the client. */
  speed?: number;
  /** Degrees (wire `direction`). */
  course?: number;
}

/**
 * One day of track points. getTrack() groups QueryLocation points into UTC+8
 * calendar days to match the vendor's day boundary.
 */
export interface TrackDay {
  /** "YYYY-MM-DD" of the vendor (UTC+8) day. */
  date: string;
  /** Points of this day in time-ascending source order. */
  points: TrackPoint[];
}

/* ------------------------------------------------------------------ */
/* Alarm list — alarm.Get (wire CAPTURED 2026-10-04; verbatim pair in  */
/* docs/protocol-notes.md — alarms)                                    */
/* ------------------------------------------------------------------ */

/**
 * One raw alarm row on the wire (alarm.Get `items[]`). `type` VALUES are the
 * alarm.GetAlarmTypeList taxonomy (LIVE PROBE 2026-10-04):
 * e_alarm_shake, e_alarm_speed, e_alarm_out_fence, e_alarm_in_fence,
 * e_alarm_lowpower, e_alarm_power_cut_off, e_alarm_dismantle, e_alarm_off_line,
 * e_alarm_displacement, e_alarm_speeding_end, e_alarm_stop_dev,
 * e_alarm_remove_lowpower, e_alarm_remove_out, e_alarm_sos, e_alarm_low_battery,
 * e_alarm_harsh_acceletation (sic), e_alarm_harsh_braking, e_alarm_sharp_crash,
 * e_alarm_sharp_turn, e_alarm_acc_on, e_alarm_sim.
 */
export interface AlarmItemWire {
  /** "lat,lon" decimal string, as displayed by the vendor app. */
  addr: string;
  /** Display label, e.g. "Power failure alarm". */
  alarm_name: string;
  car_number: string;
  /** Speed km/h at alarm time. */
  devspeed: number;
  fencename: string;
  imei: number;
  simei: string;
  /** Unix seconds. */
  time: number;
  /** e_alarm_* code; see the taxonomy above. */
  type: string;
}

/**
 * alarm.Get response. `total` is the row count; `last_*` form the paging
 * cursor when following pages (not needed for the ≤20-row UI).
 */
export interface AlarmListResponse extends MapiEnvelope {
  items: AlarmItemWire[];
  last_fencename: string;
  last_imei: number;
  last_time: number;
  last_type: string;
  total: number;
}

/**
 * One alarm row shaped for the Alarms screen — getAlarms() maps AlarmItemWire
 * onto the names screens/alarms.tsx reads (alarm_type/type,
 * send_time/record_time, content/message, is_read, photos). alarm.Get carries
 * no read-state or photo fields, so `is_read`/`photos` stay unset; `id` is
 * derived (the wire has no row id).
 */
export interface AlarmItem {
  /** Derived stable identity `<imei>-<time>-<type>`. */
  id: string;
  /** e_alarm_* code (wire `type`). */
  alarm_type: string;
  /** Unix seconds (wire `time`). */
  send_time: number;
  /** Same instant on this wire (wire `time`). */
  record_time: number;
  /** Display label (wire `alarm_name`). */
  content: string;
  /** Location line "lat,lon" (wire `addr`). */
  message: string;
  /** Not carried by alarm.Get. */
  is_read?: boolean;
  /** Not carried by alarm.Get. */
  photos?: string[];
  /** Raw wire extras passed through. */
  addr?: string;
  car_number?: string;
  imei?: number;
  simei?: string;
  devspeed?: number;
  fencename?: string;
}

/**
 * Query for client.getAlarms → alarm.Get params (wire CAPTURED 2026-10-04):
 * `simei` is sent as a ONE-ELEMENT ARRAY (a bare string answers 268697648 —
 * the type shape, not the key name, was the old blocker), plus
 * limit_size/start_time/end_time.
 */
export interface AlarmQuery {
  /** Unix seconds → wire `start_time` (default: now − 90 days). */
  start?: number;
  /** Unix seconds → wire `end_time` (default: now). */
  end?: number;
  /** Row cap → wire `limit_size` (default 20). */
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Geofences — fence.Get wire pair RESOLVED 2026-10-04 (item PENDING)   */
/* ------------------------------------------------------------------ */

/**
 * Geofence list response — fence.Get wire pair RESOLVED (LIVE PROBE
 * 2026-10-04), item shape PENDING. VERBATIM capture (both test devices answer
 * exactly this; the account has zero fences configured):
 *
 *   → {"module":"fence","func":"Get","params":{"simei":"<SIMEI>"}}
 *   ← {"errcode":0,"error_message":"Get succeed."}
 *
 * The success body carries NO list field when the device has no fences, so no
 * container/item key is verified yet — hence the passthrough typing and the
 * defensive parseFenceItems() below. Update both together with the first
 * capture from a device that actually has fences.
 */
export type FenceListResponse = MapiEnvelope & Record<string, unknown>;

/**
 * One geofence. PENDING: no fence item has ever been captured on the wire
 * (see FenceListResponse). The fields below are Dart-string candidates from
 * docs/protocol-notes.md §6 (`fenceId`, `fencename`, `fence_delay`,
 * `fence_shake_delay`, `last_fencename`; plus `del_type`, `is_del_gid` and
 * the e_type_circle/e_type_polygon/e_type_user/e_type_city/e_type_busness
 * enums) and are NOT verified against the wire. parseFenceItems() spreads
 * every raw vendor key through, so unknown fields survive untouched.
 */
export interface FenceItem {
  /** PENDING (Dart `fenceId`) — not seen on the wire yet. */
  fenceId: string | number | null;
  /** PENDING (Dart `fencename`) — not seen on the wire yet. */
  fencename: string | null;
  /** PENDING (Dart `fence_delay`) — not seen on the wire yet. */
  fence_delay: number | null;
  /** PENDING (Dart `fence_shake_delay`) — not seen on the wire yet. */
  fence_shake_delay: number | null;
  /** PENDING (Dart `last_fencename`) — not seen on the wire yet. */
  last_fencename: string | null;
  /** PENDING: every remaining vendor key passes through untyped. */
  [key: string]: unknown;
}

/** Candidate containers for the fence array in a fence.Get response (PENDING). */
const FENCE_LIST_KEYS = ['items', 'fences', 'ofences', 'fence_list', 'fences_list', 'list', 'data'] as const;

function fenceField(rec: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const v = rec[key];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

function normaliseFenceItem(value: unknown): FenceItem {
  const rec: Record<string, unknown> =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    ...rec,
    fenceId: fenceField(rec, ['fenceId', 'fence_id', 'id']),
    fencename: fenceField(rec, ['fencename', 'fence_name', 'name']),
    fence_delay: fenceField(rec, ['fence_delay', 'delay']),
    fence_shake_delay: fenceField(rec, ['fence_shake_delay', 'shake_delay']),
    last_fencename: fenceField(rec, ['last_fencename', 'lastName']),
  } as FenceItem;
}

/**
 * Pull the fence array out of a fence.Get response. The captured success body
 * is a bare envelope (zero fences → no list key on the wire), so containers
 * are guessed defensively: named candidates first (one wrapper level deep),
 * then any array-valued envelope field, else []. Never throws.
 */
export function parseFenceItems(raw: FenceListResponse): FenceItem[] {
  const rec = raw as Record<string, unknown>;
  for (const key of FENCE_LIST_KEYS) {
    const v = rec[key];
    if (Array.isArray(v)) return v.map(normaliseFenceItem);
    if (v !== null && typeof v === 'object') {
      const inner = v as Record<string, unknown>;
      for (const innerKey of FENCE_LIST_KEYS) {
        const w = inner[innerKey];
        if (Array.isArray(w)) return w.map(normaliseFenceItem);
      }
    }
  }
  for (const v of Object.values(rec)) {
    if (Array.isArray(v)) return v.map(normaliseFenceItem);
  }
  return [];
}
