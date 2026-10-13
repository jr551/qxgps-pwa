import { useEffect, useMemo, useState } from 'preact/hooks';
import { getAlarms } from '../api/client';
import type { AlarmItem } from '../api/types';
import { useAppState } from '../state';
import { alarmTypeLabel, fmtDay, fmtTs } from '../lib/format';
import './alarms.css';

/**
 * Alarms screen — alarm/message list for the selected device.
 *
 * Data comes from client.getAlarms(simei, opts) only. The GetAlarmMessageModel
 * schema is PENDING (src/api/types.ts), so every row is parsed defensively:
 * the vendor field names seen in the app strings (send_time, record_time,
 * content, message, is_read, photos, alarm_type) and the scaffold names
 * (time, type, content, read) are both accepted, and missing fields degrade
 * to placeholders instead of throwing.
 *
 * STRICTLY READ-ONLY: this screen never marks an alarm read, never dismisses
 * one and never calls any Set*, Del* or command API — display only.
 */

type AlarmState =
  | { status: 'loading' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ok'; items: AlarmItem[] };

/** One normalized alarm row; every field is best-effort from an unknown wire shape. */
interface AlarmRow {
  key: string;
  /** Raw alarm_type/type value — used as the filter-chip identity. */
  typeRaw: string;
  typeLabel: string;
  /** Unix seconds when known. */
  time: number | null;
  text: string;
  read: boolean | null;
  photos: number | null;
}

function pick(rec: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = rec[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asUnix(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.round(value / 1000) : value;
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? Math.round(numeric / 1000) : numeric;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? Math.round(parsed / 1000) : null;
  }
  return null;
}

/** photos may be a count, an array of URLs or a delimited string — count them. */
function asCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
    return raw.split(/[,;|]/).filter((part) => part.trim() !== '').length;
  }
  return null;
}

/** is_read may be bool, 0/1 or '0'/'1'/'read'/'unread'. */
function asReadFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'read'].includes(raw)) return true;
    if (['0', 'false', 'no', 'n', 'unread'].includes(raw)) return false;
  }
  return null;
}

/** Normalizes one unknown wire row; exported for smoke coverage of the defensive parsing. */
export function normalizeAlarm(item: AlarmItem, index: number): AlarmRow {
  const rec = item as unknown as Record<string, unknown>;
  const typeRaw = asText(pick(rec, ['alarm_type', 'type', 'alarm_name']));
  return {
    key: asText(pick(rec, ['id', 'alarm_id', 'msg_id'])) || `alarm-${index}`,
    typeRaw,
    typeLabel: typeRaw ? alarmTypeLabel(typeRaw) : 'Unknown alarm type',
    time: asUnix(pick(rec, ['send_time', 'record_time', 'time', 'create_time'])),
    text: asText(pick(rec, ['content', 'message', 'title'])),
    read: asReadFlag(pick(rec, ['is_read', 'read'])),
    photos: asCount(pick(rec, ['photos', 'photo', 'images'])),
  };
}

export function AlarmsScreen({ embedded = false }: { embedded?: boolean }) {
  const { selectedSimei } = useAppState();
  const [state, setState] = useState<AlarmState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSimei) {
      setState({
        status: 'empty',
        message: 'No device selected — pick a device on the Live screen first.',
      });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    getAlarms(selectedSimei)
      .then((items) => {
        if (cancelled) return;
        setState({ status: 'ok', items: Array.isArray(items) ? items : [] });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSimei, reload]);

  const rows = useMemo(
    () => (state.status === 'ok' ? state.items.map(normalizeAlarm) : []),
    [state],
  );

  const typeOptions = useMemo(() => {
    const byRaw = new Map<string, string>();
    for (const row of rows) {
      if (row.typeRaw && !byRaw.has(row.typeRaw)) byRaw.set(row.typeRaw, row.typeLabel);
    }
    return [...byRaw.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const groups = useMemo(() => {
    const filtered = typeFilter === null ? rows : rows.filter((row) => row.typeRaw === typeFilter);
    const sorted = [...filtered].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
    const ordered: Array<{ key: string; label: string; rows: AlarmRow[] }> = [];
    for (const row of sorted) {
      const key = row.time !== null ? fmtDay(row.time) : 'unknown';
      const last = ordered[ordered.length - 1];
      if (last && last.key === key) {
        last.rows.push(row);
      } else {
        ordered.push({ key, label: key === 'unknown' ? 'Unknown date' : key, rows: [row] });
      }
    }
    return ordered;
  }, [rows, typeFilter]);

  return (
    <section>
      {embedded ? <h3 class="card-title">Alarms</h3> : <h2>Alarms</h2>}
      <p class="readonly-note">
        Read-only view: alarms are shown as received — never marked read, never dismissed.
      </p>

      {state.status === 'loading' && <p class="placeholder">Loading alarms…</p>}

      {state.status === 'empty' && <p class="placeholder">{state.message}</p>}

      {state.status === 'error' && (
        <div class="state-error">
          <p>Could not load alarms: {state.message}</p>
          <button type="button" class="retry-button" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {state.status === 'ok' && (
        <div>
          <div class="chip-row" role="group" aria-label="Filter by alarm type">
            <button
              type="button"
              class={typeFilter === null ? 'chip chip-active' : 'chip'}
              onClick={() => setTypeFilter(null)}
            >
              All
            </button>
            {typeOptions.map(([raw, label]) => (
              <button
                key={raw}
                type="button"
                class={typeFilter === raw ? 'chip chip-active' : 'chip'}
                onClick={() => setTypeFilter(raw)}
              >
                {label}
              </button>
            ))}
          </div>

          {rows.length === 0 && (
            <p class="placeholder">No alarms recorded for this device.</p>
          )}
          {rows.length > 0 && groups.length === 0 && (
            <p class="placeholder">No alarms match the selected type filter.</p>
          )}

          {groups.map((group) => (
            <section class="alarm-day" key={group.key}>
              <h3 class="alarm-day-header">{group.label}</h3>
              <ul class="alarm-list">
                {group.rows.map((row) => (
                  <li class="alarm-item" key={row.key}>
                    <div class="alarm-top">
                      <span class="alarm-type">{row.typeLabel}</span>
                      <time class="alarm-time">{fmtTs(row.time)}</time>
                    </div>
                    {row.text && <p class="alarm-text">{row.text}</p>}
                    <div class="alarm-meta">
                      <span
                        class={
                          row.read === true
                            ? 'badge badge-read'
                            : row.read === false
                              ? 'badge badge-unread'
                              : 'badge badge-unknown'
                        }
                      >
                        {row.read === true ? 'Read' : row.read === false ? 'Unread' : 'Read state unknown'}
                      </span>
                      {row.photos !== null && (
                        <span class="alarm-photos">
                          {row.photos} photo{row.photos === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
