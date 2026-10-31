import { dispatch } from '../../server/push';
import { env } from '../../server/db';
import { equal } from '../../server/security';
export default async (request: Request) => {
  try {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!equal(request.headers.get('authorization') || '', `Bearer ${env('DISPATCH_SECRET')}`))
      return new Response('Unauthorized', { status: 401 });
    return Response.json(await dispatch(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Dispatcher failed', error instanceof Error ? error.message : 'Unknown');
    return Response.json({ error: 'Dispatcher failed; inspect function logs' }, { status: 500 });
  }
};
