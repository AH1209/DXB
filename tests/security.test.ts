import { describe, it, expect } from 'vitest';
import {
  cookie,
  equal,
  getToken,
  hash,
  newToken,
  privateHash,
  requireOrigin,
  validatePushEndpoint,
} from '../server/security';
describe('authentication primitives', () => {
  it('issues unpredictable tokens and stores only hashes', () => {
    const a = newToken(),
      b = newToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(40);
    expect(hash(a)).toHaveLength(64);
    expect(hash(a)).not.toContain(a);
  });
  it('compares codes safely', () => {
    expect(equal('1509', '1509')).toBe(true);
    expect(equal('1509', '0000')).toBe(false);
    expect(equal('1509', '')).toBe(false);
  });
  it('creates protected persistent cookies and logout cookies', () => {
    expect(cookie('abc', true)).toContain('HttpOnly; SameSite=Strict');
    expect(cookie('abc', true)).toContain('Secure');
    expect(cookie('', true, 0)).toContain('Max-Age=0');
    expect(getToken('x=y; dxb_session=abc; a=b')).toBe('abc');
    expect(getToken(null)).toBe('');
  });
  it('rejects cross-origin and originless mutations', () => {
    expect(() =>
      requireOrigin(
        new Request('https://dxb.test', { headers: { origin: 'https://evil.test' } }),
        'https://dxb.test',
      ),
    ).toThrow();
    expect(() => requireOrigin(new Request('https://dxb.test'), 'https://dxb.test')).toThrow();
    expect(() =>
      requireOrigin(
        new Request('https://dxb.test', { headers: { origin: 'https://dxb.test' } }),
        'https://dxb.test',
      ),
    ).not.toThrow();
  });
  it('does not retain plain IP addresses', () => {
    expect(privateHash('127.0.0.1', 'secret')).toHaveLength(64);
  });
  it('rejects SSRF endpoints', () => {
    for (const url of [
      'http://localhost/',
      'https://127.0.0.1/',
      'https://web.push.apple.com.evil.test/',
      'https://user:pass@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:9999/x',
    ])
      expect(() => validatePushEndpoint(url)).toThrow();
    for (const url of [
      'https://fcm.googleapis.com/a',
      'https://web.push.apple.com/a',
      'https://updates.push.services.mozilla.com/a',
    ])
      expect(() => validatePushEndpoint(url)).not.toThrow();
  });
});
