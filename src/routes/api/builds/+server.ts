import { error, json } from '@sveltejs/kit';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { settings, serviceOrigin } from '$lib/server/config';
import { inspectIpa } from '$lib/server/ipa';
import { ipaPath, listBuilds, saveBuild } from '$lib/server/store';
import { links } from '$lib/server/manifest';
import type { RequestHandler } from './$types';
let active = 0;
export const GET: RequestHandler = ({ url }) =>
  json({
    builds: listBuilds().map((build) => ({ ...build, ...links(build, serviceOrigin(url.origin)) }))
  });
export const POST: RequestHandler = async ({ request, url }) => {
  if (!request.body) error(400, '请选择 IPA 文件');
  if (active >= 2) error(429, '上传任务繁忙，请稍后重试');
  const config = settings();
  const declared = Number(request.headers.get('content-length'));
  if (declared > config.maxBytes) error(413, 'IPA 超过上传大小限制');
  const notes = request.headers.get('x-iparoom-notes') ?? '';
  let decodedNotes: string;
  try {
    decodedNotes = decodeURIComponent(notes);
  } catch {
    error(400, '更新说明编码无效');
  }
  if (decodedNotes.length > 2000) error(400, '更新说明最多 2000 个字符');
  const origin = serviceOrigin(url.origin);
  const id = randomUUID(),
    target = ipaPath(id),
    temp = `${target}.upload`;
  const hash = createHash('sha256');
  let size = 0;
  active++;
  try {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > config.maxBytes) {
          callback(Object.assign(new Error('IPA 超过上传大小限制'), { status: 413 }));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(request.body as never),
      meter,
      createWriteStream(temp, { flags: 'wx', mode: 0o600 })
    );
    if (size === 0) error(400, 'IPA 文件为空');
    let metadata;
    try {
      metadata = await inspectIpa(temp);
    } catch (cause) {
      error(400, cause instanceof Error ? cause.message : '无效的 IPA');
    }
    const build = {
      ...metadata,
      id,
      size,
      sha256: hash.digest('hex'),
      notes: decodedNotes,
      createdAt: new Date().toISOString(),
      shareToken: randomBytes(24).toString('hex')
    };
    await rename(temp, target);
    saveBuild(build);
    return json({ build: { ...build, ...links(build, origin) } }, { status: 201 });
  } catch (cause) {
    await rm(temp, { force: true });
    await rm(target, { force: true });
    if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 413)
      error(413, 'IPA 超过上传大小限制');
    throw cause;
  } finally {
    active--;
  }
};
