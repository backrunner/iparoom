import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectIpa } from '../src/lib/server/ipa';
import { manifest, links } from '../src/lib/server/manifest';
import { parseRange } from '../src/lib/server/range';
import { fixture } from './fixture';
import type { Build } from '../src/lib/types';
import * as plist from 'plist';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function file(bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-unit-'));
  dirs.push(dir);
  const path = join(dir, 'fixture.ipa');
  await writeFile(path, bytes);
  return path;
}
describe('IPA inspection', () => {
  it('parses Xcode-style binary Info.plist', async () => {
    const binary = Buffer.from(
      'YnBsaXN0MDDWAQIDBAUGBwgJCgsMXxATQ0ZCdW5kbGVEaXNwbGF5TmFtZV8QEkNGQnVuZGxlSWRlbnRpZmllcl8QE0NGQnVuZGxlUGFja2FnZVR5cGVfEBpDRkJ1bmRsZVNob3J0VmVyc2lvblN0cmluZ18QD0NGQnVuZGxlVmVyc2lvbl8QEE1pbmltdW1PU1ZlcnNpb25aQmluYXJ5IElQQV8QEmRldi5pcGFyb29tLmJpbmFyeVRBUFBMUzIuMFMxMDFUMTcuMAgVK0BWc4WYo7i9wcUAAAAAAAABAQAAAAAAAAANAAAAAAAAAAAAAAAAAAAAyg==',
      'base64'
    );
    expect(await inspectIpa(await file(await fixture({ binary })))).toMatchObject({
      name: 'Binary IPA',
      bundleId: 'dev.iparoom.binary',
      version: '2.0',
      buildNumber: '101'
    });
  });
  it('reads app metadata and ad-hoc provisioning hints', async () => {
    const result = await inspectIpa(await file(await fixture()));
    expect(result).toMatchObject({
      name: '测试 & Demo',
      bundleId: 'dev.iparoom.fixture',
      version: '1.2.0',
      buildNumber: '42',
      signing: 'ad-hoc',
      deviceCount: 1,
      profileExpiresAt: '2030-01-01T00:00:00.000Z'
    });
  });
  it('marks missing profiles unknown', async () =>
    expect(await inspectIpa(await file(await fixture({ profile: false })))).toMatchObject({
      signing: 'unknown',
      deviceCount: 0
    }));
  it('rejects invalid ZIP and ambiguous main applications', async () => {
    await expect(inspectIpa(await file(Buffer.from('not zip')))).rejects.toThrow('IPA');
    await expect(inspectIpa(await file(await fixture({ extraApp: true })))).rejects.toThrow('唯一');
    await expect(inspectIpa(await file(await fixture({ malformed: true })))).rejects.toThrow();
  });
});
describe('installation manifest', () => {
  const build = {
    name: 'Demo & <App>',
    bundleId: 'dev.example',
    buildNumber: '42',
    version: '1.2',
    shareToken: 'a'.repeat(48)
  } as Build;
  it('escapes XML and uses CFBundleVersion', () => {
    const xml = manifest(build, 'https://192.168.1.10:8443');
    const parsed = plist.parse(xml) as any;
    expect(parsed.items[0].metadata['bundle-version']).toBe('42');
    expect(parsed.items[0].metadata.title).toBe(build.name);
    expect(parsed.items[0].assets[0].url).toBe(
      `https://192.168.1.10:8443/s/${build.shareToken}/download`
    );
  });
  it('only produces OTA links for HTTPS and suppresses revoked URLs', () => {
    expect(links(build, 'http://localhost:5173').otaUrl).toBeNull();
    expect(links(build, 'https://192.168.1.10:8443').otaUrl).toContain('itms-services://');
    expect(
      links({ ...build, shareToken: null }, 'https://192.168.1.10:8443').installUrl
    ).toBeNull();
  });
});
describe('HTTP ranges', () => {
  it('supports closed, open and suffix ranges', () => {
    expect(parseRange('bytes=1-4', 10)).toEqual({ start: 1, end: 4 });
    expect(parseRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=0-100', 10)).toEqual({ start: 0, end: 9 });
  });
  it('rejects unsatisfiable, malformed and multipart ranges', () => {
    for (const range of ['bytes=10-', 'bytes=-0', 'bytes=5-2', 'bytes=-', 'bytes=0-1,3-4', 'nope'])
      expect(parseRange(range, 10)).toBeNull();
  });
});
