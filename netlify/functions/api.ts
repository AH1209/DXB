import type { Context } from '@netlify/functions';
import { z, ZodError } from 'zod';
import sharp from 'sharp';
import {
  contactSchema,
  configSchema,
  defaults,
  settingsSchema,
  type Contact,
} from '../../src/domain';
import { checked, db, env, rpc } from '../../server/db';
import {
  cookie,
  equal,
  getToken,
  hash,
  HttpError,
  newToken,
  privateHash,
  requireOrigin,
  validatePushEndpoint,
} from '../../server/security';
import { createSchedule } from '../../server/schedule';
import { randomInt, randomUUID } from 'node:crypto';
import { dispatch } from '../../server/push';
const uuid = z.string().uuid();
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
async function body(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 3000000)
    throw new HttpError(413, 'Request is too large');
  const raw = await request.text();
  if (raw.length > 3000000) throw new HttpError(413, 'Request is too large');
  return JSON.parse(raw) as unknown;
}
export default async function handler(request: Request, context: Context) {
  try {
    const url = new URL(request.url);
    const path = url.pathname
      .replace(/^\/(?:\.netlify\/functions\/api|api)\/?/, '')
      .split('/')
      .filter(Boolean);
    const method = request.method;
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method))
      throw new HttpError(405, 'Method not allowed');
    const origin = env('APP_ORIGIN').replace(/\/$/, '');
    if (method !== 'GET') requireOrigin(request, origin);
    const client = db();
    const secure = origin.startsWith('https://');
    if (path[0] === 'login' && method === 'POST') {
      const secret = env('SESSION_SECRET');
      if (secret.length < 32)
        throw new HttpError(503, 'SESSION_SECRET must contain at least 32 characters');
      const ip = privateHash(context.ip || 'unknown', secret);
      const allowed = await rpc<boolean>('dxb_rate_limit', {
        p_key: `login:${ip}`,
        p_limit: 5,
        p_seconds: 900,
      });
      const global = await rpc<boolean>('dxb_rate_limit', {
        p_key: 'login:global',
        p_limit: 30,
        p_seconds: 900,
      });
      if (!allowed || !global)
        throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
      const { code } = z.object({ code: z.string().regex(/^\d{4}$/) }).parse(await body(request));
      const expected = process.env.ACCESS_CODE || (!secure ? '1509' : env('ACCESS_CODE'));
      if (!equal(code, expected)) throw new HttpError(401, 'That code is not correct. Try again.');
      const token = newToken();
      const now = await rpc<string>('dxb_now');
      checked(
        await client
          .from('auth_sessions')
          .insert({
            token_hash: hash(token),
            expires_at: new Date(new Date(now).getTime() + 2592000000).toISOString(),
          }),
      );
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(token, secure) });
    }
    const token = getToken(request.headers.get('cookie'));
    if (!token) throw new HttpError(401, 'Unlock DXB to continue.');
    const auth = checked(
      await client
        .from('auth_sessions')
        .select('expires_at')
        .eq('token_hash', hash(token))
        .maybeSingle(),
    );
    const now = await rpc<string>('dxb_now');
    if (!auth || new Date(auth.expires_at) <= new Date(now))
      throw new HttpError(401, 'Your access session has expired.');
    if (path[0] === 'bootstrap' && method === 'GET') {
      await rpc('dxb_expire');
      // Explicit pagination avoids Supabase's default 1,000-row truncation.
      const contacts: Contact[] = [];
      for (let offset = 0; ; offset += 1000) {
        const page = checked(
          await client
            .from('contacts')
            .select('*')
            .order('id')
            .range(offset, offset + 999),
        ) as Contact[];
        contacts.push(...page);
        if (page.length < 1000) break;
      }
      const settings = checked(
        await client.from('app_settings').select('preferences').eq('id', true).single(),
      );
      const subscriptions = checked(
        await client.from('push_subscriptions').select('id,device_id,status,last_success'),
      );
      return json({
        contacts: contacts.sort((a, b) => a.name.localeCompare(b.name)),
        settings: { ...defaults, ...settings?.preferences },
        session: await rpc('dxb_session_status'),
        subscriptions,
        publicKey: process.env.VAPID_PUBLIC_KEY || '',
        serverNow: now,
        authExpires: auth.expires_at,
      });
    }
    if (
      method !== 'GET' &&
      !(await rpc<boolean>('dxb_rate_limit', {
        p_key: `mutate:${hash(token)}`,
        p_limit: 120,
        p_seconds: 60,
      }))
    )
      throw new HttpError(429, 'Please wait a minute before trying again.');
    if (path[0] === 'logout' && method === 'POST') {
      const data = z
        .object({ deviceId: uuid.optional(), all: z.boolean().default(false) })
        .parse(await body(request));
      await rpc('dxb_stop');
      if (data.all) {
        checked(await client.from('auth_sessions').delete().neq('token_hash', ''));
        checked(
          await client
            .from('push_subscriptions')
            .update({ status: 'disabled' })
            .neq('status', 'disabled'),
        );
      } else {
        checked(await client.from('auth_sessions').delete().eq('token_hash', hash(token)));
        if (data.deviceId)
          checked(
            await client
              .from('push_subscriptions')
              .update({ status: 'disabled' })
              .eq('device_id', data.deviceId),
          );
      }
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('', secure, 0) });
    }
    if (path[0] === 'contacts') {
      const id = path[1] ? uuid.parse(path[1]) : null;
      if (method === 'POST' || method === 'PUT') {
        const contact = contactSchema.parse(await body(request));
        const saved = await rpc<string>('dxb_save_contact', { p_id: id, p_data: contact });
        return json({ id: saved }, 201);
      }
      if (method === 'DELETE' && id) {
        const oldPath = await rpc<string | null>('dxb_delete_contact', { p_id: id });
        if (oldPath) await client.storage.from('avatars').remove([oldPath]);
        return json({ ok: true });
      }
    }
    if (path[0] === 'avatars' && path[1]) {
      const id = uuid.parse(path[1]);
      const contact = checked(
        await client.from('contacts').select('avatar_path').eq('id', id).single(),
      );
      if (!contact) throw new HttpError(404, 'Contact no longer exists');
      if (method === 'GET') {
        if (!contact.avatar_path) throw new HttpError(404, 'No photo');
        const file = checked(await client.storage.from('avatars').download(contact.avatar_path));
        return new Response(file, {
          headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' },
        });
      }
      if (method === 'PUT') {
        const { image } = z.object({ image: z.string().max(2800000) }).parse(await body(request));
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(image))
          throw new HttpError(400, 'Use a PNG, JPEG or WebP photo');
        const input = Buffer.from(image.split(',')[1], 'base64');
        if (input.length > 2097152) throw new HttpError(413, 'Photo must be under 2 MB');
        const output = await sharp(input, { limitInputPixels: 20000000 })
          .rotate()
          .resize(256, 256, { fit: 'cover' })
          .webp({ quality: 85 })
          .toBuffer();
        const newPath = `${id}/${randomUUID()}.webp`;
        checked(
          await client.storage
            .from('avatars')
            .upload(newPath, output, { contentType: 'image/webp' }),
        );
        const updated = await client
          .from('contacts')
          .update({ avatar_path: newPath })
          .eq('id', id)
          .select('id')
          .maybeSingle();
        if (updated.error || !updated.data) {
          await client.storage.from('avatars').remove([newPath]);
          throw new HttpError(409, 'Contact no longer exists');
        }
        if (contact.avatar_path) await client.storage.from('avatars').remove([contact.avatar_path]);
        return json({ ok: true });
      }
    }
    if (path[0] === 'settings' && method === 'PUT') {
      const prefs = settingsSchema.parse(await body(request));
      checked(await client.from('app_settings').update({ preferences: prefs }).eq('id', true));
      return json({ ok: true });
    }
    if (path[0] === 'subscriptions' && method === 'POST') {
      const data = z
        .object({
          deviceId: uuid,
          subscription: z.object({
            endpoint: z.string().url().max(2048),
            keys: z.object({
              p256dh: z
                .string()
                .regex(/^[A-Za-z0-9_-]+$/)
                .min(80)
                .max(100),
              auth: z
                .string()
                .regex(/^[A-Za-z0-9_-]+$/)
                .min(20)
                .max(30),
            }),
          }),
        })
        .parse(await body(request));
      validatePushEndpoint(data.subscription.endpoint);
      const existing = checked(
        await client
          .from('push_subscriptions')
          .select('id,device_id')
          .eq('endpoint', data.subscription.endpoint)
          .maybeSingle(),
      );
      if (existing && existing.device_id !== data.deviceId)
        checked(await client.from('push_subscriptions').delete().eq('id', existing.id));
      checked(
        await client
          .from('push_subscriptions')
          .upsert(
            {
              device_id: data.deviceId,
              endpoint: data.subscription.endpoint,
              keys: data.subscription.keys,
              status: 'active',
            },
            { onConflict: 'device_id' },
          ),
      );
      return json({ ok: true });
    }
    if (path[0] === 'sessions' && method === 'POST') {
      if (path[1] === 'stop') {
        await rpc('dxb_stop');
        return json({ ok: true });
      }
      const { requestId, deviceId, config } = z
        .object({ requestId: uuid, deviceId: uuid, config: configSchema })
        .parse(await body(request));
      const registered = checked(
        await client
          .from('push_subscriptions')
          .select('id')
          .eq('device_id', deviceId)
          .eq('status', 'active')
          .maybeSingle(),
      );
      if (!registered) throw new HttpError(409, 'Enable notifications on this device first');
      const contacts: Contact[] = [];
      for (let offset = 0; ; offset += 1000) {
        const page = checked(
          await client
            .from('contacts')
            .select('*')
            .order('id')
            .range(offset, offset + 999),
        ) as Contact[];
        contacts.push(...page);
        if (page.length < 1000) break;
      }
      const start = new Date(await rpc<string>('dxb_now'));
      const events = createSchedule(config, contacts, start, () => randomInt(0, 1000000) / 1000000);
      const id = await rpc<string>('dxb_start', {
        p_request: requestId,
        p_config: config,
        p_events: events,
        p_start: start.toISOString(),
      });
      return json({ id }, 201);
    }
    if (path[0] === 'test' && method === 'POST') {
      if (!(await rpc<boolean>('dxb_rate_limit', { p_key: 'test', p_limit: 5, p_seconds: 60 })))
        throw new HttpError(429, 'Test limit reached. Wait one minute.');
      const { deviceId, delayed } = z
        .object({ deviceId: uuid, delayed: z.boolean() })
        .parse(await body(request));
      const id = await rpc<string>('dxb_test', { p_device: deviceId, p_delay: delayed ? 60 : 0 });
      if (!delayed) await dispatch();
      const delivery = checked(
        await client.from('deliveries').select('status,error').eq('event_id', id).single(),
      );
      return json({ id, ...delivery });
    }
    throw new HttpError(404, 'Endpoint not found');
  } catch (error) {
    if (error instanceof ZodError)
      return json({ error: error.issues.map((i) => i.message).join('. ') }, 400);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid request body' }, 400);
    console.error('DXB API failed', error instanceof Error ? error.message : 'Unknown error');
    return json(
      { error: 'Unable to complete this request. Check server logs and try again.' },
      500,
    );
  }
}
