import { json, type Handle } from '@sveltejs/kit';
import { validSession, validToken } from '$lib/server/auth';
import { settings } from '$lib/server/config';
export const handle: Handle = async ({ event, resolve }) => {
  const bearer = event.request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  event.locals.admin = validToken(bearer) || validSession(event.cookies.get('iparoom_session'));
  if (event.url.pathname.startsWith('/api/builds')) {
    if (settings().token.length < 24)
      return json({ message: '请先配置至少 24 字符的 IPAROOM_ADMIN_TOKEN' }, { status: 503 });
    if (!event.locals.admin)
      return json({ message: '请登录或提供有效的 API Token' }, { status: 401 });
    if (
      !validToken(bearer) &&
      !['GET', 'HEAD'].includes(event.request.method) &&
      event.request.headers.get('origin') !== event.url.origin
    )
      return json({ message: '请求来源无效' }, { status: 403 });
  }
  const response = await resolve(event);
  // Rejected uploads may leave unread bytes; do not reuse their HTTP/1.1 connection.
  if (response.status === 413) response.headers.set('Connection', 'close');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Native POST navigation needs a same-origin referrer policy to preserve its Origin header.
  // Keep token-bearing share URLs private when navigating away from their pages.
  response.headers.set(
    'Referrer-Policy',
    event.url.pathname === '/' ? 'same-origin' : 'no-referrer'
  );
  if (!event.url.pathname.startsWith('/_app/')) response.headers.set('Cache-Control', 'no-store');
  return response;
};
