import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './history.css';
import { getRunInfo, getTrack, getTrackCalendar } from '../api/client';
import { isoToBritish } from '../lib/format';
import { getState, rememberDevices, setSelectedSimei, useAppState } from '../state';
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  formatTimestamp,
  interpolateAt,
  maxSpeedKmh,
  normaliseTrackResponse,
  speedColor,
  trackDistanceMeters,
  type NormalisedTrack,
} from '../lib/track';

/**
 * History screen — date-range track fetch, speed-coloured polyline and a
 * vendor-style trace player (play/pause, 1x/2x/4x, scrub with timestamp).
 *
 * READ-ONLY: the only vendor call is getTrack(simei, start, end) from
 * api/client.ts. Track schema is unverified — parsing lives in lib/track.ts
 * and degrades instead of throwing.
 */

const DAY_MS = 86_400_000;

/** Vendor UI rule (data-path.md: "The maximum query is within 7 consecutive days"). */
const VENDOR_MAX_DAYS = 7;
const VENDOR_MAX_DAYS_NOTICE = 'The maximum query is within 7 consecutive days';
/** Vendor UI rule (data-path.md: "The tracking time cannot be longer than 24 hours"). */
const VENDOR_24H_NOTICE = 'The tracking time cannot be longer than 24 hours';

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Local calendar date, `days` before today (0 = today). */
function daysAgo(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return isoLocal(d);
}

