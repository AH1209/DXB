import { createClient } from '@supabase/supabase-js';
import { HttpError } from './security';
export function env(name: string) {
  const v = process.env[name];
  if (!v || v.includes('YOUR_') || v.startsWith('REPLACE_'))
    throw new HttpError(
      503,
      'Server setup incomplete. Configure the environment variables in README.',
    );
  return v;
}
export function db() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function checked<T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): T {
  if (result.error) {
    if (result.error.code === '23505')
      throw new HttpError(409, 'An active session already exists. Refresh to view it.');
    if (result.error.message.includes('DXB:'))
      throw new HttpError(409, result.error.message.split('DXB:')[1]);
    console.error('Database operation failed', result.error.code);
    throw new HttpError(500, 'Database operation failed. Check server logs.');
  }
  return result.data;
}
export async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  return checked(await db().rpc(name, args)) as T;
}
