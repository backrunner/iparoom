import { createHmac, timingSafeEqual } from 'node:crypto';
import { settings } from './config';
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function validToken(token: string) {
  const configured = settings().token;
  return configured.length >= 24 && equal(token, configured);
}
function signature(value: string) {
  return createHmac('sha256', settings().token).update(value).digest('hex');
}
export function session() {
  const expires = String(Date.now() + 7 * 86400000);
  return `${expires}.${signature(expires)}`;
}
export function validSession(value = '') {
  const [expires, sig] = value.split('.');
  return (
    settings().token.length >= 24 &&
    /^\d+$/.test(expires ?? '') &&
    Number(expires) > Date.now() &&
    Number(expires) <= Date.now() + 7 * 86400000 &&
    equal(sig ?? '', signature(expires))
  );
}
const attempts = new Map<string, { count: number; until: number }>();
export function allowLogin(ip: string) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  if (attempts.size >= 10000 && !attempts.has(ip)) return false;
  const value = attempts.get(ip) ?? { count: 0, until: now + 60000 };
  value.count++;
  attempts.set(ip, value);
  return value.count <= 10;
}
