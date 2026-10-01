import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:https';
import { createServer } from 'node:http';
import { fixture } from '../fixture';
const exec = promisify(execFile);
const binary = process.env.IPAROOM_TEST_MCP_BIN || resolve('packages/cli/bin/iparoom-mcp.mjs');
const env = () => ({
  ...process.env,
  IPAROOM_LAN_HOST: '',
  IPAROOM_HOSTNAME: '',
  IPAROOM_MAX_UPLOAD_BYTES: '16777216'
});
async function stdio(dir: string, args: string[] = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binary, ...args],
    cwd: dir,
    env: env(),
    stderr: 'pipe'
  });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'iparoom-integration-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}
async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return result.structuredContent as any;
}
async function stopped(url: string) {
  await expect
    .poll(() =>
      fetch(url, { signal: AbortSignal.timeout(250) })
        .then(() => false)
        .catch(() => true)
    )
    .toBe(true);
}
test('standalone stdio MCP shares multiple IPAs, reports errors, revokes and cleans up on EOF', async ({
  request
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-mcp-test-'));
  const bytes = await fixture(),
    path = join(dir, 'App with spaces.ipa');
  await writeFile(path, bytes);
  await writeFile(join(dir, 'invalid.ipa'), 'invalid');
  const before = new Set(await readdir(tmpdir()));
  const { client } = await stdio(dir, ['--hostname', '127.0.0.1']);
  let url = '';
  try {
    const definitions = await client.listTools();
    expect(definitions.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'iparoom_create_install_link',
        'iparoom_list_builds',
        'iparoom_get_install_link',
        'iparoom_revoke_share',
        'iparoom_server_status'
      ])
    );
    const status = await tool(client, 'iparoom_server_status');
    expect(status).toMatchObject({
      listenHost: '0.0.0.0',
      hostname: '127.0.0.1',
      transport: 'stdio',
      deviceInstallation: 'not-verified'
    });
    url = status.serverUrl;
    expect((await request.get(`${url}/api/builds`)).status()).toBe(401);
    const invalid = await client.callTool({
      name: 'iparoom_create_install_link',
      arguments: { path: join(dir, 'invalid.ipa') }
    });
    expect(invalid.isError).toBe(true);
    const uploaded = await tool(client, 'iparoom_create_install_link', { path, notes: 'MCP 测试' });
    expect(uploaded.build.otaUrl).toBeNull();
    expect(uploaded.build.notes).toBe('MCP 测试');
    expect(await (await request.get(uploaded.build.downloadUrl)).body()).toEqual(bytes);
    const second = await tool(client, 'iparoom_create_install_link', { path: dir }).catch(
      () => null
    );
    // A directory with multiple IPAs is rejected; errors leave the same session usable.
    expect(second).toBeNull();
    const again = await tool(client, 'iparoom_create_install_link', { path });
    expect(again.build.id).not.toBe(uploaded.build.id);
    expect((await tool(client, 'iparoom_list_builds')).builds).toHaveLength(2);
    expect(
      (await tool(client, 'iparoom_get_install_link', { id: uploaded.build.id })).build.shareToken
    ).toBe(uploaded.build.shareToken);
    const revoked = await tool(client, 'iparoom_revoke_share', { id: uploaded.build.id });
    expect(revoked.build.installUrl).toBeNull();
    expect((await request.get(uploaded.build.downloadUrl)).status()).toBe(404);
  } finally {
    await client.close();
    if (url) await stopped(url);
    await expect
      .poll(
        async () =>
          (await readdir(tmpdir())).filter((n) => n.startsWith('iparoom-share-') && !before.has(n))
            .length
      )
      .toBe(0);
    expect(await readFile(path)).toEqual(bytes);
    await rm(dir, { recursive: true, force: true });
  }
});
test('MCP HTTPS uses the certificate hostname in all links and manifest assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-mcp-tls-test-'));
  const cert = join(dir, 'cert.pem'),
    key = join(dir, 'key.pem'),
    path = join(dir, 'App.ipa');
  const bytes = await fixture();
  await writeFile(path, bytes);
  await exec('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=ipa.example.test',
    '-addext',
    'subjectAltName=DNS:ipa.example.test',
    '-keyout',
    key,
    '-out',
    cert
  ]);
  const { client } = await stdio(dir, [
    '--hostname',
    'ipa.example.test',
    '--cert',
    cert,
    '--key',
    key
  ]);
  try {
    const result = await tool(client, 'iparoom_create_install_link', { path });
    expect(result).toMatchObject({
      listenHost: '0.0.0.0',
      hostname: 'ipa.example.test',
      https: true
    });
    expect(result.build.installUrl).toMatch(/^https:\/\/ipa\.example\.test:/);
    expect(result.build.otaUrl).toContain('itms-services:');
    const ca = await readFile(cert);
    const download = (url: string) =>
      new Promise<Buffer>((resolveBytes, reject) => {
        get(
          url,
          {
            ca,
            family: 4,
            lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4)
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () =>
              res.statusCode === 200
                ? resolveBytes(Buffer.concat(chunks))
                : reject(new Error(String(res.statusCode)))
            );
          }
        ).on('error', reject);
      });
    expect((await download(result.build.manifestUrl)).toString()).toContain(
      result.build.downloadUrl
    );
    expect(await download(result.build.downloadUrl)).toEqual(bytes);
    await expect(
      exec(
        process.execPath,
        [binary, '--hostname', 'wrong.example.test', '--cert', cert, '--key', key],
        { env: env() }
      )
    ).rejects.toThrow('does not match hostname');
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('MCP did not stop'));
    }, 5000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolveExit() : reject(new Error(`MCP exited ${code}`));
    });
    child.kill('SIGTERM');
  });
}
test('HTTP MCP requires authentication, rejects invalid requests and serves the real MCP client', async ({
  request
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-mcp-http-test-'));
  const path = join(dir, 'App.ipa');
  await writeFile(path, await fixture());
  const token = 'mcp-integration-token-32-characters';
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done()))
  );
  const args = [
    join(dirname(binary), 'iparoom.mjs'),
    'mcp',
    '--transport',
    'http',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
    '--mcp-port',
    '0'
  ];
  const child = spawn(process.execPath, args, {
    cwd: dir,
    env: { ...env(), IPAROOM_MCP_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '',
    logs = '';
  child.stdout!.on('data', (chunk) => (stdout += chunk));
  child.stderr!.on('data', (chunk) => (logs += chunk));
  await expect.poll(() => logs, { timeout: 10000 }).toContain('MCP HTTP ready:');
  const endpoint = logs.match(/MCP HTTP ready: (http:\/\/[^;]+);/)![1];
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  const client = new Client({ name: 'http-integration-test', version: '1.0.0' });
  try {
    expect((await request.post(endpoint, { data: {} })).status()).toBe(401);
    expect(
      (
        await request.post(endpoint, {
          headers: { ...headers, Origin: 'http://evil.invalid' },
          data: {}
        })
      ).status()
    ).toBe(403);
    expect(
      (
        await request.post(endpoint, { headers: { ...headers, Host: 'evil.invalid' }, data: {} })
      ).status()
    ).toBe(403);
    expect(
      (await request.post(endpoint, { headers, data: Buffer.from('invalid JSON') })).status()
    ).toBe(400);
    expect((await request.post(endpoint, { headers, data: Buffer.alloc(65537) })).status()).toBe(
      413
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } }
      })
    );
    const result = await tool(client, 'iparoom_create_install_link', { path });
    expect(result).toMatchObject({
      transport: 'http',
      listenHost: '0.0.0.0',
      mcpUrl: endpoint,
      port
    });
    expect((await request.get(result.build.installUrl)).status()).toBe(200);
    expect((await tool(client, 'iparoom_list_builds')).builds).toHaveLength(1);
    expect(stdout).toBe('');
  } finally {
    await client.close();
    await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
  await expect(
    exec(process.execPath, [binary, '--transport', 'http'], {
      env: { ...env(), IPAROOM_MCP_TOKEN: '' }
    })
  ).rejects.toThrow('IPAROOM_MCP_TOKEN');
});
