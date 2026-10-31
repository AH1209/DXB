import webpush from 'web-push';
import { db, env, checked, rpc } from './db';
import { notificationBody } from './schedule';
import { validatePushEndpoint } from './security';
type Delivery = { id: string; event_id: string; subscription_id: string; claim_token: string };
export async function dispatch() {
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const claimed = await rpc<Delivery[]>('dxb_claim', { p_limit: 40 });
  let submitted = 0;
  let failed = 0;
  // Bounded batches: at most 4 * 5s network waits, within Netlify's execution limit.
  for (let i = 0; i < claimed.length; i += 10)
    await Promise.all(
      claimed.slice(i, i + 10).map(async (d) => {
        const client = db();
        const event = checked(
          await client.from('notification_events').select('*').eq('id', d.event_id).maybeSingle(),
        );
        const sub = checked(
          await client
            .from('push_subscriptions')
            .select('*')
            .eq('id', d.subscription_id)
            .maybeSingle(),
        );
        if (!event || !sub) return;
        const sender = event.sender_id
          ? checked(
              await client.from('contacts').select('name').eq('id', event.sender_id).maybeSingle(),
            )
          : null;
        if (event.kind !== 'test' && !sender) return;
        const reply = event.reply_id
          ? checked(
              await client.from('contacts').select('name').eq('id', event.reply_id).maybeSingle(),
            )
          : null;
        const prefs = checked(
          await client.from('app_settings').select('preferences').eq('id', true).single(),
        );
        validatePushEndpoint(sub.endpoint);
        if (!(await rpc<boolean>('dxb_begin_send', { p_id: d.id, p_token: d.claim_token }))) return;
        let status = 'submitted';
        let message: string | null = null;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              id: event.id,
              title: 'DXB · ' + (event.kind === 'test' ? 'Test' : sender?.name || 'Simulation'),
              body: notificationBody(event.kind, sender?.name || '', reply?.name),
              contactId: event.sender_id,
              badge: prefs?.preferences.badge !== false,
            }),
            { TTL: 120, urgency: 'normal', timeout: 5000, topic: event.id.replaceAll('-', '') },
          );
          submitted++;
        } catch (error) {
          const code = (error as { statusCode?: number }).statusCode;
          message = code
            ? `Push service HTTP ${code}`
            : 'Network interruption: push acceptance unknown';
          if (code === 404 || code === 410) {
            checked(
              await client
                .from('push_subscriptions')
                .update({ status: 'expired' })
                .eq('id', sub.id),
            );
            checked(
              await client
                .from('deliveries')
                .update({ status: 'cancelled', error: 'Subscription expired' })
                .eq('subscription_id', sub.id)
                .in('status', ['pending', 'claimed']),
            );
            status = 'failed';
          } else if (code === 429 || (code && code >= 500)) status = 'retry';
          else status = code ? 'failed' : 'unknown';
          failed++;
        }
        await rpc('dxb_finish', {
          p_id: d.id,
          p_token: d.claim_token,
          p_status: status,
          p_error: message,
        });
      }),
    );
  return { claimed: claimed.length, submitted, failed };
}
