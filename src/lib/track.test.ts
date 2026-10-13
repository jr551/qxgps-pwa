import { describe, expect, it } from 'vitest';
import type { TrackPointWire } from '../api/types';
import {
  deriveSegmentSpeeds,
  haversineMeters,
  mapQueryLocationPoint,
  normaliseTrackResponse,
  trackDistanceMeters,
} from './track';

describe('mapQueryLocationPoint', () => {
  it('decodes vendor integer coords and wgs string', () => {
    const wire: TrackPointWire = {
      duration: 0,
      end_time: 0,
      lat: 51_501_000,
      lon: -121_000,
      ptype: 0,
      time: 1_788_623_103,
      type: 2,
      wgs: '51.501000,-0.121000',
    };
    const p = mapQueryLocationPoint(wire);
    expect(p.lat).toBeCloseTo(51.501, 5);
    expect(p.lon).toBeCloseTo(-0.121, 5);
    expect(p.time).toBe(wire.time);
    expect(p.type).toBe('2');
  });

  it('scales wire speed tenths to km/h', () => {
    const wire: TrackPointWire = {
      duration: 0,
      end_time: 0,
      lat: 51_503_000,
      lon: -123_000,
      ptype: 0,
      time: 1_790_006_361,
      type: 1,
      wgs: '51.503000,-0.123000',
      speed: 490,
      direction: 90,
    };
    const p = mapQueryLocationPoint(wire);
    expect(p.speed).toBe(49);
    expect(p.course).toBe(90);
  });
});

describe('normaliseTrackResponse', () => {
  it('accepts a flat array of points', () => {
    const norm = normaliseTrackResponse([
      { lat: 51.5, lon: -0.12, time: 1000 },
      { lat: 51.51, lon: -0.11, time: 1060 },
    ]);
    expect(norm.points).toHaveLength(2);
    expect(norm.timedPoints).toHaveLength(2);
    expect(norm.distanceMeters).toBeGreaterThan(0);
  });
});

describe('haversineMeters', () => {
  it('returns zero for identical points', () => {
    expect(haversineMeters({ lat: 51.5, lon: -0.12 }, { lat: 51.5, lon: -0.12 })).toBe(0);
  });
});

describe('deriveSegmentSpeeds', () => {
  it('returns empty for a single point', () => {
    expect(deriveSegmentSpeeds([{ time: 1, lat: 0, lon: 0, type: '' }])).toEqual([]);
  });
});

describe('trackDistanceMeters', () => {
  it('sums segment lengths', () => {
    const d = trackDistanceMeters([
      { time: 1, lat: 51.5, lon: -0.12, type: '' },
      { time: 2, lat: 51.51, lon: -0.12, type: '' },
    ]);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(2000);
  });
});
