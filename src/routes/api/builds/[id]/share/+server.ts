import { error, json } from '@sveltejs/kit';
import { changeShare } from '$lib/server/store';
import { links } from '$lib/server/manifest';
import { serviceOrigin } from '$lib/server/config';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ params, request, url }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    error(400, '无效的请求');
  }
  if (!body || typeof body.enabled !== 'boolean') error(400, 'enabled 必须是布尔值');
  const origin = serviceOrigin(url.origin);
  const build = changeShare(params.id, body.enabled);
  if (!build) error(404, '构建不存在');
  return json({ build: { ...build, ...links(build, origin) } });
};
