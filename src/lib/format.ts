/**
 * Formatting helpers + human-readable labels for vendor values.
 *
 * Label sources:
 *  - alarm type catalogue: docs/protocol-notes.md — vendor UI
 *    strings, verbatim (SOS alarm, Shutdown alarm, …, Out of the fence).
 *  - fence breach enums e_fence_in / e_fence_out / e_fence_in_out:
 *    protocol notes (grounded).
 *  - state / loc-type enums (e_line_*, e_static_*, e_wifi, e_lbs): the screen
 *    contract + docs/protocol-notes.md.
 *  - acc_state / acc_power, car_switch keys and e_cmd_* labels are INFERRED
 *    from the vendor key names (no UI capture of those strings exists yet).
 *    Screens always render the raw enum value next to the label so nothing is
 *    silently invented.
 *
 * The raw `alarm_type` values of AlarmMsgItem are PENDING (never captured on
 * the wire), so alarmTypeLabel() matches the raw value against the vendor
 * catalogue keywords and falls back to humanizing the raw value — it never
 * invents a type that was not in the catalogue.
 *
 * READ-ONLY: pure formatting; no network, no vendor calls.
 */

/** Rendered in place of a missing/unparseable value. */
export const DASH = '—';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Best-effort date from a vendor timestamp: unix seconds, unix milliseconds
 * (values > 1e12), numeric strings or parseable date strings. null when
 * missing or unparseable.
 */
function toDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value > 1e12 ? value : value * 1000);
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric > 1e12 ? numeric : numeric * 1000);
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
}

