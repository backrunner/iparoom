import { error, json } from '@sveltejs/kit';
import { rm } from 'node:fs/promises';
import { findBuild, ipaPath, removeBuild } from '$lib/server/store';
import { serviceOrigin } from '$lib/server/config';
import { links } from '$lib/server/manifest';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ params, url }) => {
  const build = findBuild(params.id);
  if (!build) error(404, '构建不存在');
  return json({ build: { ...build, ...links(build, serviceOrigin(url.origin)) } });
};
export const DELETE: RequestHandler = async ({ params }) => {
  const build = findBuild(params.id);
  if (!build) error(404, '构建不存在');
  removeBuild(build.id);
  await rm(ipaPath(build.id), { force: true });
  return new Response(null, { status: 204 });
};
