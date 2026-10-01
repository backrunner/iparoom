import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { findShared, ipaPath } from '$lib/server/store';
import { parseRange } from '$lib/server/range';
import type { RequestHandler } from './$types';
const respond: RequestHandler = async ({ params, request }) => {
  const build = findShared(params.token);
  if (!build) error(404, '分享链接已撤销或构建不存在');
  const path = ipaPath(build.id);
  try {
    await stat(path);
  } catch {
    error(404, 'IPA 文件不存在');
  }
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${build.id}.ipa"; filename*=UTF-8''${encodeURIComponent(`${build.name}-${build.version}.ipa`)}`,
    'Accept-Ranges': 'bytes'
  });
  const range = request.headers.get('range');
  const parsed = range ? parseRange(range, build.size) : { start: 0, end: build.size - 1 };
  if (!parsed)
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${build.size}` }
    });
  headers.set('Content-Length', String(parsed.end - parsed.start + 1));
  if (range) headers.set('Content-Range', `bytes ${parsed.start}-${parsed.end}/${build.size}`);
  return new Response(
    request.method === 'HEAD'
      ? null
      : (Readable.toWeb(createReadStream(path, parsed)) as ReadableStream),
    { status: range ? 206 : 200, headers }
  );
};
export const GET = respond;
export const HEAD = respond;
