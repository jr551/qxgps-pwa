/**
 * Track geometry helpers + defensive normalisation of the vendor track
 * response for the History screen.
 *
 * SCHEMA CAVEAT: the vendor track response is UNVERIFIED. QueryTrackLocationModel
 * exists only as a Dart symbol with fields `points`, `polyline`, `distance`,
 * `subsection_speed` (see docs/protocol-notes.md
 * § "Track model"), and TrackPoint/TrackDay in api/types.ts are marked PENDING.
 * Everything here therefore parses `unknown` defensively and degrades instead
 * of throwing: unknown containers fall back to array-of-points shapes, malformed
 * points are dropped, and unparseable `subsection_speed` falls back to speeds
 * derived from geometry. No vendor-write calls — this module is pure functions.
 */

import type { TrackPoint, TrackPointWire } from '../api/types';

/** Map one location.QueryLocation row onto TrackPoint (verified wire shape). */
export function mapQueryLocationPoint(w: TrackPointWire): TrackPoint {
  let lat = w.lat / 1e6;
  let lon = w.lon / 1e6;
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(w.wgs ?? '');
  if (m) {
    lat = Number(m[1]);
    lon = Number(m[2]);
  }
  const p: TrackPoint = { time: w.time, lat, lon, type: String(w.type) };
  if (w.speed !== undefined) p.speed = w.speed / 10;
  if (w.direction !== undefined) p.course = w.direction;
  return p;
}

/* ------------------------------------------------------------------ */
/* Normalised shapes                                                   */
/* ------------------------------------------------------------------ */

export interface TrackDayData {
  /** Day label from the response ("YYYY-MM-DD" expected); '' when unknown. */
  date: string;
  /** Points in source order (geometry order preserved for drawing). */
  points: TrackPoint[];
  /** Raw `day_distance` when the response carries it (scale unverified). */
  dayDistance?: number;
}

export interface NormalisedTrack {
  /** Per-day groups in source order. */
  days: TrackDayData[];
  /** All points flattened, source order. */
  points: TrackPoint[];
  /** Points with a usable timestamp, sorted ascending — the playback timeline. */
  timedPoints: TrackPoint[];
  /** Per-segment speed in km/h; length === max(points.length - 1, 0). */
  segmentSpeeds: number[];
  /** True when segmentSpeeds came from `subsection_speed` rather than derivation. */
  speedsFromSubsection: boolean;
  /** Haversine sum over the flattened points, metres. */
  distanceMeters: number;
}

/** Speed band colours (vendor thresholds: green <30, amber 30-60, red >60 km/h). */
export const SPEED_GREEN = '#22c55e';
export const SPEED_AMBER = '#f59e0b';
export const SPEED_RED = '#ef4444';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** Great-circle distance in metres between two WGS84 points. */
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sum of consecutive haversine legs, metres. */
export function trackDistanceMeters(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Per-segment speed in km/h derived from geometry and timestamps
 * (0 where either endpoint lacks a usable time).
 */
export function deriveSegmentSpeeds(points: TrackPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.time - a.time;
    out.push(dt > 0 ? (haversineMeters(a, b) / dt) * 3.6 : 0);
  }
  return out;
}

/** Colour band for a speed in km/h: green <30, amber 30-60, red >60. */
export function speedColor(speedKmh: number | null | undefined): string {
  if (typeof speedKmh === 'number' && Number.isFinite(speedKmh)) {
    if (speedKmh > 60) return SPEED_RED;
    if (speedKmh >= 30) return SPEED_AMBER;
  }
  return SPEED_GREEN;
}

export interface PlaybackPose {
  lat: number;
  lon: number;
  /** Index of the segment start point (points[i].time <= t <= points[i+1].time). */
  index: number;
}

/**
 * Position of the moving marker at time `tSec` (unix seconds), linearly
 * interpolated between the surrounding timed points. Clamps outside the range.
 * `points` must be `timedPoints` (time > 0, ascending).
 */
export function interpolateAt(points: TrackPoint[], tSec: number): PlaybackPose | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (tSec <= first.time) return { lat: first.lat, lon: first.lon, index: 0 };
  if (tSec >= last.time) {
    return { lat: last.lat, lon: last.lon, index: points.length - 1 };
  }
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= tSec) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const dt = b.time - a.time;
  const frac = dt > 0 ? (tSec - a.time) / dt : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lon: a.lon + (b.lon - a.lon) * frac,
    index: lo,
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const METRES_PER_MILE = 1609.344;
const KMH_TO_MPH = 0.621371;

