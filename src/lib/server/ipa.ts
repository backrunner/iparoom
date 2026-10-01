import yauzl from 'yauzl';
import * as plist from 'plist';
import * as bplist from 'bplist-parser';
import type { Build } from '$lib/types';
const limit = 4 * 1024 * 1024;
bplist.setMaxObjectSize(limit);
bplist.setMaxObjectCount(100000);
function decode(buffer: Buffer): Record<string, unknown> {
  if (buffer.subarray(0, 6).toString() === 'bplist')
    return bplist.parseBuffer(buffer)[0] as Record<string, unknown>;
  const xml = buffer.toString('utf8');
  if (/<!ENTITY/i.test(xml)) throw new Error('不支持的 plist 实体');
  return plist.parse(xml) as Record<string, unknown>;
}
function text(value: unknown, fallback = '') {
  return typeof value === 'string'
    ? value.slice(0, 256)
    : typeof value === 'number'
      ? String(value)
      : fallback;
}
export async function inspectIpa(
  path: string
): Promise<
  Pick<
    Build,
    | 'name'
    | 'bundleId'
    | 'version'
    | 'buildNumber'
    | 'minimumOS'
    | 'signing'
    | 'deviceCount'
    | 'profileExpiresAt'
  >
> {
  const entries = await new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) {
        reject(new Error('无法读取 IPA，请上传有效的 ZIP 格式 IPA'));
        return;
      }
      const found = new Map<string, Buffer>();
      let count = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(found);
        }
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        if (++count > 100000) {
          fail(new Error('IPA 文件条目过多'));
          return;
        }
        if (
          !/^Payload\/[^/]+\.app\/(Info\.plist|embedded\.mobileprovision)$/.test(entry.fileName)
        ) {
          zip.readEntry();
          return;
        }
        if (found.has(entry.fileName) || entry.uncompressedSize > limit) {
          fail(new Error('IPA 元信息重复或超过大小限制'));
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            fail(streamErr ?? new Error('读取 IPA 失败'));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          stream.on('error', fail);
          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > limit) {
              stream.destroy();
              fail(new Error('IPA 元信息超过大小限制'));
            } else chunks.push(chunk);
          });
          stream.on('end', () => {
            if (!settled) {
              found.set(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            }
          });
        });
      });
      zip.readEntry();
    });
  });
  const infos = [...entries.keys()].filter((key) => key.endsWith('/Info.plist'));
  if (infos.length !== 1) throw new Error('IPA 必须包含唯一的主应用 Payload/*.app/Info.plist');
  const info = decode(entries.get(infos[0])!);
  const bundleId = text(info.CFBundleIdentifier),
    version = text(info.CFBundleShortVersionString),
    buildNumber = text(info.CFBundleVersion);
  if (!bundleId || !version || !buildNumber || info.CFBundlePackageType !== 'APPL')
    throw new Error('IPA 缺少有效的应用标识、版本或构建号');
  let signing: Build['signing'] = 'unknown',
    deviceCount = 0,
    profileExpiresAt: string | null = null;
  const profile = entries.get(infos[0].replace('Info.plist', 'embedded.mobileprovision'));
  if (profile) {
    try {
      const start = profile.indexOf(Buffer.from('<?xml')),
        end = profile.indexOf(Buffer.from('</plist>'), start);
      if (start < 0 || end < start) throw new Error('Invalid provisioning profile');
      const data = decode(profile.subarray(start, end + 8));
      const entitlements = data.Entitlements as Record<string, unknown> | undefined;
      const devices = Array.isArray(data.ProvisionedDevices) ? data.ProvisionedDevices : [];
      deviceCount = devices.length;
      signing =
        data.ProvisionsAllDevices === true
          ? 'enterprise'
          : devices.length
            ? entitlements?.['get-task-allow'] === true
              ? 'development'
              : 'ad-hoc'
            : 'app-store';
      if (data.ExpirationDate instanceof Date) profileExpiresAt = data.ExpirationDate.toISOString();
    } catch {
      /* Unreadable profile is reported as unknown; never claim signature verification. */
    }
  }
  return {
    name: text(info.CFBundleDisplayName, text(info.CFBundleName, bundleId)),
    bundleId,
    version,
    buildNumber,
    minimumOS: text(info.MinimumOSVersion, '未知'),
    signing,
    deviceCount,
    profileExpiresAt
  };
}
