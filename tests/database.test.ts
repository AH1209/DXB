import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await pg.exec(readFileSync('supabase/migrations/001_dxb.sql', 'utf8'));
}, 60000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec(
    'truncate deliveries, notification_events, sessions, contacts, push_subscriptions, auth_sessions, rate_limits cascade;',
  );
});
async function scalar<T>(sql: string, args: unknown[] = []) {
  const r = await pg.query<{ v: T }>(sql, args);
  return r.rows[0]?.v;
}
async function fixture() {
  const contact = await scalar<string>(
    "insert into contacts(name,country,timezone) values('Alex','GB','Europe/London') returning id as v",
  );
  const device = randomUUID();
  const sub = await scalar<string>(
    "insert into push_subscriptions(device_id,endpoint,keys) values($1,'https://fcm.googleapis.com/test','{}') returning id as v",
    [device],
  );
  return { contact, device, sub };
}
async function start(contact: string, request = randomUUID()) {
  const cfg = {
    duration: 1,
    frequency: 5,
    overrides: [],
    selected: [contact],
    distribution: { message: 70, image: 20, reply: 10 },
  };
  const now = await scalar<string>('select now()::text as v');
  const events = [{ sender_id: contact, reply_id: null, kind: 'message', scheduled_at: now }];
  return scalar<string>('select dxb_start($1,$2::jsonb,$3::jsonb,$4::timestamptz) as v', [
    request,
    JSON.stringify(cfg),
    JSON.stringify(events),
    now,
  ]);
}
describe('real PostgreSQL migration and transactions', () => {
  it('has no browser table access or RPC execution', async () => {
    expect(
      await scalar<boolean>("select has_table_privilege('anon','contacts','select') as v"),
    ).toBe(false);
    expect(
      await scalar<boolean>("select has_function_privilege('anon','dxb_stop()','execute') as v"),
    ).toBe(false);
    expect(
      await scalar<boolean>(
        "select relrowsecurity as v from pg_class where oid='contacts'::regclass",
      ),
    ).toBe(true);
  });
  it('persists and atomically limits code attempts', async () => {
    for (let i = 0; i < 5; i++)
      expect(await scalar<boolean>("select dxb_rate_limit('ip',5,900) as v")).toBe(true);
    expect(await scalar<boolean>("select dxb_rate_limit('ip',5,900) as v")).toBe(false);
    await pg.exec("update rate_limits set window_start=now()-interval '16 minutes'");
    expect(await scalar<boolean>("select dxb_rate_limit('ip',5,900) as v")).toBe(true);
  });
  it('creates one schedule and is idempotent across repeated starts', async () => {
    const { contact } = await fixture();
    const request = randomUUID();
    const id = await start(contact, request);
    expect(await start(contact, request)).toBe(id);
    expect(await scalar<number>('select count(*)::int as v from notification_events')).toBe(1);
    await expect(start(contact)).rejects.toThrow('already active');
  });
  it('claims once across overlapping dispatch calls', async () => {
    const { contact } = await fixture();
    await start(contact);
    const results = await Promise.all([
      pg.query('select * from dxb_claim(40)'),
      pg.query('select * from dxb_claim(40)'),
    ]);
    expect(results.reduce((n, r) => n + r.rows.length, 0)).toBe(1);
  });
  it('prevents a claimed delivery from sending after Stop', async () => {
    const { contact } = await fixture();
    await start(contact);
    const { rows } = await pg.query<{ id: string; claim_token: string }>(
      'select * from dxb_claim(40)',
    );
    await pg.exec('select dxb_stop()');
    expect(
      await scalar<boolean>('select dxb_begin_send($1,$2) as v', [rows[0].id, rows[0].claim_token]),
    ).toBe(false);
    expect(await scalar<string>('select status as v from deliveries')).toBe('cancelled');
    expect(await scalar<string>('select status as v from sessions')).toBe('stopped');
  });
  it('records accepted pushes once, updates contact activity, rejects stale claims', async () => {
    const { contact } = await fixture();
    await start(contact);
    const { rows } = await pg.query<{ id: string; claim_token: string }>(
      'select * from dxb_claim(40)',
    );
    const d = rows[0];
    expect(await scalar<boolean>('select dxb_begin_send($1,$2) as v', [d.id, d.claim_token])).toBe(
      true,
    );
    expect(await scalar<boolean>('select dxb_begin_send($1,$2) as v', [d.id, d.claim_token])).toBe(
      false,
    );
    await pg.query("select dxb_finish($1,$2,'submitted',null)", [d.id, d.claim_token]);
    expect(await scalar<string>('select status as v from deliveries')).toBe('submitted');
    expect(await scalar<boolean>('select last_activity is not null as v from contacts')).toBe(true);
    expect((await pg.query('select * from dxb_claim()')).rows).toHaveLength(0);
  });
  it('retries explicit rejection, but never retries an ambiguous send', async () => {
    const { contact } = await fixture();
    await start(contact);
    let d = (await pg.query<{ id: string; claim_token: string }>('select * from dxb_claim()'))
      .rows[0];
    await pg.query('select dxb_begin_send($1,$2)', [d.id, d.claim_token]);
    await pg.query("select dxb_finish($1,$2,'retry','HTTP 503')", [d.id, d.claim_token]);
    expect(await scalar<string>('select status as v from deliveries')).toBe('pending');
    await pg.exec('update deliveries set available_at=now()');
    d = (await pg.query<{ id: string; claim_token: string }>('select * from dxb_claim()')).rows[0];
    await pg.query('select dxb_begin_send($1,$2)', [d.id, d.claim_token]);
    await pg.exec(
      "update deliveries set lease_until=now()-interval '1 second'; select dxb_expire()",
    );
    expect(await scalar<string>('select status as v from deliveries')).toBe('unknown');
    expect((await pg.query('select * from dxb_claim()')).rows).toHaveLength(0);
  });
  it('expires sessions independently of a browser clock', async () => {
    const { contact } = await fixture();
    await start(contact);
    await pg.exec(
      "update sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour';select dxb_expire()",
    );
    expect(await scalar<string>('select status as v from sessions')).toBe('completed');
    expect(await scalar<string>('select status as v from deliveries')).toBe('cancelled');
    await expect(start(contact)).resolves.toBeTruthy();
  });
  it('deletion removes sender events and resets reply targets', async () => {
    const { contact } = await fixture();
    await start(contact);
    await pg.query('select dxb_delete_contact($1)', [contact]);
    expect(await scalar<number>('select count(*)::int as v from deliveries')).toBe(0);
    expect(await scalar<number>('select count(*)::int as v from notification_events')).toBe(0);
  });
  it('locks edits during active sessions', async () => {
    const { contact } = await fixture();
    await start(contact);
    await expect(pg.query("select dxb_save_contact($1,'{}')", [contact])).rejects.toThrow(
      'Stop the active session',
    );
  });
  it('schedules a delayed test through the same delivery queue', async () => {
    const { device } = await fixture();
    await pg.query('select dxb_test($1,60)', [device]);
    expect((await pg.query('select * from dxb_claim()')).rows).toHaveLength(0);
    await pg.exec(
      'update deliveries set available_at=now();update notification_events set scheduled_at=now()',
    );
    expect((await pg.query('select * from dxb_claim()')).rows).toHaveLength(1);
  });
  it('cleans expired authentication sessions', async () => {
    await pg.exec(
      "insert into auth_sessions values('expired',now()-interval '1 second',now());select dxb_expire()",
    );
    expect(await scalar<number>('select count(*)::int as v from auth_sessions')).toBe(0);
  });
});
