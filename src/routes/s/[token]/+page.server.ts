import { error } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { findShared } from '$lib/server/store';
import { serviceOrigin } from '$lib/server/config';
import { links } from '$lib/server/manifest';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ params, url }) => {
  const build = findShared(params.token);
  if (!build) error(404, '分享链接已撤销或构建不存在');
  const urls = links(build, serviceOrigin(url.origin));
  const { deviceCount: _count, shareToken: _token, ...metadata } = build;
  return {
    build: metadata,
    ...urls,
    qr: await QRCode.toDataURL(urls.installUrl!, {
      width: 224,
      margin: 1,
      color: { dark: '#172a42', light: '#ffffff' }
    })
  };
};