/** Metres → miles. Short trips keep two decimals; longer ones one. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  const miles = meters / METRES_PER_MILE;
  return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
}

/** Vendor speeds are km/h. Shown in mph, rounded to the nearest whole number. */
export function formatSpeed(kmh: number | null | undefined): string {
  if (typeof kmh !== 'number' || !Number.isFinite(kmh) || kmh < 0) return '—';
  return `${Math.round(kmh * KMH_TO_MPH)} mph`;
}

/**
 * Anything faster than this is a GPS jump, not a road speed. 250 km/h is
 * about 155 mph — above any speed this tracker will genuinely report.
 */
const MAX_PLAUSIBLE_KMH = 250;

function considerSpeed(current: number, speed: number): number {
  if (Number.isFinite(speed) && speed >= 0 && speed <= MAX_PLAUSIBLE_KMH && speed > current) {
    return speed;
  }
  return current;
}

/**
 * Fastest plausible point on the track, in km/h. Prefers the vendor's own
 * per-point speed. Derived segment speeds are only used when no point carries
 * a speed, and only for legs of at least 5 seconds so a one-second GPS jump
 * cannot become the maximum.
 */
export function maxSpeedKmh(
  points: ReadonlyArray<{ speed?: number; time?: number }>,
  segmentSpeeds: ReadonlyArray<number>,
): number | null {
  let max = -1;
  let sawPointSpeed = false;
  for (const point of points) {
    const speed = point.speed;
    if (typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 && speed <= MAX_PLAUSIBLE_KMH) {
      sawPointSpeed = true;
      max = considerSpeed(max, speed);
    }
  }
  if (!sawPointSpeed) {
    for (let i = 1; i < points.length && i - 1 < segmentSpeeds.length; i++) {
      const prev = points[i - 1].time;
      const next = points[i].time;
      if (typeof prev !== 'number' || typeof next !== 'number' || next - prev < 5) continue;
      max = considerSpeed(max, segmentSpeeds[i - 1]);
    }
  }
  return max < 0 ? null : max;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "DD/MM/YYYY HH:MM:SS" in local time. */
export function formatTimestamp(unixSec: number): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return '—';
  const d = new Date(unixSec * 1000);
  return (
    `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** "1h 23m" / "45s" — coarse duration label. */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ------------------------------------------------------------------ */
/* Defensive parsing                                                   */
/* ------------------------------------------------------------------ */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Vendor ints are deg×1e6 (verified for last_pos); anything beyond ±90/±180
 * is scaled down once. Returns NaN when the result is still out of range.
 */
function fixLat(v: number): number {
  let x = v;
  if (Math.abs(x) > 90) x = x / 1e6;
  return Math.abs(x) <= 90 ? x : Number.NaN;
}

function fixLon(v: number): number {
  let x = v;
  if (Math.abs(x) > 180) x = x / 1e6;
  return Math.abs(x) <= 180 ? x : Number.NaN;
}

function parseCoordPair(v: unknown): { lat: number; lon: number } | null {
  if (Array.isArray(v) && v.length >= 2) {
    const a = toFiniteNumber(v[0]);
    const b = toFiniteNumber(v[1]);
    if (a === null || b === null) return null;
    // GeoJSON order is [lon, lat]; detect it via the ±90 lat constraint.
    const geojsonFirst = Math.abs(a) > 90 && Math.abs(b) <= 90;
    const lat = geojsonFirst ? b : a;
    const lon = geojsonFirst ? a : b;
    return finishCoords(lat, lon);
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return finishCoords(Number(m[1]), Number(m[2]));
    return null;
  }
  const rec = asRecord(v);
  if (rec) return coordsFromRecord(rec);
  return null;
}

function finishCoords(latRaw: number, lonRaw: number): { lat: number; lon: number } | null {
  const lat = fixLat(latRaw);
  const lon = fixLon(lonRaw);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function coordsFromRecord(rec: Record<string, unknown>): { lat: number; lon: number } | null {
  // Preferred: `wgs` "lat,lon" (verified format in last_pos) — already decimal.
  const wgs = rec.wgs;
  if (typeof wgs === 'string') {
    const pair = parseCoordPair(wgs);
    if (pair) return pair;
  }
  const latRaw = toFiniteNumber(rec.lat ?? rec.latitude ?? rec.gps_lat ?? rec.lat_deg);
  const lonRaw = toFiniteNumber(rec.lon ?? rec.lng ?? rec.longitude ?? rec.gps_lon ?? rec.lon_deg);
  if (latRaw !== null && lonRaw !== null) return finishCoords(latRaw, lonRaw);
  // Nested coordinate objects seen in some trace APIs.
  for (const key of ['location', 'point', 'pos', 'coordinate']) {
    const nested = parseCoordPair(rec[key]);
    if (nested) return nested;
  }
  return null;
}

function parseTime(rec: Record<string, unknown>): number {
  for (const key of ['time', 'timestamp', 'ts', 'gps_time', 'loctime', 'create_time']) {
    const v = rec[key];
    const n = toFiniteNumber(v);
    if (n !== null) return n > 1e11 ? n / 1000 : n; // ms → s
    if (typeof v === 'string') {
      const parsed = Date.parse(v);
      if (Number.isFinite(parsed)) return parsed / 1000;
    }
  }
  return 0;
}

/** Parse one point from any tolerated shape; null when coordinates are unusable. */
function parsePoint(value: unknown): TrackPoint | null {
  let v: unknown = value;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    try {
      v = JSON.parse(trimmed);
    } catch {
      // bare "lat,lon" polyline entry
      const pair = parseCoordPair(trimmed);
      return pair ? { time: 0, lat: pair.lat, lon: pair.lon, type: '' } : null;
    }
  }
  const arr = Array.isArray(v) ? v : null;
  const rec = asRecord(v);
  if (!rec && !arr) return null;

  const coords = rec ? coordsFromRecord(rec) : parseCoordPair(arr);
  if (!coords) return null;

  const time = rec ? parseTime(rec) : toFiniteNumber(arr && arr.length > 2 ? arr[2] : null) ?? 0;
  const point: TrackPoint = {
    time: time > 1e11 ? time / 1000 : time,
    lat: coords.lat,
    lon: coords.lon,
    type: rec && typeof rec.type === 'string' ? rec.type : '',
  };
  if (rec) {
    const speed = toFiniteNumber(rec.speed ?? rec.speed_kmh ?? rec.sp);
    if (speed !== null) point.speed = speed;
    const course = toFiniteNumber(rec.course ?? rec.direction);
    if (course !== null) point.course = course;
    const addr = rec.addr ?? rec.address;
    if (typeof addr === 'string') point.addr = addr;
  }
  return point;
}

/* ------------------------------------------------------------------ */
/* subsection_speed → per-segment speeds                               */
/* ------------------------------------------------------------------ */

/**
 * Best-effort parse of the unverified `subsection_speed` field into one speed
 * (km/h) per segment of a point array (length pointCount - 1). Entries that
 * cannot be attributed stay null so the caller can fall back to derived
 * speeds. Returns null when the shape is unrecognised.
 */
function normaliseSubsectionSpeed(raw: unknown, segCount: number): Array<number | null> | null {
  if (raw == null || segCount <= 0) return null;

  if (Array.isArray(raw)) {
    const nums = raw.map(toFiniteNumber);
    if (nums.length > 0 && nums.every((n) => n !== null)) {
      const arr = nums as number[];
      if (arr.length === segCount) return arr.map((v) => Math.max(0, v));
      if (arr.length === segCount + 1) {
        // Per-point speeds → average adjacent endpoints per segment.
        return Array.from({ length: segCount }, (_, i) =>
          Math.max(0, (arr[i] + arr[i + 1]) / 2),
        );
      }
      return null; // unrecognised length → derived fallback
    }
    // Ranged section objects: {start, end, speed} with common alias spellings.
    const out: Array<number | null> = new Array(segCount).fill(null);
    let matched = 0;
    for (const item of raw) {
      const rec = asRecord(item);
      if (!rec) return null;
      const speed = toFiniteNumber(
        rec.speed ?? rec.speed_value ?? rec.max_speed ?? rec.value ?? rec.kmh,
      );
      const start = toFiniteNumber(
        rec.start ?? rec.start_index ?? rec.begin ?? rec.from ?? rec.idx_begin,
      );
      const end = toFiniteNumber(
        rec.end ?? rec.end_index ?? rec.finish ?? rec.to ?? rec.idx_end,
      );
      if (speed === null || start === null) return null;
      const s = Math.max(0, Math.floor(start));
      // [INFERENCE] section ends are inclusive — the real SubsectionModel range
      // semantics are unknown; filling one extra segment only affects colour.
      const e = end === null ? s : Math.floor(end);
      for (let i = s; i <= e && i < segCount; i++) {
        out[i] = Math.max(0, speed);
        matched++;
      }
    }
    return matched > 0 ? out : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Container extraction                                                */
/* ------------------------------------------------------------------ */

interface RawGroup {
  date: string;
  rawPoints: unknown[];
  subsection: unknown;
  dayDistance?: number;
}

const LIST_KEYS = ['points', 'items', 'list', 'track', 'locations', 'polyline', 'poly_line'] as const;

function dateFrom(rec: Record<string, unknown>): string {
  const v = rec.date ?? rec.day ?? rec.day_time ?? rec.daytime;
  if (typeof v === 'string') return v.trim();
  const n = toFiniteNumber(v);
  if (n !== null && n > 1e8) {
    const d = new Date((n > 1e11 ? n / 1000 : n) * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }
  return '';
}

function dayDistanceFrom(rec: Record<string, unknown>): number | undefined {
  const n = toFiniteNumber(rec.day_distance ?? rec.dayDistance ?? rec.distance);
  return n === null ? undefined : n;
}

function isDayRecord(v: unknown): boolean {
  const rec = asRecord(v);
  if (!rec) return false;
  return LIST_KEYS.some((k) => Array.isArray(rec[k]));
}

function groupFromRecord(rec: Record<string, unknown>): RawGroup {
  const subsection =
    rec.subsection_speed ??
    rec.subsectionSpeed ??
    rec.subsection ??
    rec.subsections ??
    rec.speed_section;
  for (const key of LIST_KEYS) {
    const v = rec[key];
    if (Array.isArray(v)) {
      return {
        date: dateFrom(rec),
        rawPoints: v,
        subsection,
        dayDistance: dayDistanceFrom(rec),
      };
    }
  }
  return { date: dateFrom(rec), rawPoints: [], subsection, dayDistance: dayDistanceFrom(rec) };
}

function extractGroups(raw: unknown): RawGroup[] {
  if (Array.isArray(raw)) {
    // Tolerated: flat point array, or an array of day objects.
    if (raw.some(isDayRecord)) return raw.filter(isDayRecord).map((e) => groupFromRecord(asRecord(e)!));
    return [{ date: '', rawPoints: raw, subsection: null, dayDistance: undefined }];
  }
  const rec = asRecord(raw);
  if (!rec) return [];
  // Wrapper objects carrying an array under a well-known key.
  for (const key of ['days', 'items', 'list', 'data', 'records']) {
    const v = rec[key];
    if (Array.isArray(v)) return extractGroups(v);
  }
  // Single-day object (QueryTrackLocationModel-ish: points/polyline + speeds).
  const group = groupFromRecord(rec);
  return group.rawPoints.length > 0 ? [group] : [];
}

/* ------------------------------------------------------------------ */
/* Public normaliser                                                   */
/* ------------------------------------------------------------------ */

/**
 * Normalise any tolerated track response into points + per-segment speeds.
 * Never throws: unknown shapes simply produce an empty track.
 */
export function normaliseTrackResponse(raw: unknown): NormalisedTrack {
  const groups = extractGroups(raw);
  const days: TrackDayData[] = [];
  const points: TrackPoint[] = [];
  const segmentSpeeds: number[] = [];
  let speedsFromSubsection = false;

  for (const g of groups) {
    const parsed: TrackPoint[] = [];
    for (const rp of g.rawPoints) {
      const p = parsePoint(rp);
      if (p) parsed.push(p);
    }
    const day: TrackDayData = { date: g.date, points: parsed };
    if (g.dayDistance !== undefined) day.dayDistance = g.dayDistance;
    days.push(day);

    const derived = deriveSegmentSpeeds(parsed);
    const sub = normaliseSubsectionSpeed(g.subsection, derived.length);
    if (sub) speedsFromSubsection = true;
    for (let i = 0; i < derived.length; i++) {
      segmentSpeeds.push(sub && sub[i] !== null ? (sub[i] as number) : derived[i]);
    }
    for (const p of parsed) points.push(p);
  }

  const timedPoints = points
    .filter((p) => p.time > 0)
    .slice()
    .sort((a, b) => a.time - b.time);

  return {
    days,
    points,
    timedPoints,
    segmentSpeeds,
    speedsFromSubsection,
    distanceMeters: trackDistanceMeters(points),
  };
}
