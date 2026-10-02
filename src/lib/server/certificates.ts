import { runtimeEnvironment } from './config';
import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { rootCertificate } from '../../../packages/cli/lib/ca-public.mjs';
export async function publicRoot() {
  const env = runtimeEnvironment();
  let pem: Buffer;
  if (env.IPAROOM_CA_CERT) pem = await readFile(env.IPAROOM_CA_CERT);
  else if (env.IPAROOM_CA_ROOT_URL) {
    const response = await fetch(env.IPAROOM_CA_ROOT_URL, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) error(503, 'CA 证书尚未就绪');
    const body = await response.arrayBuffer();
    if (body.byteLength > 65536) error(503, 'CA 证书格式无效');
    pem = Buffer.from(body);
  } else error(404, '服务未配置可分发的 CA');
  rootCertificate(pem);
  return pem;
}
