import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';
import { error } from '@sveltejs/kit';
export function settings() {
  const token = env.IPAROOM_ADMIN_TOKEN ?? '';
  const maxBytes = Number(env.IPAROOM_MAX_UPLOAD_BYTES ?? 1073741824);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) error(503, '上传大小配置无效');
  return { token, maxBytes, dataDir: resolve(env.IPAROOM_DATA_DIR ?? 'data') };
}
export function serviceOrigin(fallback: string) {
  let url: URL;
  try {
    url = new URL(env.IPAROOM_BASE_URL || env.IPAROOM_PUBLIC_URL || fallback);
  } catch {
    error(503, 'IPAROOM_BASE_URL 必须是 HTTP(S) 根域名');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    error(503, 'IPAROOM_BASE_URL 必须是 HTTP(S) 根域名');
  return url.origin;
}
