import { describe, expect, it } from 'vitest';
import {
  alarmItemId,
  collectNewAlarmNotifications,
  diffDeviceSnapshots,
  deviceSnapshotFromRunInfoItem,
  linkToneFromState,
} from './monitor-shared';

describe('monitor-shared', () => {
  it('derives alarm ids like getAlarms()', () => {
    expect(alarmItemId(10000000002, 1790006361, 'e_alarm_power_cut_off')).toBe(
      '10000000002-1790006361-e_alarm_power_cut_off',
    );
  });

  it('maps link states', () => {
    expect(linkToneFromState('e_line_on')).toBe('online');
    expect(linkToneFromState('e_line_sleep')).toBe('sleep');
    expect(linkToneFromState('e_line_off')).toBe('offline');
  });

  it('notifies on link state change when primed', () => {
    const simei = 'abc';
    const prev = new Map([
      [
        simei,
        deviceSnapshotFromRunInfoItem({
          simei,
          car_number: 'Van',
          state: 'e_line_on',
          power: 80,
          last_com_time: 1,
        }),
      ],
    ]);
    const { events } = diffDeviceSnapshots(
      prev,
      [
        deviceSnapshotFromRunInfoItem({
          simei,
          car_number: 'Van',
          state: 'e_line_off',
          power: 80,
          last_com_time: 2,
        }),
      ],
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('link_state');
    expect(events[0].body).toContain('Online');
    expect(events[0].body).toContain('Offline');
  });

  it('seeds alarms without notifying on first poll', () => {
    const seen = new Set<string>();
    const { events, primed } = collectNewAlarmNotifications(
      seen,
      [{ imei: 1, time: 2, type: 'e_alarm_sos', alarm_name: 'SOS' }],
      'Car',
      false,
    );
    expect(events).toHaveLength(0);
    expect(primed).toBe(true);
    expect(seen.size).toBe(1);
  });

  it('treats the vendor power sentinel (-1) as unknown, never low', () => {
    const simei = 'abc';
    const snap = deviceSnapshotFromRunInfoItem({
      simei,
      car_number: 'Van',
      state: 'e_line_on',
      power: -1,
      last_com_time: 1,
    });
    expect(snap.power).toBeNull();

    // A real low reading followed by the -1 sentinel must NOT raise a
    // low_battery event: -1 means the device stopped reporting charge.
    const prev = new Map([
      [
        simei,
        deviceSnapshotFromRunInfoItem({
          simei,
          car_number: 'Van',
          state: 'e_line_on',
          power: 12,
          last_com_time: 1,
        }),
      ],
    ]);
    const { events } = diffDeviceSnapshots(prev, [snap], true);
    expect(events.filter((e) => e.kind === 'low_battery')).toHaveLength(0);
  });

  it('stays silent for every caller that passes the pre-poll seed state', () => {
    const seen = new Set<string>();
    // Multi-device first pass: the caller keeps one primed flag per pass.
    // Both devices' stale rows are seeds; nothing notifies.
    const passPrimed = false;
    const first = collectNewAlarmNotifications(
      seen,
      [{ imei: 1, time: 2, type: 'e_alarm_sos', alarm_name: 'SOS' }],
      'Car1',
      passPrimed,
    );
    const second = collectNewAlarmNotifications(
      seen,
      [{ imei: 2, time: 3, type: 'e_alarm_shake', alarm_name: 'Shake' }],
      'Car2',
      passPrimed,
    );
    expect(first.events).toHaveLength(0);
    expect(second.events).toHaveLength(0);
    expect(seen.size).toBe(2);

    // A row arriving after the seed pass still notifies.
    const third = collectNewAlarmNotifications(
      seen,
      [{ imei: 2, time: 4, type: 'e_alarm_sos', alarm_name: 'SOS' }],
      'Car2',
      true,
    );
    expect(third.events).toHaveLength(1);
    expect(third.events[0].title).toBe('Car2');
  });
});
