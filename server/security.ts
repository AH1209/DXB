import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function equal(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export function newToken() {
  return randomBytes(32).toString('base64url');
}
export function privateHash(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function cookie(token: string, secure: boolean, maxAge = 2592000) {
  return `dxb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function getToken(header: string | null) {
  return (
    header
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('dxb_session='))
      ?.slice(12) || ''
  );
}
export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin)
    throw new HttpError(403, 'Request origin not allowed');
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validatePushEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  const h = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !(
      [
        'fcm.googleapis.com',
        'updates.push.services.mozilla.com',
        'updates-autopush.stage.mozaws.net',
      ].includes(h) ||
      h === 'web.push.apple.com' ||
      h.endsWith('.push.apple.com')
    )
  )
    throw new HttpError(400, 'Unsupported push service endpoint');
}
