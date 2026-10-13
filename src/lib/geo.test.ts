import { describe, expect, it } from 'vitest';
import { parseWgs, stateLabel, typeLabel } from './geo';

describe('parseWgs', () => {
  it('parses decimal lat,lon', () => {
    expect(parseWgs('51.500000,-0.120000')).toEqual({ lat: 51.5, lon: -0.12 });
  });

  it('rejects the vendor null island placeholder', () => {
    expect(parseWgs('0.0,0.0')).toBeNull();
  });
});

describe('stateLabel', () => {
  it('maps known device states', () => {
    expect(stateLabel('e_line_on')).toBe('Online');
    expect(stateLabel('e_line_sleep')).toBe('Sleeping');
  });
});

describe('typeLabel', () => {
  it('maps wifi fixes', () => {
    expect(typeLabel('e_wifi')).toBe('WiFi');
  });
});
