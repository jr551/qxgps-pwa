import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { getConfig, getDetail } from '../api/client';
import { parseLastPos } from '../api/types';
import type { DeviceConfig, DeviceConfigSection, DeviceDetail } from '../api/types';
import { useAppState } from '../state';
import {
  ACC_POWER_LABELS,
  ACC_STATE_LABELS,
  CAR_SWITCH_LABELS,
  CMD_LABELS,
  DASH,
  fmtDur,
  fmtTs,
  labelFor,
  LOC_TYPE_LABELS,
  STATE_LABELS,
} from '../lib/format';
import './device.css';

/**
 * Device screen — identity, live status, location snapshot and a read-only
 * configuration view for the selected device.
 *
 * Data comes from client.getDetail(simei) and client.getConfig(simei) only
 * (schemas summarised in docs/protocol-notes.md).
 *
 * STRICTLY READ-ONLY: config values, car_switch flags, cmd_type commands and
 * phone numbers are rendered exactly as reported. This screen never issues a
 * device command, never writes configuration and never calls any Set*, Add*,
 * Del* or command API.
 */

type Load<T> =
  | { status: 'loading' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T };

/** Display string for a possibly-missing vendor field. */
export function show(value: unknown): string {
  const s = String(value ?? '').trim();
  return s === '' ? DASH : s;
}

/** -1 = "default/not set" in the car_switch capture; 1/0 map to ON/OFF. */
export function switchState(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (n === 1) return 'ON';
  if (n === 0) return 'OFF';
  if (n === -1) return 'unset';
  return show(value);
}

export function scalarValue(value: unknown): string {
  if (typeof value === 'number') return value === -1 ? 'default (unset)' : String(value);
  return show(value);
}

