import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadUserConfig,
  configurationEnvironment,
  shareOptions,
  updateClientCredentials,
  userDataPaths
} from '../packages/cli/lib/config.mjs';
import { managedCertificate } from '../packages/cli/lib/certificates.mjs';
const dirs: string[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-config-test-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe('userdata configuration', () => {
  it('creates one private YAML file under home or the selected userdata root', async () => {
    const home = await directory();
    expect(userDataPaths({ env: {}, home }).config).toBe(join(home, '.iparoom/config.yaml'));
    const root = await directory();
    const options = { env: { IPAROOM_USER_DATA_DIR: root }, home };
    const first = loadUserConfig(options);
    expect(first.paths.root).toBe(join(root, '.iparoom'));
    expect(first.config.https.enabled).toBe(true);
    expect((await stat(first.paths.root)).mode & 0o777).toBe(0o700);
    expect((await stat(first.paths.config)).mode & 0o777).toBe(0o600);
    expect(loadUserConfig(options).text).toBe(first.text);
    expect(configurationEnvironment(first.config, first.paths).IPAROOM_DATA_DIR).toBe(
      join(root, '.iparoom/data')
    );
  });
  it('reads hand edits, resolves paths under userdata and respects explicit runtime overrides', async () => {
    const root = await directory();
    vi.stubEnv('IPAROOM_USER_DATA_DIR', root);
    const { paths } = loadUserConfig();
    await writeFile(
      paths.config,
      `version: 1\nserver:\n  hostname: room.lan\n  port: 9443\nhttps:\n  certificate: certificates/server.crt\n  privateKey: certificates/server.key\nponte:\n  enabled: false\nshare:\n  port: 9444\n  openBrowser: false\nmcp:\n  transport: http\n  port: 3002\nstorage:\n  dataDir: builds\n`
    );
    const config = loadUserConfig().config;
    const env = configurationEnvironment(config, paths);
    expect(env.IPAROOM_TLS_CERT).toBe(join(paths.root, 'certificates/server.crt'));
    expect(env.IPAROOM_DATA_DIR).toBe(join(paths.root, 'builds'));
    expect(shareOptions()).toMatchObject({
      port: 9444,
      open: false,
      ponte: false,
      hostname: 'room.lan',
      transport: 'http',
      mcpPort: 3002
    });
    vi.stubEnv('IPAROOM_HOSTNAME', 'override.lan');
    expect(shareOptions({ port: 9555 })).toMatchObject({
      port: 9555,
      hostname: 'override.lan',
      open: false
    });
    expect(shareOptions({ http: true })).toMatchObject({
      http: true,
      cert: undefined,
      key: undefined,
      ca: undefined
    });
  });
  it('preserves comments and unrelated fields on login and logout', async () => {
    const root = await directory();
    vi.stubEnv('IPAROOM_USER_DATA_DIR', root);
    const { paths } = loadUserConfig();
    await writeFile(
      paths.config,
      '# My local settings\nversion: 1\nserver:\n  port: 8443 # keep this port\nclient:\n  server: ""\n  token: ""\n'
    );
    await updateClientCredentials('https://room.lan:8443', 'a-test-client-token');
    expect(loadUserConfig().config.client).toEqual({
      server: 'https://room.lan:8443',
      token: 'a-test-client-token'
    });
    await updateClientCredentials();
    const saved = loadUserConfig();
    expect(saved.config.client).toEqual({ server: '', token: '' });
    expect(saved.config.server.port).toBe(8443);
    expect(saved.text).toContain('# My local settings');
    expect(saved.text).toContain('# keep this port');
    expect(saved.text).not.toContain('a-test-client-token');
    expect((await stat(paths.config)).mode & 0o777).toBe(0o600);
  });
  it('migrates legacy credentials, environment settings and CA without rotating the root', async () => {
    const root = await directory();
    const legacy = join(root, '.config/iparoom');
    await mkdir(legacy, { recursive: true });
    await writeFile(
      join(legacy, 'config.json'),
      JSON.stringify({ server: 'https://legacy.lan', token: 'legacy-client-token' })
    );
    const ca = await managedCertificate(['legacy.lan'], { userDataDir: join(root, 'ca-source') });
    // Simulate an interrupted old process: only certificate/key files are migrated.
    await mkdir(join(root, 'ca-source/.iparoom/certificates/.issuance-lock'));
    const envPath = join(root, 'legacy.env');
    await writeFile(
      envPath,
      `IPAROOM_ADMIN_TOKEN=legacy-management-token-32-chars\nPORT=8443\nIPAROOM_PONTE=0\nIPAROOM_DATA_DIR=./old-data\nIPAROOM_CERT_DIR=${join(root, 'ca-source/.iparoom/certificates')}\n`
    );
    const options = {
      env: { IPAROOM_USER_DATA_DIR: root },
      legacyEnvFile: envPath
    };
    const migrated = loadUserConfig(options);
    expect(migrated.config.client).toEqual({
      server: 'https://legacy.lan',
      token: 'legacy-client-token'
    });
    expect(migrated.config.server.port).toBe(8443);
    expect(migrated.config.ponte.enabled).toBe(false);
    expect(await readFile(join(migrated.paths.certificates, 'root.crt'))).toEqual(ca.rootPem);
    expect(await readFile(join(migrated.paths.certificates, 'root.key'))).toEqual(
      await readFile(join(root, 'ca-source/.iparoom/certificates/root.key'))
    );
    await expect(stat(join(migrated.paths.certificates, '.issuance-lock'))).rejects.toThrow();
    const reused = await managedCertificate(['legacy.lan'], { userDataDir: root });
    expect(reused.rootPem).toEqual(ca.rootPem);
    await writeFile(join(legacy, 'config.json'), 'invalid old backup');
    expect(loadUserConfig(options).config).toEqual(migrated.config);
  }, 20000);
  it('rejects malformed, duplicate, unknown and incorrectly typed settings without echoing secrets', async () => {
    const root = await directory();
    const options = { env: { IPAROOM_USER_DATA_DIR: root } };
    const { paths } = loadUserConfig(options);
    for (const text of [
      'server: { adminToken: [a-secret-value] }',
      'server: { adminToken: a-secret-value, adminToken: other-value }',
      'server: { adminToken: "a-secret-value }',
      'server: { prot: 8443 }',
      'server: { port: 65536 }',
      'storage: { dataDir: "" }',
      'share: { openBrowser: "false" }',
      'https: { certificate: cert.pem }',
      'client: { server: "https://user:a-secret-value@room.lan" }',
      'server: &server { port: 3000 }\nshare: *server'
    ]) {
      await writeFile(paths.config, text);
      try {
        loadUserConfig(options);
        throw new Error('Invalid settings were accepted');
      } catch (error) {
        expect((error as Error).message).toContain('Invalid');
        expect((error as Error).message).not.toContain('a-secret-value');
      }
    }
  });
  it('reports invalid legacy JSON shapes without a TypeError or leaking values', async () => {
    const root = await directory();
    const legacy = join(root, '.config/iparoom');
    await mkdir(legacy, { recursive: true });
    for (const value of [null, [], 42, 'a-secret-value']) {
      await writeFile(join(legacy, 'config.json'), JSON.stringify(value));
      expect(() => loadUserConfig({ env: { IPAROOM_USER_DATA_DIR: root } })).toThrow(
        'legacy JSON must be an object'
      );
    }
  });
});
