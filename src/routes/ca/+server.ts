import { publicRoot } from '$lib/server/certificates';
import { certificatePage } from '../../../packages/cli/lib/ca-public.mjs';
export const GET = async () =>
  new Response(certificatePage(await publicRoot()), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