/** Unix timestamp → local `DD/MM/YYYY HH:MM:SS`; DASH when missing/unparseable. */
export function fmtTs(value: unknown): string {
  const d = toDate(value);
  if (!d) return DASH;
  return (
    `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** Unix timestamp → local `DD/MM/YYYY` (date grouping headers); DASH when invalid. */
export function fmtDay(value: unknown): string {
  const d = toDate(value);
  if (!d) return DASH;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `YYYY-MM-DD` (date-input value) → `DD/MM/YYYY`. */
export function isoToBritish(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

const DUR_UNITS: ReadonlyArray<readonly [string, number]> = [
  ['y', 365 * 86400],
  ['mo', 30 * 86400],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
];

/**
 * Seconds → compact human duration ("2d 5h", "3m 12s", "45s"), top two units.
 * DASH for negative/non-finite input — callers decide how to render "expired".
 */
export function fmtDur(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return DASH;
  }
  let rest = Math.floor(seconds);
  if (rest === 0) return '0s';
  const parts: string[] = [];
  for (const [label, size] of DUR_UNITS) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n}${label}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Humanization fallback                                               */
/* ------------------------------------------------------------------ */

const ACRONYMS: Record<string, string> = {
  sos: 'SOS',
  sms: 'SMS',
  gps: 'GPS',
  lbs: 'LBS',
  wifi: 'WiFi',
  acc: 'ACC',
  iccid: 'ICCID',
  imei: 'IMEI',
  id: 'ID',
  apn: 'APN',
  gprs: 'GPRS',
};

/** `e_static_gps` → "Static Gps"; unknown enums degrade to their readable form. */
export function humanize(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return DASH;
  if (/^[0-9]+$/.test(s)) return `Type ${s}`;
  const words = s.replace(/^e_/i, '').replace(/[_\-.]+/g, ' ').trim().split(/\s+/);
  return words
    .map((word) => {
      const acronym = ACRONYMS[word.toLowerCase()];
      if (acronym) return acronym;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Map lookup with e_-prefix/case tolerance, humanized fallback. */
export function labelFor(map: Record<string, string>, raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return DASH;
  const lower = s.toLowerCase();
  const direct =
    map[s] ?? map[lower] ?? map[`e_${lower}`] ?? map[lower.replace(/^e_/, '')];
  return direct ?? humanize(s);
}

/* ------------------------------------------------------------------ */
/* e_* enum label maps                                                 */
/* ------------------------------------------------------------------ */

/** Device link state: e_line_on / e_line_sleep / e_line_down. */
export const STATE_LABELS: Record<string, string> = {
  e_line_on: 'Online',
  e_line_sleep: 'Sleeping',
  e_line_down: 'Offline',
};

/** acc_state: INFERRED labels — the raw enum is always shown alongside. */
export const ACC_STATE_LABELS: Record<string, string> = {
  e_acc_empty: 'ACC not connected',
  e_acc_close: 'ACC off',
  e_acc_open: 'ACC on',
};

/** acc_power: INFERRED labels (vendor spelling "interuupt" kept as the key). */
export const ACC_POWER_LABELS: Record<string, string> = {
  e_acc_power_interuupt: 'External power interrupted',
  e_acc_power_charge: 'External power charging',
};

/** Position fix source: e_static_gps / e_wifi / e_static_wifi / e_lbs / e_static_lbs. */
export const LOC_TYPE_LABELS: Record<string, string> = {
  e_static_gps: 'GPS fix',
  e_gps: 'GPS fix',
  e_wifi: 'WiFi',
  e_static_wifi: 'WiFi',
  e_lbs: 'LBS',
  e_static_lbs: 'LBS',
};

/** Device mode: e_mode_nomal (vendor spelling). */
export const MODE_LABELS: Record<string, string> = {
  e_mode_nomal: 'Normal',
};

/**
 * Alarm types: the only wire-captured alarm-type enum spellings so far are the
 * geofence breach types (docs/protocol-notes.md). Everything else is matched against
 * the vendor catalogue by alarmTypeLabel().
 */
export const ALARM_TYPE_LABELS: Record<string, string> = {
  e_fence_in: 'Into the fence',
  e_fence_out: 'Out of the fence',
  e_fence_in_out: 'Entry and exit fence alarm',
};

/**
 * Raw alarm_type → vendor catalogue label. Matching order matters (stay-in
 * before plain in/out, power-off before low-power). Falls back to humanize().
 */
export function alarmTypeLabel(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return DASH;
  const direct =
    ALARM_TYPE_LABELS[s] ??
    ALARM_TYPE_LABELS[s.toLowerCase()] ??
    ALARM_TYPE_LABELS[s.toLowerCase().replace(/^e_/, '')];
  if (direct) return direct;

  const norm = s.toLowerCase().replace(/^e_/, '').replace(/[_\-.]+/g, ' ');

  if (norm.includes('fence') || norm.includes('geofence')) {
    if (norm.includes('stay')) return 'Staying in the fence for more than 10 minutes';
    const inHit = /\bin\b/.test(norm) || norm.includes('into') || norm.includes('enter') || norm.includes('entry');
    const outHit = /\bout\b/.test(norm) || norm.includes('exit');
    if (inHit && outHit) return 'Entry and exit fence alarm';
    if (inHit) return 'Into the fence';
    if (outHit) return 'Out of the fence';
  }

  if (norm.includes('sos')) return 'SOS alarm';
  if (norm.includes('voice') && norm.includes('instant')) return 'Instant Voice Alarm';
  if (norm.includes('voice') && norm.includes('schedul')) return 'Scheduled Voice Alarm';
  if (norm.includes('voice')) return 'Voice Alarm';
  if (norm.includes('clock')) return 'Alarm clock';
  if (norm.includes('schedul')) return 'Scheduled Alarm';
  if (norm.includes('shutdown') || norm.includes('shut down') || norm.includes('poweroff') || norm.includes('power off')) {
    return 'Shutdown alarm';
  }
  if (norm.includes('outage') || norm.includes('power cut') || norm.includes('powercut') || norm.includes('power down') || norm.includes('power failure')) {
    return 'Power outage alarm';
  }
  if (norm.includes('offline') || norm.includes('off line') || norm.includes('line down') || norm.includes('linedown')) {
    return 'Offline alarm';
  }
  if (norm.includes('low power') || norm.includes('lowpower') || norm.includes('low battery') || norm.includes('lowbattery') || norm.includes('power low') || norm.includes('battery')) {
    return 'Low battery alarm';
  }
  if (norm.includes('speed')) return 'Speed alarm';
  if (norm.includes('vibrat') || norm.includes('shake')) return 'Vibration alarm';
  if (norm.includes('sms')) return 'SMS alarm';
  if (norm.includes('fall') || norm.includes('drop')) return 'Falling off alarm';

  return humanize(s);
}

/** e_cmd_* command types shown as informational chips only — never issued. */
export const CMD_LABELS: Record<string, string> = {
  e_cmd_sleep: 'Sleep',
  e_cmd_restart: 'Restart',
  e_cmd_reset: 'Reset',
  e_cmd_query_location: 'Query location',
  e_cmd_wakeup: 'Wakeup',
};

/** config.car_switch keys → labels (INFERRED from vendor key names). */
export const CAR_SWITCH_LABELS: Record<string, string> = {
  accalarm: 'ACC alarm',
  alarmswitch: 'Alarm alerts',
  closeswitch: 'Close alarm',
  disconnswitch: 'Disconnect alarm',
  dropalarm: 'Falling-off alarm',
  fenceswitch: 'Geofence alarm',
  indicatorlight: 'Indicator light',
  lbsswitch: 'LBS positioning',
  lowpower: 'Low-power alarm',
  lowpowermodeswitch: 'Low-power mode',
  offswitch: 'Power-off alarm',
  openswitch: 'Open alarm',
  protect: 'Anti-theft protect',
  rechage_sim: 'SIM recharge',
  replaystate: 'Replay state',
  reportloc: 'Report location',
  shakeswicth: 'Vibration alarm',
  sosswitch: 'SOS alarm',
  soundswitch: 'Sound',
  speedswitch: 'Speed alarm',
  statellite: 'Satellite positioning',
  wifiswitch: 'WiFi positioning',
};
