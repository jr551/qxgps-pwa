/**
 * Small pure helpers for formatting/decoding vendor position + enum values.
 * No DOM, no vendor calls — safe to use from any screen.
 *
 * Every enum mapping is grounded in
 * docs/protocol-notes.md and
 * docs/protocol-notes.md (e_line_* states, e_* location sources). Unknown enum values
 * fall back to a humanised form rather than being hidden, so the UI never
 * swallows a value the vendor adds later.
 */

import type { LastPos } from '../api/types';

/** Decimal degrees. */
export interface LatLng {
  lat: number;
  lon: number;
}

/* ------------------------------------------------------------------ */
/* Position decoding                                                   */
/* ------------------------------------------------------------------ */

/**
 * Parse the vendor's WGS84 "lat,lon" decimal string (`last_pos.wgs`).
 * Returns null when missing/malformed, or for the vendor's "0.0,0.0"
 * placeholder (a device that has never located — see the empty-state mock
 * in response-schemas.md).
 */
export function parseWgs(wgs: string | null | undefined): LatLng | null {
  if (typeof wgs !== 'string') return null;
  const parts = wgs.split(',');
  if (parts.length !== 2) return null;
  const latText = parts[0].trim();
  const lonText = parts[1].trim();
  if (latText === '' || lonText === '') return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/**
 * Best-effort position of a decoded `last_pos` blob: prefer the `wgs`
 * "lat,lon" string, fall back to integer `lat`/`lon` (degrees × 1e6).
 * Returns null when the device has no usable fix.
 */
export function fixLatLng(pos: LastPos | null | undefined): LatLng | null {
  if (!pos) return null;
  const fromWgs = parseWgs(pos.wgs);
  if (fromWgs) return fromWgs;
  const lat = typeof pos.lat === 'number' ? pos.lat / 1e6 : NaN;
  const lon = typeof pos.lon === 'number' ? pos.lon / 1e6 : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** "51.500000, -0.120000" — six decimals, matching the vendor's own wgs field. */
export function fmtLatLng(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

/**
 * Human age of a fix timestamp (unix seconds) against `nowSeconds`:
 * "just now", "42s ago", "5m ago", "2h 5m ago", "3d 4h ago".
 * Missing/zero timestamps render as "never".
 */
export function fmtFixAge(fixTime: number | null | undefined, nowSeconds: number): string {
  if (typeof fixTime !== 'number' || !Number.isFinite(fixTime) || fixTime <= 0) {
    return 'never';
  }
  const delta = Math.max(0, Math.floor(nowSeconds - fixTime));
  if (delta < 10) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) {
    return `${Math.floor(delta / 3600)}h ${Math.floor((delta % 3600) / 60)}m ago`;
  }
  return `${Math.floor(delta / 86400)}d ${Math.floor((delta % 86400) / 3600)}h ago`;
}

/** Miles ("0.51 mi" / "12.4 mi"); null/undefined/negative render as "—". */
export function fmtDistance(metres: number | null | undefined): string {
  if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0) {
    return '—';
  }
  const miles = metres / 1609.344;
  return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
}

/* ------------------------------------------------------------------ */
/* Enum labels                                                         */
/* ------------------------------------------------------------------ */

/** Last-resort label for an enum value the maps below do not know. */
function humanEnum(value: string): string {
  const words = value.replace(/^e_/, '').split('_').filter(Boolean);
  if (words.length === 0) return value;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Device link state → label.
 * Verified values (data-path.md): e_line_on, e_line_sleep, e_line_down.
 */
export function stateLabel(state: string | null | undefined): string {
  switch (state) {
    case '':
    case undefined:
    case null:
      return 'Never online';
    case 'e_line_on':
      return 'Online';
    case 'e_line_sleep':
      return 'Sleeping';
    case 'e_line_down':
      return 'Offline';
    default:
      return humanEnum(state);
  }
}

/**
 * Fix source (`last_pos.type` / `loc_type`) → label.
 * Verified values (response-schemas.md): e_static_gps, e_wifi, e_static_wifi,
 * e_static_lbs, e_lbs.
 */
export function typeLabel(locType: string | null | undefined): string {
  switch (locType) {
    case '':
    case undefined:
    case null:
      return 'Unknown';
    case 'e_static_gps':
    case 'e_gps':
    case 'gps':
      return 'GPS';
    case 'e_wifi':
    case 'e_static_wifi':
    case 'wifi':
      return 'WiFi';
    case 'e_lbs':
    case 'e_static_lbs':
    case 'lbs':
      return 'Cell (LBS)';
    default:
      return humanEnum(locType);
  }
}
