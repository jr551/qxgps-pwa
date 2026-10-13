import { describe, expect, it } from 'vitest';
import { parseFenceItems, parseLastPos } from './types';

describe('parseLastPos', () => {
  it('decodes a sample last_pos blob', () => {
    const raw = JSON.stringify({
      addr: '',
      lat: 51_500_000,
      lon: -120_000,
      ptype: 'e_location_same',
      time: 1_788_623_795,
      type: 'e_static_wifi',
      wgs: '51.500000,-0.120000',
    });
    const pos = parseLastPos(raw);
    expect(pos?.wgs).toBe('51.500000,-0.120000');
    expect(pos?.lat).toBe(51_500_000);
  });
});

describe('parseFenceItems', () => {
  it('returns empty for bare success envelope', () => {
    expect(parseFenceItems({ errcode: 0, error_message: 'Get succeed.' })).toEqual([]);
  });

  it('normalises items array', () => {
    const items = parseFenceItems({
      errcode: 0,
      error_message: 'ok',
      items: [{ fenceId: 1, fencename: 'Yard' }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].fencename).toBe('Yard');
  });
});