function LoadBlock(props: {
  state: Load<unknown>;
  onRetry: () => void;
  children: ComponentChildren;
}) {
  if (props.state.status === 'loading') {
    return <p class="placeholder">Loading…</p>;
  }
  if (props.state.status === 'empty') {
    return <p class="placeholder">{props.state.message}</p>;
  }
  if (props.state.status === 'error') {
    return (
      <div class="state-error">
        <p>Could not load: {props.state.message}</p>
        <button type="button" class="retry-button" onClick={props.onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return <>{props.children}</>;
}

function SectionCard(props: { title: string; note?: string; children: ComponentChildren }) {
  return (
    <section class="card">
      <h3 class="card-title">{props.title}</h3>
      {props.note && <p class="card-note">{props.note}</p>}
      {props.children}
    </section>
  );
}

function Field(props: { label: string; value: ComponentChildren; sub?: ComponentChildren }) {
  return (
    <div class="field">
      <span class="field-label">{props.label}</span>
      <span class="field-value">{props.value}</span>
      {props.sub && <span class="field-sub">{props.sub}</span>}
    </div>
  );
}

/** Human label + the raw e_* value behind it (nothing is silently invented). */
function EnumValue(props: { map: Record<string, string>; raw: unknown }) {
  return (
    <span>
      {labelFor(props.map, props.raw)} <span class="raw-code">{show(props.raw)}</span>
    </span>
  );
}

export function DeviceScreen() {
  const { selectedSimei } = useAppState();
  const [detailState, setDetailState] = useState<Load<DeviceDetail>>({ status: 'loading' });
  const [configState, setConfigState] = useState<Load<DeviceConfig>>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Ticks the expiry countdown and "last seen" ages.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedSimei) {
      const message = 'No device selected — pick a device on the Live screen first.';
      setDetailState({ status: 'empty', message });
      setConfigState({ status: 'empty', message });
      return;
    }
    let cancelled = false;
    setDetailState({ status: 'loading' });
    setConfigState({ status: 'loading' });
    getDetail(selectedSimei)
      .then((data) => {
        if (!cancelled) setDetailState({ status: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetailState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    getConfig(selectedSimei)
      .then((data) => {
        if (!cancelled) setConfigState({ status: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConfigState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSimei, reload]);

  const detail = detailState.status === 'ok' ? detailState.data : null;
  const config = configState.status === 'ok' ? configState.data : null;
  const info = detail ? detail.detail : null;
  const section: DeviceConfigSection | null = config ? config.config : null;
  const pos = detail ? parseLastPos(detail.last_pos) : null;

  const endTs = info ? Number(info.end_dev_time) || 0 : 0;
  const remaining = endTs > 0 ? Math.floor(endTs - now / 1000) : null;

  return (
    <section>
      <h2>Device</h2>
      <p class="readonly-note">
        Read-only view: this client never sends device commands or config changes.
      </p>

      <SectionCard title="Identity">
        <LoadBlock state={detailState} onRetry={() => setReload((n) => n + 1)}>
          {detail && (
            <div class="field-grid">
              <Field label="Name" value={show(info ? info.car_number : '')} />
              <Field label="IMEI" value={show(detail.imei)} />
              <Field label="ICCID" value={show(detail.iccid)} />
              <Field label="Firmware" value={show(detail.version || detail.ver)} />
              <Field
                label="Protocol"
                value={show(detail.protocol_name)}
                sub={<span class="raw-code">protocol {show(detail.protocol)}</span>}
              />
              <Field
                label="Service"
                value={detail.expire ? 'Expired' : 'Active'}
                sub={
                  remaining === null ? (
                    DASH
                  ) : (
                    <span>
                      {remaining >= 0
                        ? `expires in ${fmtDur(remaining)}`
                        : `expired ${fmtDur(-remaining)} ago`}{' '}
                      · {fmtTs(endTs)}
                    </span>
                  )
                }
              />
            </div>
          )}
        </LoadBlock>
      </SectionCard>

      <SectionCard title="Status">
        <LoadBlock state={detailState} onRetry={() => setReload((n) => n + 1)}>
          {detail && (
            <div class="field-grid">
              <Field label="Link state" value={<EnumValue map={STATE_LABELS} raw={detail.state} />} />
              <Field label="Power" value={`${show(detail.power)}%`} />
              <Field label="Signal strength" value={`${show(detail.signal_rate)}%`} />
              <Field label="ACC state" value={<EnumValue map={ACC_STATE_LABELS} raw={detail.acc_state} />} />
              <Field label="External power" value={<EnumValue map={ACC_POWER_LABELS} raw={detail.acc_power} />} />
              <Field label="External voltage" value={show(detail.external_voltage)} />
              <Field label="Day distance" value={show(detail.day_distance)} />
              <Field
                label="Last communication"
                value={fmtTs(detail.last_com_time)}
                sub={detail.last_com_time ? `${fmtDur(now / 1000 - detail.last_com_time)} ago` : DASH}
              />
              <Field
                label="Came online"
                value={fmtTs(detail.up_line_time)}
                sub={detail.up_line_time ? `${fmtDur(now / 1000 - detail.up_line_time)} ago` : DASH}
              />
              <Field
                label="Went offline"
                value={fmtTs(detail.down_line_time)}
                sub={
                  detail.down_line_time
                    ? `${fmtDur(now / 1000 - detail.down_line_time)} ago`
                    : 'never recorded'
                }
              />
            </div>
          )}
        </LoadBlock>
      </SectionCard>

      <SectionCard title="Last position">
        <LoadBlock state={detailState} onRetry={() => setReload((n) => n + 1)}>
          {detail &&
            (pos ? (
              <div class="field-grid">
                <Field label="Fix type" value={<EnumValue map={LOC_TYPE_LABELS} raw={pos.type} />} />
                <Field
                  label="Fix time"
                  value={fmtTs(pos.time)}
                  sub={pos.time ? `${fmtDur(now / 1000 - pos.time)} ago` : DASH}
                />
                <Field
                  label="Coordinates"
                  value={
                    pos.wgs && pos.wgs.includes(',')
                      ? pos.wgs
                      : `${(pos.lat / 1e6).toFixed(6)}, ${(pos.lon / 1e6).toFixed(6)}`
                  }
                />
                <Field label="Address" value={show(pos.addr) === DASH ? 'no address returned' : pos.addr} />
              </div>
            ) : (
              <p class="placeholder">No position recorded for this device.</p>
            ))}
        </LoadBlock>
      </SectionCard>

      <SectionCard
        title="Configuration (read-only)"
        note="Values are shown exactly as the device reports them; nothing here can be changed from this client."
      >
        <LoadBlock state={configState} onRetry={() => setReload((n) => n + 1)}>
          {section && (
            <div>
              <h4 class="sub-title">Feature switches</h4>
              <div class="chip-row">
                {Object.entries(section.car_switch ?? {})
                  .sort((a, b) => {
                    const labelA = labelFor(CAR_SWITCH_LABELS, a[0]);
                    const labelB = labelFor(CAR_SWITCH_LABELS, b[0]);
                    return labelA.localeCompare(labelB);
                  })
                  .map(([key, value]) => {
                    const state = switchState(value);
                    return (
                      <span
                        key={key}
                        class={`chip chip-${state === 'ON' ? 'on' : state === 'OFF' ? 'off' : 'unset'}`}
                        title={`${key} = ${show(value)}`}
                      >
                        <span class="chip-label">{labelFor(CAR_SWITCH_LABELS, key)}</span>{' '}
                        <span class="chip-state">{state}</span>
                      </span>
                    );
                  })}
              </div>

              <h4 class="sub-title">Thresholds &amp; intervals</h4>
              <div class="field-grid">
                <Field label="Location interval" value={scalarValue(section.locint_val)} sub="seconds" />
                <Field label="Sleep interval" value={scalarValue(section.sleep_intval)} />
                <Field label="After sleep" value={scalarValue(section.after_sleep)} />
                <Field label="Speed threshold" value={scalarValue(section.speed_value)} />
                <Field label="Vibration threshold" value={scalarValue(section.shake_value)} />
                <Field label="Alarm space" value={scalarValue(section.alarm_space)} />
                <Field label="Pdis" value={scalarValue(section.pdis)} />
                <Field label="Device log" value={scalarValue(section.dev_log)} />
                <Field label="Language" value={scalarValue(section.language)} />
              </div>

              <h4 class="sub-title">Command types</h4>
              <p class="card-note">commands disabled — read-only client</p>
              <div class="chip-row">
                {(config ? config.cmd_type : []).map((cmd) => (
                  <span class="chip chip-cmd" key={cmd} title={cmd}>
                    {labelFor(CMD_LABELS, cmd)}
                  </span>
                ))}
                {config && config.cmd_type.length === 0 && (
                  <span class="raw-code">none reported</span>
                )}
              </div>

              <h4 class="sub-title">Phone numbers (display only)</h4>
              <div class="field-grid">
                <Field label="Center phone" value={show(detail ? detail.center_phone : '')} />
                <Field label="Phone book" value={show(section.phone_book)} />
              </div>
            </div>
          )}
        </LoadBlock>
      </SectionCard>
    </section>
  );
}
