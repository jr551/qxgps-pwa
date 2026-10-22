import { beforeEach, describe, expect, it, vi } from 'vitest';
import clientSrc from './client.ts?raw';
import settingsSrc from '../screens/settings.tsx?raw';
import { getAlarms, getRunInfo, getSession, getTrack, login, logout, rpc } from './client';
import { MapiError } from './types';
import { md5 } from '../lib/md5';

/**
 * Wire-contract tests for the mapi client. `fetch` and `localStorage` are
 * stubbed — NO network access. The responses below mirror the captured
 * vendor bodies in docs/protocol-notes.md. Static imports are fine: module
 * evaluation only touches localStorage through try/catch-guarded helpers, so
 * the stubs below take effect before any test body runs.
 */

/** Minimal Map-backed localStorage stub (node test env has none). */
const storageMap = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
  setItem: (k: string, v: string) => void storageMap.set(k, String(v)),
  removeItem: (k: string) => void storageMap.delete(k),
  clear: () => storageMap.clear(),
});

interface FetchCall {
  url: string;
  body: { module: string; func: string; params: Record<string, unknown> };
}

const fetchCalls: FetchCall[] = [];
type Reply = Record<string, unknown> | (() => Promise<Record<string, unknown>>);
const replyQueue: Reply[] = [];

function enqueue(...replies: Reply[]): void {
  replyQueue.push(...replies);
}

function envelope(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { errcode: 0, error_message: 'succeed.', ...extra };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.stubGlobal(
  'fetch',
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const reply = replyQueue.shift();
    if (reply === undefined) throw new Error('test: unexpected fetch call');
    fetchCalls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    const body = typeof reply === 'function' ? await reply() : reply;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    } as Response;
  },
);

function loginReply(sid: string, familySid: string): Record<string, unknown> {
  return envelope({ sid, familys: [{ sid: familySid }] });
}

beforeEach(() => {
  fetchCalls.length = 0;
  replyQueue.length = 0;
  storageMap.clear();
  logout();
});

describe('login wire contract', () => {
  it('sends the documented user.Login params and captures rotating familyid', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'));
    await login('  John.Doe@EXAMPLE.com  ', '  hunter2  ');

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    // Login must never carry a sid — not even in the query string.
    expect(call.url).not.toContain('sid=');
    expect(call.body.module).toBe('user');
    expect(call.body.func).toBe('Login');
    expect(call.body.params).toMatchObject({
      account: 'john.doe@EXAMPLE.com', // local part lowercased, domain kept
      info: '',
      lang: 'en',
      platform: 'web',
      type: 58,
    });
    expect(call.body.params.pwd_md5).toBe(md5('hunter2')); // trimmed password
    expect(call.body.params.pwd_md5).toMatch(/^[0-9a-f]{32}$/);

    const session = getSession();
    expect(session?.sid).toBe('SID-ONE');
    expect(session?.familyid).toBe('FAM-ONE');
  });

  it('re-reads familyid from each login response (it rotates per login)', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'), loginReply('SID-TWO', 'FAM-TWO'));
    await login('a@b.c', 'pw');
    await login('a@b.c', 'pw');
    expect(getSession()?.familyid).toBe('FAM-TWO');

    enqueue(envelope({ items: [] }));
    await getRunInfo();
    expect(fetchCalls[2].body.params.sfamily).toBe('FAM-TWO');
  });
});

