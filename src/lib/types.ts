export interface Build {
  id: string;
  name: string;
  bundleId: string;
  version: string;
  buildNumber: string;
  minimumOS: string;
  size: number;
  sha256: string;
  createdAt: string;
  notes: string;
  signing: 'development' | 'ad-hoc' | 'enterprise' | 'app-store' | 'unknown';
  deviceCount: number;
  profileExpiresAt: string | null;
  shareToken: string | null;
}
export function sizeLabel(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export const signingLabels = {
  development: '开发签名',
  'ad-hoc': 'Ad Hoc',
  enterprise: '企业签名',
  'app-store': 'App Store',
  unknown: '未识别签名'
};
