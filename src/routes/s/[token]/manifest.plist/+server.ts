import { error } from '@sveltejs/kit';
import { findShared } from '$lib/server/store';
import { serviceOrigin } from '$lib/server/config';
import { manifest } from '$lib/server/manifest';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ params, url }) => {
  const build = findShared(params.token);
  if (!build) error(404, '分享链接已撤销或构建不存在');
  const origin = serviceOrigin(url.origin);
  if (!origin.startsWith('https:'))
    error(409, 'iOS OTA 安装需要设备可访问且受信任的局域网 HTTPS，请配置 IPAROOM_BASE_URL');
  return new Response(manifest(build, origin), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
};
