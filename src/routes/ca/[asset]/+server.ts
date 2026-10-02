import { publicRoot } from '$lib/server/certificates';
import { certificateAsset } from '../../../../packages/cli/lib/ca-public.mjs';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params }) => {
  if (!['root.crt', 'iparoom.mobileconfig', 'info.json'].includes(params.asset))
    error(404, 'Not found');
  const asset = certificateAsset(await publicRoot(), params.asset)!;
  return new Response(asset.body, {
    headers: {
      'Content-Type': asset.type,
      ...(asset.filename
        ? { 'Content-Disposition': `attachment; filename="${asset.filename}"` }
        : {})
    }
  });
};
