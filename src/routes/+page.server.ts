import { fail, redirect } from '@sveltejs/kit';
import { allowLogin, session, validToken } from '$lib/server/auth';
import { settings, serviceOrigin } from '$lib/server/config';
import { listBuilds } from '$lib/server/store';
import { links } from '$lib/server/manifest';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals, url }) => {
  const origin = serviceOrigin(url.origin);
  return {
    admin: locals.admin,
    configured: settings().token.length >= 24,
    origin,
    maxBytes: settings().maxBytes,
    builds: locals.admin ? listBuilds().map((build) => ({ ...build, ...links(build, origin) })) : []
  };
};
export const actions: Actions = {
  login: async ({ request, cookies, url, getClientAddress }) => {
    if (!allowLogin(getClientAddress()))
      return fail(429, { message: '登录尝试过多，请一分钟后重试' });
    const data = await request.formData();
    if (!validToken(String(data.get('token') ?? '')))
      return fail(401, { message: '管理 Token 无效，请检查服务端配置' });
    cookies.set('iparoom_session', session(), {
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'strict',
      maxAge: 7 * 86400
    });
    redirect(303, '/');
  },
  logout: ({ cookies }) => {
    cookies.delete('iparoom_session', { path: '/' });
    redirect(303, '/');
  }
};
