/**
 * Live screen — Leaflet map of current device positions + device sidebar.
 *
 * Data source is READ-ONLY: only getRunInfo() (family.GetRunInfo) is polled.
 * No vendor write/Set/Add/Del call may ever appear here.
 *
 * Positions come from each item's string-encoded `last_pos` blob
 * (parseLastPos): prefer its `wgs` "lat,lon" decimal string, fall back to the
 * integer lat/lon (degrees × 1e6).
 */

import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './live.css';
import { getRunInfo } from '../api/client';
import { MapiError, parseLastPos, type DeviceSummary, type LastPos } from '../api/types';
import {
  fixLatLng,
  fmtFixAge,
  fmtLatLng,
  stateLabel,
  typeLabel,
  type LatLng,
} from '../lib/geo';
import { getState, rememberDevices, setSelectedSimei, useAppState } from '../state';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** family.GetRunInfo poll cadence. */
const POLL_INTERVAL_MS = 10_000;

/** OSM raster tiles (attribution required by the OSM tile usage policy). */
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const MAP_START_ZOOM = 2;
/** Zoom level used when focusing a selected device. */
const SELECT_ZOOM = 15;

/* ------------------------------------------------------------------ */
/* Device model for this screen                                        */
/* ------------------------------------------------------------------ */

/**
 * `signal_rate` (0-100), `speed_value` and `devspeed` appear in the vendor
 * model table (research docs/protocol-notes.md) but NOT in the verified
 * GetRunInfo item schema (response-schemas.md §2). Read defensively: shown
 * when present, "—" when absent. The speed unit is unverified in the
 * research, so it is rendered as a bare number.
 */
type LiveDevice = DeviceSummary & {
  signal_rate?: number;
  speed_value?: number;
  devspeed?: number;
};

/** Marker/badge colour class by link state. Expired overrides state colour. */
type Tone = 'online' | 'sleep' | 'offline' | 'expired';

const TONE_COLOR: Record<Tone, string> = {
  online: '#16a34a',
  sleep: '#f59e0b',
  offline: '#64748b',
  expired: '#ef4444',
};

const TONE_BADGE_CLASS: Record<Tone, string> = {
  online: 'dev-badge dev-badge-online',
  sleep: 'dev-badge dev-badge-sleep',
  offline: 'dev-badge dev-badge-offline',
  expired: 'dev-badge dev-badge-expired',
};

interface DeviceRow {
  device: LiveDevice;
  fix: LastPos | null;
  /** null when the device has no usable fix (never located / unparsable). */
  ll: LatLng | null;
  /** Marker colour: expiry overrides the link-state colour. */
  tone: Tone;
  /** Badge colour: link state only (expiry gets its own badge). */
  stateTone: Tone;
  /** `power` as reported; battery scale is unverified beyond the raw field. */
  power: number | null;
  signal: number | null;
  speed: number | null;
}

interface MarkerEntry {
  marker: L.CircleMarker;
  popup: HTMLElement;
}

function stateToneOf(device: { state: string }): Tone {
  if (device.state === 'e_line_on') return 'online';
  if (device.state === 'e_line_sleep') return 'sleep';
  return 'offline';
}

/** "HH:MM:ss" (local) — the exact format of the "last updated" indicator. */
function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function finiteOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* Leaflet popup content                                               */
/* ------------------------------------------------------------------ */

function PopupRow(props: { label: string; value: string }) {
  return (
    <div class="dev-popup-row">
      <span class="dev-popup-key">{props.label}</span>
      <span class="dev-popup-val">{props.value}</span>
    </div>
  );
}

