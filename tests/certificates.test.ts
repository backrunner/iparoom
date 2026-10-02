import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as plist from 'plist';
import { managedCertificate, tlsOptions } from '../packages/cli/lib/certificates.mjs';
import { certificateProfile, rootCertificate } from '../packages/cli/lib/ca-public.mjs';
import { ponteFromStatus, ponteHostname } from '../packages/cli/lib/ponte.mjs';
const exec = promisify(execFile);
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iparoom-ca-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe('managed certificate authority', () => {
  it('reuses one CA across concurrent sessions, issues valid SAN leaves and exports only its public root', async () => {
    const [a, b] = await Promise.all([
      managedCertificate(['room.sgponte', '192.168.1.10', '127.0.0.1'], { userDataDir: dir }),
      managedCertificate(['other.sgponte', '192.168.1.10'], { userDataDir: dir })
    ]);
    expect(a.rootPem).toEqual(b.rootPem);
    const root = rootCertificate(a.rootPem),
      leaf = new X509Certificate(a.cert);
    expect(root.ca).toBe(true);
    expect(leaf.ca).toBe(false);
    expect(leaf.verify(root.publicKey)).toBe(true);
    expect(leaf.checkHost('room.sgponte')).toBe('room.sgponte');
    expect(leaf.checkIP('192.168.1.10')).toBe('192.168.1.10');
    expect(leaf.keyUsage).toContain('1.3.6.1.5.5.7.3.1');
    expect(Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)).toBeLessThanOrEqual(
      90 * 86400000
    );
    expect((await stat(join(dir, '.iparoom/certificates/root.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(a.keyPath)).mode & 0o777).toBe(0o600);
    const profile = plist.parse(certificateProfile(a.rootPem)) as any;
    expect(profile.PayloadType).toBe('Configuration');
    expect(profile.PayloadContent).toHaveLength(1);
    expect(profile.PayloadContent[0].PayloadType).toBe('com.apple.security.root');
    expect(Buffer.from(profile.PayloadContent[0].PayloadContent)).toEqual(root.raw);
    expect(certificateProfile(a.rootPem)).not.toContain('PRIVATE KEY');
    const reused = await managedCertificate(['room.sgponte', '192.168.1.10', '127.0.0.1'], {
      userDataDir: dir
    });
    expect(reused.cert).toEqual(a.cert);
    // Renewal replaces a leaf near expiry while retaining the trusted root.
    await exec('openssl', [
      'x509',
      '-in',
      a.certPath,
      '-signkey',
      a.keyPath,
      '-days',
      '1',
      '-out',
      a.certPath + '.expired'
    ]);
    await writeFile(a.certPath, await readFile(a.certPath + '.expired'));
    const renewed = await managedCertificate(['room.sgponte', '192.168.1.10', '127.0.0.1'], {
      userDataDir: dir
    });
    expect(renewed.cert).not.toEqual(a.cert);
    expect(renewed.rootPem).toEqual(a.rootPem);
    expect(new X509Certificate(renewed.cert).verify(root.publicKey)).toBe(true);
  }, 20000);
  it('rejects a mismatched root chain and refuses to expose a private key', async () => {
    const a = await managedCertificate(['room.sgponte'], { userDataDir: dir });
    const other = await managedCertificate(['room.sgponte'], { userDataDir: join(dir, 'other') });
    await expect(
      tlsOptions({ cert: a.certPath, key: a.keyPath, ca: other.rootPath }, 'room.sgponte')
    ).rejects.toThrow('Certificate operation failed');
    expect(() => rootCertificate(a.rootPem.toString() + '\n-----BEGIN PRIVATE KEY-----')).toThrow(
      'public certificate'
    );
  });
  it('repairs cached leaves missing a SAN or having a mismatched key without changing the CA', async () => {
    const names = ['127.0.0.1', 'room.sgponte'];
    const complete = await managedCertificate(names, { userDataDir: dir });
    const subset = await managedCertificate(['127.0.0.1'], { userDataDir: dir });
    // A valid leaf/key pair for only one host must not satisfy the multi-host cache.
    await writeFile(complete.certPath, subset.cert);
    await writeFile(complete.keyPath, subset.key);
    const repaired = await managedCertificate(names, { userDataDir: dir });
    expect(new X509Certificate(repaired.cert).checkHost('room.sgponte')).toBe('room.sgponte');
    expect(repaired.rootPem).toEqual(complete.rootPem);
    // An interrupted key/certificate replacement must be recoverable at the next startup.
    await writeFile(repaired.keyPath, subset.key);
    const recovered = await managedCertificate(names, { userDataDir: dir });
    const leaf = new X509Certificate(recovered.cert);
    expect(leaf.checkHost('room.sgponte')).toBe('room.sgponte');
    expect(leaf.verify(new X509Certificate(complete.rootPem).publicKey)).toBe(true);
    expect(recovered.rootPem).toEqual(complete.rootPem);
  });
  it('refuses an invalid root key instead of silently creating a different trusted CA', async () => {
    const userDataDir = join(dir, 'invalid-root');
    const original = await managedCertificate(['room.sgponte'], { userDataDir });
    await managedCertificate(['room.sgponte'], {
      userDataDir: join(dir, 'different-root')
    });
    await writeFile(
      join(userDataDir, '.iparoom/certificates/root.key'),
      await readFile(join(dir, 'different-root/.iparoom/certificates/root.key'))
    );
    await expect(managedCertificate(['room.sgponte'], { userDataDir })).rejects.toThrow(
      'CA private key does not match'
    );
    expect(await readFile(original.rootPath)).toEqual(original.rootPem);
  });
});
describe('Ponte discovery', () => {
  it('requires an explicit Ponte identity and never converts a computer name into a domain', () => {
    expect(ponteFromStatus({ 'device-name': 'Mac Studio' })).toBeNull();
    expect(ponteFromStatus({ 'ponte-device-name': 'My_Mac' })).toBe('my_mac.sgponte');
    expect(ponteFromStatus({ ponte: { enabled: false, hostname: 'mac.sgponte' } })).toBeNull();
    expect(ponteFromStatus({ ponte: { hostname: 'https://mac.sgponte/path' } })).toBeNull();
    expect(() => ponteHostname('other.test')).toThrow('Ponte');
    expect(() => ponteHostname(`${'a'.repeat(64)}.sgponte`)).toThrow();
  });
});
