import { describe, expect, it } from 'vitest';
import { md5 } from './md5';

describe('md5', () => {
  it('matches RFC 1321 vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});
