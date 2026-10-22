import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getState, rememberDevices, setSelectedSimei, setSession } from './state';

/** Map-backed localStorage stub (node test env has none). */
const storageMap = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
  setItem: (k: string, v: string) => void storageMap.set(k, String(v)),
  removeItem: (k: string) => void storageMap.delete(k),
  clear: () => storageMap.clear(),
});

beforeEach(() => {
  storageMap.clear();
  clearSession();
});

describe('clearSession', () => {
  it('drops the session together with the account-scoped device selection', () => {
    setSession({ sid: 'SID' }, { account: 'a@b.c', loginAt: 1 });
    setSelectedSimei('DEVICE-A');
    rememberDevices([{ simei: 'DEVICE-A', car_number: 'Van', imei: 1 }]);
    expect(getState().selectedSimei).toBe('DEVICE-A');
    expect(getState().deviceNames['DEVICE-A']).toBe('Van');

    clearSession('session expired, please sign in');

    // The previous account's simei must not leak into the next session's
    // GetRunInfo/alarm.Get/QueryLocation calls or block Live auto-select.
    expect(getState().session).toBeNull();
    expect(getState().sessionNotice).toBe('session expired, please sign in');
    expect(getState().selectedSimei).toBeNull();
    expect(getState().deviceNames).toEqual({});
    expect(storageMap.has('qxgps.selectedSimei')).toBe(false);
    expect(storageMap.has('qxgps.deviceNames')).toBe(false);
  });
});