function PopupBody(props: { row: DeviceRow; nowSeconds: number }) {
  const { row, nowSeconds } = props;
  const d = row.device;
  return (
    <div class="dev-popup">
      <div class="dev-popup-name">
        {d.car_number !== '' ? d.car_number : `Device ${d.imei}`}
      </div>
      <PopupRow label="IMEI" value={String(d.imei)} />
      <PopupRow label="State" value={stateLabel(d.state)} />
      {d.expire === true ? <PopupRow label="Data plan" value="Expired" /> : null}
      <PopupRow label="Battery" value={row.power === null ? '—' : String(Math.round(row.power))} />
      <PopupRow
        label="Signal"
        value={row.signal === null ? '—' : `${Math.round(row.signal)}%`}
      />
      {row.speed === null ? null : <PopupRow label="Speed" value={String(row.speed)} />}
      <PopupRow
        label="Fix"
        value={
          row.fix === null
            ? 'never'
            : `${typeLabel(row.fix.type)} · ${fmtFixAge(row.fix.time, nowSeconds)}`
        }
      />
      {row.ll === null ? null : (
        <PopupRow label="Position" value={fmtLatLng(row.ll.lat, row.ll.lon)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar device card                                                 */
/* ------------------------------------------------------------------ */

function DeviceCard(props: {
  row: DeviceRow;
  nowSeconds: number;
  selected: boolean;
  onSelect: (simei: string) => void;
}) {
  const { row, nowSeconds, selected, onSelect } = props;
  const d = row.device;

  const batteryWidth = row.power === null ? 0 : Math.min(100, row.power);
  const batteryClass =
    row.power === null || row.power > 25
      ? 'dev-bar-fill'
      : row.power > 10
        ? 'dev-bar-fill dev-bar-fill-low'
        : 'dev-bar-fill dev-bar-fill-critical';
  const signalWidth = row.signal === null ? 0 : Math.min(100, row.signal);

  return (
    <button
      type="button"
      class={selected ? 'dev-card dev-card-selected' : 'dev-card'}
      aria-pressed={selected}
      onClick={() => onSelect(d.simei)}
    >
      <div class="dev-card-top">
        <span class="dev-name">{d.car_number !== '' ? d.car_number : `Device ${d.imei}`}</span>
        <span class="dev-card-badges">
          <span class={TONE_BADGE_CLASS[row.stateTone]}>{stateLabel(d.state)}</span>
          {d.expire === true ? <span class={TONE_BADGE_CLASS.expired}>Expired</span> : null}
        </span>
      </div>
      <div class="dev-meta">
        Last fix: {fmtFixAge(row.fix === null ? null : row.fix.time, nowSeconds)}
        {row.fix === null ? '' : ` · ${typeLabel(row.fix.type)}`}
      </div>
      <div class="dev-bars">
        <div class="dev-bar-row">
          <span>Battery</span>
          <div class="dev-bar-track">
            <div class={batteryClass} style={{ width: `${batteryWidth}%` }} />
          </div>
          <span class="dev-bar-value">{row.power === null ? '—' : String(Math.round(row.power))}</span>
        </div>
        <div class="dev-bar-row">
          <span>Signal</span>
          <div class="dev-bar-track">
            <div class="dev-bar-fill" style={{ width: `${signalWidth}%` }} />
          </div>
          <span class="dev-bar-value">
            {row.signal === null ? '—' : `${Math.round(row.signal)}%`}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function LiveScreen() {
  const { selectedSimei } = useAppState();
  const [devices, setDevices] = useState<LiveDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paused, setPaused] = useState(false);
  /** Bumped on every card click so re-selecting the same device re-focuses. */
  const [focusNonce, setFocusNonce] = useState(0);

  const inFlightRef = useRef(false);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry> | null>(null);
  const fittedRef = useRef(false);

  /* ---------------- polling ---------------- */

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      const res = await getRunInfo();
      const items = res.items ?? [];
      setDevices(items);
      rememberDevices(items);
      if (!getState().selectedSimei && items[0]?.simei) {
        setSelectedSimei(items[0].simei);
      }
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(
        err instanceof MapiError
          ? err.error_message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => {
        void refresh();
      }, POLL_INTERVAL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        setPaused(true);
      } else {
        setPaused(false);
        void refresh(); // pick up the hidden window immediately
        start();
      }
    };

    if (document.hidden) {
      setPaused(true);
    } else {
      start();
      void refresh();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [refresh]);

  /* ---------------- map lifecycle ---------------- */

  useEffect(() => {
    const host = mapHostRef.current;
    if (host === null) return;
    const map = L.map(host, { worldCopyJump: true }).setView([20, 0], MAP_START_ZOOM);
    L.tileLayer(OSM_TILES, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    markersRef.current = new Map();
    // The host's size can settle after first layout.
    const raf = requestAnimationFrame(() => map.invalidateSize());
    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  /* ---------------- derived rows ---------------- */

  const rows: DeviceRow[] = useMemo(() => {
    return (devices ?? []).map((device) => {
      const fix = parseLastPos(device.last_pos);
      const stateTone = stateToneOf(device);
      const power = finiteOr(device.power);
      return {
        device,
        fix,
        ll: fixLatLng(fix),
        tone: device.expire === true ? 'expired' : stateTone,
        stateTone,
        // The vendor's schema uses -1 as the "unknown" power sentinel
        // (research docs/protocol-notes.md: `power INTEGER DEFAULT -1`).
        power: power !== null && power >= 0 ? power : null,
        signal: finiteOr(device.signal_rate),
        speed: finiteOr(device.devspeed) ?? finiteOr(device.speed_value),
      };
    });
  }, [devices]);

  /* ---------------- marker sync ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    if (map === null || markers === null) return;
    const nowSeconds = Math.floor(Date.now() / 1000);

    const seen = new Set<string>();
    for (const row of rows) {
      const key = row.device.simei;
      if (row.ll === null || key === '') continue;
      seen.add(key);
      const selected = key === selectedSimei;
      const options: L.CircleMarkerOptions = {
        radius: selected ? 13 : 9,
        color: selected ? '#e2e8f0' : '#0f172a',
        weight: selected ? 3 : 2,
        fillColor: TONE_COLOR[row.tone],
        fillOpacity: 1,
      };
      let entry = markers.get(key);
      if (entry === undefined) {
        const marker = L.circleMarker([row.ll.lat, row.ll.lon], options).addTo(map);
        const popup = document.createElement('div');
        render(<PopupBody row={row} nowSeconds={nowSeconds} />, popup);
        marker.bindPopup(popup);
        entry = { marker, popup };
        markers.set(key, entry);
        if (selected) {
          // Selection happened before this marker existed (e.g. first load
          // after returning to the screen) — focus it now, once.
          map.setView([row.ll.lat, row.ll.lon], Math.max(map.getZoom(), SELECT_ZOOM));
          marker.openPopup();
        }
      } else {
        entry.marker.setLatLng([row.ll.lat, row.ll.lon]);
        entry.marker.setStyle(options);
        render(<PopupBody row={row} nowSeconds={nowSeconds} />, entry.popup);
      }
    }

    for (const [key, entry] of markers) {
      if (!seen.has(key)) {
        map.removeLayer(entry.marker);
        render(null, entry.popup);
        markers.delete(key);
      }
    }

    // First look at the fleet: frame every marker once (skipped when a
    // device is already selected, so the map does not jump away from it).
    if (!fittedRef.current && markers.size > 0 && selectedSimei === null) {
      const points: L.LatLng[] = [];
      for (const entry of markers.values()) {
        points.push(entry.marker.getLatLng());
      }
      map.fitBounds(L.latLngBounds(points).pad(0.25), { animate: false });
      fittedRef.current = true;
    }
  }, [rows, selectedSimei]);

  /* ---------------- selection focus ---------------- */

  useEffect(() => {
    if (selectedSimei === null) return;
    const map = mapRef.current;
    const entry = markersRef.current?.get(selectedSimei);
    if (map === null || map === undefined || entry === undefined) return;
    map.setView(entry.marker.getLatLng(), Math.max(map.getZoom(), SELECT_ZOOM), {
      animate: true,
    });
    entry.marker.openPopup();
  }, [selectedSimei, focusNonce]);

  const selectDevice = useCallback((simei: string) => {
    setSelectedSimei(simei);
    setFocusNonce((n) => n + 1);
  }, []);

  /* ---------------- render ---------------- */

  const nowSeconds = Math.floor(Date.now() / 1000);
  const loading = devices === null && error === null;

  return (
    <section class="live">
      <div class="live-toolbar">
        <h2>Live</h2>
        <button
          class="live-btn"
          type="button"
          disabled={refreshing}
          onClick={() => {
            void refresh();
          }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <span class="live-updated">
          {lastUpdated === null ? 'not updated yet' : `last updated ${fmtClock(lastUpdated)}`}
        </span>
        {paused ? <span class="live-paused">polling paused (tab hidden)</span> : null}
      </div>

      {error === null ? null : (
        <div class="live-banner" role="alert">
          <strong>Live data unavailable: </strong>
          {error}
        </div>
      )}

      <div class="live-layout">
        <aside class="dev-sidebar" aria-label="Devices">
          {loading ? (
            <>
              <div class="skeleton-card" />
              <div class="skeleton-card" />
              <div class="skeleton-card" />
            </>
          ) : rows.length === 0 ? (
            <div class="dev-empty">
              {devices === null
                ? 'Waiting for the first successful refresh…'
                : 'No devices yet. A tracker bound to your account will show up here.'}
            </div>
          ) : (
            rows.map((row) => (
              <DeviceCard
                key={row.device.simei}
                row={row}
                nowSeconds={nowSeconds}
                selected={row.device.simei === selectedSimei}
                onSelect={selectDevice}
              />
            ))
          )}
        </aside>
        <div class="live-map" ref={mapHostRef} />
      </div>
    </section>
  );
}