describe('rpc transport', () => {
  it('appends sid only as a query param, never in the body', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'));
    await login('a@b.c', 'pw');

    enqueue(envelope({ items: [] }));
    await getRunInfo();

    const call = fetchCalls[1];
    expect(call.url).toContain('?sid=SID-ONE');
    expect(JSON.stringify(call.body)).not.toContain('SID-ONE');
    expect(call.body).toEqual({
      module: 'family',
      func: 'GetRunInfo',
      params: expect.objectContaining({ sfamily: 'FAM-ONE' }),
    });
  });

  it('a concurrent call during a silent re-login still carries the current sid', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'));
    await login('a@b.c', 'pw');
    fetchCalls.length = 0;

    // The re-login request stays in flight while another read runs.
    const held = deferred<Record<string, unknown>>();
    enqueue(() => held.promise, envelope({ items: [] }));
    const loginP = login('a@b.c', 'pw');
    await getRunInfo();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].body.func).toBe('Login');
    expect(fetchCalls[0].url).not.toContain('sid=');
    // OLD BUG: the global omitSid flag sent this request without ?sid=,
    // which the vendor answers with the stale-sid code — logging the user
    // out mid-session.
    expect(fetchCalls[1].url).toContain('?sid=SID-ONE');

    held.resolve(loginReply('SID-TWO', 'FAM-TWO'));
    await loginP;
  });

  it('re-logs in once on stale-sid and retries with the fresh sid', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'));
    await login('a@b.c', 'pw');
    fetchCalls.length = 0;

    enqueue(
      { errcode: 268697631, error_message: 'stale sid' },
      loginReply('SID-TWO', 'FAM-TWO'),
      envelope({ items: [] }),
    );
    await getRunInfo();

    expect(fetchCalls.map((c) => c.body.func)).toEqual([
      'GetRunInfo',
      'Login',
      'GetRunInfo',
    ]);
    expect(fetchCalls[1].url).not.toContain('sid=');
    expect(fetchCalls[2].url).toContain('?sid=SID-TWO');
    expect(fetchCalls[2].body.params.sfamily).toBe('FAM-TWO');
    expect(getSession()?.sid).toBe('SID-TWO');
  });

  it('surfaces errcode 268697648 (shape oracle) as MapiError, keeping the session', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'));
    await login('a@b.c', 'pw');

    enqueue({ errcode: 268697648, error_message: 'unknown func/param' });
    await expect(getRunInfo()).rejects.toBeInstanceOf(MapiError);
    expect(getSession()?.sid).toBe('SID-ONE');
  });
});

describe('alarm.Get and location.QueryLocation', () => {
  it('sends simei as a one-element array', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'));
    await login('a@b.c', 'pw');

    enqueue(envelope({ items: [] }));
    await getAlarms('DEVICE-1', { start: 1000, end: 2000, limit: 7 });
    expect(fetchCalls[1].body).toEqual({
      module: 'alarm',
      func: 'Get',
      params: {
        simei: ['DEVICE-1'],
        limit_size: 7,
        start_time: 1000,
        end_time: 2000,
      },
    });
  });

  it('pages QueryLocation with time_begin = last point time + 1', async () => {
    enqueue(loginReply('SID-ONE', 'FAM-ONE'));
    await login('a@b.c', 'pw');

    const point = (time: number) => ({
      duration: 0,
      end_time: 0,
      lat: 51_500_000 + time,
      lon: -120_000,
      ptype: 0,
      time,
      type: 1,
      wgs: '51.500000,-0.120000',
    });
    enqueue(
      envelope({ data: [point(100), point(200)], is_finish: false }),
      envelope({ data: [point(300)], is_finish: true }),
    );
    const days = await getTrack('DEVICE-1', 50, 9999);

    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[1].body.params.time_begin).toBe(50);
    expect(fetchCalls[1].body.params.limit_size).toBeLessThanOrEqual(2000);
    expect(fetchCalls[2].body.params.time_begin).toBe(201);
    expect(days.flatMap((d) => d.points)).toHaveLength(3);
  });
});

describe('read-only allowlist', () => {
  it('every literal rpc() func in src is Login or starts with Get/get/Query', () => {
    const callRe = /\brpc(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    const calls: string[] = [];
    for (const src of [clientSrc, settingsSrc]) {
      for (const m of src.matchAll(callRe)) {
        calls.push(`${m[1]}.${m[2]}`);
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) {
      const func = c.split('.')[1];
      expect(func === 'Login' || /^(?:[Gg]et|Query)/.test(func)).toBe(true);
    }
  });
});

describe('rpc without a session', () => {
  it('sends no sid when logged out', async () => {
    enqueue(envelope({}));
    await rpc('usermgr', 'GetUiFilePath', { filename: 'en' });
    expect(fetchCalls[0].url).not.toContain('sid=');
  });
});