export function HistoryScreen() {
  const { selectedSimei, deviceNames } = useAppState();
  const deviceLabel = selectedSimei ? deviceNames[selectedSimei] : undefined;

  const [startDate, setStartDate] = useState(() => daysAgo(7));
  const [endDate, setEndDate] = useState(() => daysAgo(0));
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [track, setTrack] = useState<NormalisedTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playT, setPlayT] = useState(0);
  const [calendarDays, setCalendarDays] = useState<
    Array<{ date: string; distanceMeters: number }>
  >([]);

  /* ---------------- range math (single-day default, 7-day guard) -------- */

  const range = useMemo(() => {
    const startMs = Date.parse(`${startDate}T00:00:00`);
    const endDayMs = Date.parse(`${endDate}T00:00:00`);
    const valid =
      Number.isFinite(startMs) && Number.isFinite(endDayMs) && endDayMs >= startMs;
    const endMs = endDayMs + DAY_MS - 1000; // last second of the end day
    const spanDays = valid ? Math.round((endDayMs - startMs) / DAY_MS) : 0;
    const days = valid ? spanDays + 1 : 0;
    return {
      valid,
      startMs,
      endMs,
      days,
      // "today − 7 days" through today is a span of 7 days and is allowed.
      overWeek: spanDays > VENDOR_MAX_DAYS,
      // Playback rule is about the fetched window: a single day is ≤24h.
      over24h: valid && endMs - startMs > 24 * 3600 * 1000,
    };
  }, [startDate, endDate]);

  /* ---------------- playback timeline ---------------------------------- */

  const timeline = useMemo(() => {
    const pts = track?.timedPoints ?? [];
    if (pts.length < 2) return null;
    const start = pts[0].time;
    const end = pts[pts.length - 1].time;
    return { pts, start, end, duration: end - start };
  }, [track]);

  const canPlay = timeline !== null && timeline.duration > 0 && !range.over24h;

  /* ---------------- leaflet map ---------------------------------------- */

  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const trackLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    const div = mapDivRef.current;
    if (!div || mapRef.current) return;
    const map = L.map(div).setView([51.5, -0.12], 6); // UK default; refitted on load
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      trackLayerRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Redraw polyline + start/end markers whenever a new track arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (trackLayerRef.current) {
      map.removeLayer(trackLayerRef.current);
      trackLayerRef.current = null;
      markerRef.current = null;
    }
    if (!track || track.points.length === 0) return;

    const group = L.layerGroup().addTo(map);
    trackLayerRef.current = group;

    const pts = track.points;
    const latlngs: [number, number][] = pts.map((p) => [p.lat, p.lon]);
    const colors = track.segmentSpeeds.map(speedColor);

    // Merge consecutive same-colour segments into one polyline: a dense day
    // would otherwise mean thousands of separate Leaflet layers.
    if (colors.length > 0) {
      let run: [number, number][] = [latlngs[0]];
      let runColor = colors[0];
      for (let i = 0; i < colors.length; i++) {
        if (colors[i] === runColor) {
          run.push(latlngs[i + 1]);
        } else {
          L.polyline(run, { color: runColor, weight: 4, opacity: 0.9 }).addTo(group);
          run = [latlngs[i], latlngs[i + 1]];
          runColor = colors[i];
        }
      }
      if (run.length > 1) {
        L.polyline(run, { color: runColor, weight: 4, opacity: 0.9 }).addTo(group);
      }
    }

    L.circleMarker(latlngs[0], {
      radius: 7,
      color: '#22c55e',
      weight: 2,
      fillColor: '#22c55e',
      fillOpacity: 1,
    })
      .addTo(group)
      .bindTooltip('Start', { direction: 'top' });
    L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 7,
      color: '#ef4444',
      weight: 2,
      fillColor: '#ef4444',
      fillOpacity: 1,
    })
      .addTo(group)
      .bindTooltip('End', { direction: 'top' });

    // Moving playback marker (cleared with the group on the next redraw).
    const moving = L.circleMarker(latlngs[0], {
      radius: 8,
      color: '#38bdf8',
      weight: 2,
      fillColor: '#38bdf8',
      fillOpacity: 0.9,
    }).addTo(group);
    markerRef.current = moving;

    map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
  }, [track]);

  // Bring the map into view once a track has been drawn. On a phone it sits
  // below the controls, so the page scrolls down to it.
  useEffect(() => {
    if (status !== 'ready') return;
    const wrap = mapWrapRef.current;
    if (!wrap) return;
    const timer = window.setTimeout(() => {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [status, track]);

  // Move the marker along the polyline as playback time advances.
  useEffect(() => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map || !timeline) return;
    const pose = interpolateAt(timeline.pts, timeline.start + playT);
    if (!pose) return;
    const ll = L.latLng(pose.lat, pose.lon);
    marker.setLatLng(ll);
    if (playing && !map.getBounds().contains(ll)) map.panTo(ll);
  }, [playT, timeline, playing]);

  // Playback clock: realtime × speed multiplier.
  useEffect(() => {
    if (!playing || !timeline || timeline.duration <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayT((prev) => Math.min(prev + dt * speed, timeline.duration));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, timeline]);

  // Stop at the end of the track.
  useEffect(() => {
    if (playing && timeline && playT >= timeline.duration) setPlaying(false);
  }, [playT, playing, timeline]);

  // Resolve the friendly name (and a default device) without visiting Live first.
  useEffect(() => {
    let cancelled = false;
    getRunInfo()
      .then((res) => {
        if (cancelled) return;
        const items = res.items ?? [];
        rememberDevices(items);
        if (!getState().selectedSimei && items[0]?.simei) {
          setSelectedSimei(items[0].simei);
        }
      })
      .catch(() => {
        // The name stays blank until a later successful refresh.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSimei) {
      setCalendarDays([]);
      return;
    }
    let cancelled = false;
    getTrackCalendar(selectedSimei)
      .then((days) => {
        if (!cancelled) setCalendarDays(days);
      })
      .catch(() => {
        if (!cancelled) setCalendarDays([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSimei]);

  /* ---------------- data fetch ----------------------------------------- */

  const inFlightKey = useRef<string | null>(null);
  const loadToken = useRef(0);

  const load = useCallback(async () => {
    if (!selectedSimei || !range.valid || range.overWeek) return;
    const key = `${selectedSimei}:${range.startMs}:${range.endMs}`;
    if (inFlightKey.current === key) return;
    const token = ++loadToken.current;
    inFlightKey.current = key;
    setStatus('loading');
    setErrorMsg('');
    setTrack(null);
    setPlaying(false);
    setPlayT(0);
    try {
      const raw = await getTrack(
        selectedSimei,
        Math.floor(range.startMs / 1000),
        Math.floor(range.endMs / 1000),
      );
      if (token !== loadToken.current) return;
      const norm = normaliseTrackResponse(raw);
      setTrack(norm.points.length > 0 ? norm : null);
      setStatus(norm.points.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      if (token !== loadToken.current) return;
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (token === loadToken.current) inFlightKey.current = null;
    }
  }, [selectedSimei, range.valid, range.overWeek, range.startMs, range.endMs]);

  // Open History, or change device / dates, and the track loads itself.
  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------- render --------------------------------------------- */

  return (
    <section class="history">
      <h2>History</h2>

      {calendarDays.length > 0 && (
        <ul class="history-days history-calendar" aria-label="Days with stored track">
          {calendarDays.slice(0, 14).map((d) => (
            <li key={d.date}>
              <button
                type="button"
                class="history-calendar-btn"
                onClick={() => {
                  setStartDate(d.date);
                  setEndDate(d.date);
                }}
              >
                <span>{isoToBritish(d.date)}</span>
                <span>{formatDistance(d.distanceMeters)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedSimei ? (
        <p class="history-device-line">
          <span class="history-label">Device</span> {deviceLabel ?? '…'}
        </p>
      ) : (
        <p class="history-notice">
          No device selected — pick one on the <a href="#/live">Live</a> screen first.
        </p>
      )}

      {status === 'loading' && <p class="history-notice">Loading track…</p>}
      {status === 'error' && (
        <p class="history-error">Track request failed: {errorMsg}</p>
      )}
      {status === 'empty' && <p class="history-notice">no track data for these dates</p>}

      {track && (
        <div class="history-stats">
          <div class="history-stat">
            <span class="history-stat-value">{formatDistance(track.distanceMeters)}</span>
            <span class="history-stat-label">Distance</span>
          </div>
          <div class="history-stat">
            <span class="history-stat-value">
              {formatSpeed(maxSpeedKmh(track.points, track.segmentSpeeds))}
            </span>
            <span class="history-stat-label">Max speed</span>
          </div>
          <div class="history-stat">
            <span class="history-stat-value">{track.points.length}</span>
            <span class="history-stat-label">Points</span>
          </div>
          <div class="history-stat">
            <span class="history-stat-value">
              {timeline ? formatDuration(timeline.duration) : '—'}
            </span>
            <span class="history-stat-label">Duration</span>
          </div>
        </div>
      )}

      {track && track.days.length > 0 && (
        <ul class="history-days">
          {track.days.map((d, i) => (
            <li key={`${i}-${d.date}`}>
              <span>{d.date ? isoToBritish(d.date) : 'selected range'}</span>
              <span
                title={
                  d.dayDistance !== undefined
                    ? `day_distance raw: ${d.dayDistance}`
                    : undefined
                }
              >
                {d.dayDistance !== undefined
                  ? formatDistance(d.dayDistance) // [INFERENCE] day_distance is metres
                  : formatDistance(trackDistanceMeters(d.points))}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div class="history-map-wrap" ref={mapWrapRef}>
        <div ref={mapDivRef} class="history-map" />
      </div>

      <div class="history-legend">
        <span class="history-legend-item">
          <i style="background:#22c55e" /> &lt;{formatSpeed(30)}
        </span>
        <span class="history-legend-item">
          <i style="background:#f59e0b" /> {formatSpeed(30).replace(' mph', '')}–{formatSpeed(60)}
        </span>
        <span class="history-legend-item">
          <i style="background:#ef4444" /> &gt;{formatSpeed(60)}
        </span>
      </div>

      <div class="history-playback">
        <button
          class="history-btn"
          disabled={!canPlay}
          onClick={() => {
            if (!timeline) return;
            if (playT >= timeline.duration) setPlayT(0);
            setPlaying(!playing);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <div class="history-speeds">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              class={s === speed ? 'history-btn history-speed-active' : 'history-btn'}
              disabled={!canPlay}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
        <input
          class="history-slider"
          type="range"
          min={0}
          max={timeline ? Math.max(timeline.duration, 1) : 1}
          step={1}
          value={playT}
          disabled={!canPlay}
          onInput={(e) => setPlayT(Number(e.currentTarget.value))}
        />
        <div class="history-time">
          {timeline ? formatTimestamp(timeline.start + playT) : '—'}
        </div>
      </div>
      {!canPlay && timeline === null && track && (
        <p class="history-notice">Playback unavailable — track points have no timestamps.</p>
      )}

      <div class="history-range">
        <label class="history-field">
          <span class="history-label">From</span>
          <span class="history-date">
            <span class="history-date-face">{isoToBritish(startDate)}</span>
            <input
              class="history-date-native"
              type="date"
              lang="en-GB"
              value={startDate}
              max={endDate}
              aria-label="From"
              onInput={(e) => setStartDate(e.currentTarget.value)}
            />
          </span>
        </label>
        <label class="history-field">
          <span class="history-label">To</span>
          <span class="history-date">
            <span class="history-date-face">{isoToBritish(endDate)}</span>
            <input
              class="history-date-native"
              type="date"
              lang="en-GB"
              value={endDate}
              min={startDate}
              aria-label="To"
              onInput={(e) => setEndDate(e.currentTarget.value)}
            />
          </span>
        </label>
        <button
          class="history-btn history-btn-primary"
          disabled={!selectedSimei || !range.valid || range.overWeek || status === 'loading'}
          onClick={() => {
            void load();
          }}
        >
          Load track
        </button>
      </div>

      {!range.valid && (
        <p class="history-error">End date must not be before the start date.</p>
      )}
      {range.valid && range.overWeek && (
        <p class="history-notice history-notice-warn">
          {VENDOR_MAX_DAYS_NOTICE} — pick a range of {VENDOR_MAX_DAYS} days or less.
        </p>
      )}
      {range.valid && !range.overWeek && range.over24h && (
        <p class="history-notice history-notice-warn">
          {VENDOR_24H_NOTICE} — playback is disabled for this range ({range.days} days); the
          map and stats still cover the fetched data.
        </p>
      )}
    </section>
  );
}
