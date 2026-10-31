import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Context } from '@netlify/functions';
const state = vi.hoisted(() => ({
  allowed: true,
  inserted: [] as unknown[],
  origin: 'https://dxb.test',
}));
vi.mock('../server/db', () => ({
  env: (name: string) =>
    ({ APP_ORIGIN: state.origin, SESSION_SECRET: 's'.repeat(64), ACCESS_CODE: '1509' })[name] ||
    'configured',
  checked: <T>(result: { data: T }) => result.data,
  rpc: async (name: string) =>
    name === 'dxb_now' ? '2026-10-31T12:00:00Z' : name === 'dxb_rate_limit' ? state.allowed : null,
  db: () => ({
    from: () => ({
      insert: async (data: unknown) => {
        state.inserted.push(data);
        return { data: null, error: null };
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));
import handler from '../netlify/functions/api';
const context = { ip: '192.0.2.1' } as Context;
beforeEach(() => {
  state.allowed = true;
  state.inserted = [];
  process.env.ACCESS_CODE = '1509';
});
function request(code: string, origin = 'https://dxb.test') {
  return new Request('https://dxb.test/api/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}
describe('protected API', () => {
  it('verifies the code on the server and issues a hashed persistent session', async () => {
    const response = await handler(request('1509'), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toHaveProperty('token_hash');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects an incorrect code without creating a session', async () => {
    const response = await handler(request('9999'), context);
    expect(response.status).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });
  it('enforces persistent rate limits before accepting even the correct code', async () => {
    state.allowed = false;
    const response = await handler(request('1509'), context);
    expect(response.status).toBe(429);
    expect(state.inserted).toHaveLength(0);
  });
  it('rejects cross-origin login', async () => {
    expect((await handler(request('1509', 'https://other.test'), context)).status).toBe(403);
  });
  it('protects contact operations without a cookie', async () => {
    const response = await handler(
      new Request('https://dxb.test/api/contacts', {
        method: 'POST',
        headers: { origin: 'https://dxb.test' },
        body: '{}',
      }),
      context,
    );
    expect(response.status).toBe(401);
  });
  it('rejects a fabricated session token', async () => {
    const response = await handler(
      new Request('https://dxb.test/api/bootstrap', { headers: { cookie: 'dxb_session=forged' } }),
      context,
    );
    expect(response.status).toBe(401);
  });
});
