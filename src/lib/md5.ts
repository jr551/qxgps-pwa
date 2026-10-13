/**
 * Minimal dependency-free MD5 (RFC 1321) producing a lowercase-hex digest.
 *
 * Used ONLY to build the vendor login's `pwd_md5`: the unsalted MD5 of the
 * trimmed plaintext password, lowercase hex, 32 chars — VERIFIED live
 * (docs/protocol-notes.md §2; the web portal's bundled js-md5 outputs hex
 * and the vendor accepted exactly this at merchant type 58).
 *
 * This module is pure computation: no I/O, no vendor calls, no secrets.
 */

/** Per-operation left-rotate amounts (RFC 1321 §3.4). */
const SHIFT = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);

/** Per-step additive constants: floor(|sin(i + 1)| * 2^32) (RFC 1321 §3.4). */
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

/** MD5 of raw bytes; returns the 16-byte digest. */
function md5Bytes(input: Uint8Array): Uint8Array {
  const len = input.length;
  // Padding: message + 0x80 + zeros + 64-bit little-endian bit length,
  // total a multiple of 64 bytes (RFC 1321 §3.2).
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLen = len * 8;
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const m = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      m[j] = view.getUint32(offset + j * 4, true);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = (f + a + K[i] + m[g]) | 0;
      a = d;
      d = c;
      c = b;
      // left-rotate tmp by SHIFT[i] (RFC 1321)
      b = (b + (((tmp << SHIFT[i]) | (tmp >>> (32 - SHIFT[i]))) | 0)) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const digest = new Uint8Array(16);
  const out = new DataView(digest.buffer);
  out.setUint32(0, a0 >>> 0, true);
  out.setUint32(4, b0 >>> 0, true);
  out.setUint32(8, c0 >>> 0, true);
  out.setUint32(12, d0 >>> 0, true);
  return digest;
}

const HEX = '0123456789abcdef';

/**
 * Lowercase-hex MD5 of a string (UTF-8 encoded) or raw bytes.
 *
 * Known vectors: md5('') === 'd41d8cd98f00b204e9800998ecf8427e',
 * md5('abc') === '900150983cd24fb0d6963f7d28e17f72'.
 */
export function md5(input: string | Uint8Array): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = md5Bytes(bytes);
  let hex = '';
  for (let i = 0; i < digest.length; i++) {
    hex += HEX[digest[i] >>> 4] + HEX[digest[i] & 0x0f];
  }
  return hex;
}
