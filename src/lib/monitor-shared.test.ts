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
});
