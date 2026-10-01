import * as plist from 'plist';
import type { Build } from '$lib/types';
export function manifest(build: Build, origin: string) {
  return plist.build({
    items: [
      {
        assets: [{ kind: 'software-package', url: `${origin}/s/${build.shareToken}/download` }],
        metadata: {
          'bundle-identifier': build.bundleId,
          'bundle-version': build.buildNumber,
          kind: 'software',
          title: build.name
        }
      }
    ]
  });
}
export function links(build: Build, origin: string) {
  if (!build.shareToken)
    return { installUrl: null, downloadUrl: null, manifestUrl: null, otaUrl: null };
  const base = `${origin}/s/${build.shareToken}`;
  return {
    installUrl: base,
    downloadUrl: `${base}/download`,
    manifestUrl: `${base}/manifest.plist`,
    otaUrl: origin.startsWith('https:')
      ? `itms-services://?action=download-manifest&url=${encodeURIComponent(`${base}/manifest.plist`)}`
      : null
  };
}
