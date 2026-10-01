import { test, expect } from '@playwright/test';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:https';
import { createServer } from 'node:net';
import { fixture } from '../fixture';
const exec = promisify(execFile);
async function start(args: string[], cwd: string, bind = '127.0.0.1') {
  const child = spawn(
    process.execPath,
    [
      resolve('packages/cli/bin/iparoom.mjs'),
      ...args,
      ...(bind === 'default' ? [] : ['--host', bind]),
      '--json',
      '--no-open'
    ],
    {
      cwd,
      env: {
        ...process.env,
        IPAROOM_LAN_HOST: '',
        IPAROOM_HOSTNAME: '',
        IPAROOM_SERVER: 'http://wrong-server.invalid',
        IPAROOM_TOKEN: 'unrelated-token',
        IPAROOM_BASE_URL: 'https://wrong-server.invalid',
        IPAROOM_DATA_DIR: join(cwd, 'must-not-use')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  let stdout = '',
    stderr = '';
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  const result = await new Promise<any>((resolveResult, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Startup timeout: ${stderr}`));
    }, 15000);
    child.stdout!.on('data', (chunk) => {
      stdout += chunk;
      try {
        const parsed = JSON.parse(stdout);
        clearTimeout(timer);
        resolveResult(parsed);
      } catch {}
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Startup failed (${code}): ${stderr}`));
    });
  });
  return { child, result };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveStop, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI did not stop'));
    }, 5000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolveStop() : reject(new Error(`CLI stopped with ${code}`));
    });
    child.kill('SIGTERM');
  });
}
test('direct IPA invocation starts an isolated page, serves bytes and stops cleanly', async ({
  page,
  request
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-direct-test-'));
  const path = join(dir, 'App with spaces.ipa');
  const bytes = await fixture();
  await writeFile(path, bytes);
  let child: ChildProcess | undefined;
  try {
    const running = await start([path, '--notes', '直接启动测试'], dir);
    child = running.child;
    const result = running.result;
    expect(result.serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(result.build.installUrl).toContain(result.serverUrl);
    expect(result.build.otaUrl).toBeNull();
    expect((await request.get(`${result.serverUrl}/api/builds`)).status()).toBe(401);
    await page.goto(result.build.installUrl);
    await expect(page.getByRole('heading', { name: '测试 & Demo' })).toBeVisible();
    await expect(page.getByText('直接启动测试')).toBeVisible();
    await expect(page.getByRole('link', { name: '安装到 iPhone / iPad' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '下载 IPA 文件' })).toBeVisible();
    expect(await (await request.get(result.build.downloadUrl)).body()).toEqual(bytes);
    const resultPath = join(dir, 'share.json');
    await writeFile(resultPath, JSON.stringify(result));
    const verifier = resolve('skills/iparoom-install/scripts/verify-share.py');
    const verified = JSON.parse(
      (await exec('python3', [verifier, '--input', resultPath, '--full'])).stdout
    );
    expect(verified).toMatchObject({
      ok: true,
      delivery: 'http-download-only',
      sha256MatchesCli: true,
      deviceInstallation: 'not-verified'
    });
    const noOta = await exec('python3', [verifier, '--input', resultPath, '--require-ota']).catch(
      (error: any) => JSON.parse(error.stdout)
    );
    expect(noOta).toMatchObject({
      ok: false,
      otaManifestVerified: false,
      deviceInstallation: 'not-verified'
    });
    const modified = join(dir, 'tampered-share.json');
    await writeFile(
      modified,
      JSON.stringify({ ...result, build: { ...result.build, sha256: '0'.repeat(64) } })
    );
    const mismatch = await exec('python3', [verifier, '--input', modified, '--full']).catch(
      (error: any) => JSON.parse(error.stdout)
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toContain('SHA-256');

    await page.screenshot({ path: 'test-results/direct-cli-page.png', fullPage: true });
    await stop(child);
    child = undefined;
    await expect(request.get(result.build.installUrl, { timeout: 1000 })).rejects.toThrow();
    const invalid = join(dir, 'invalid.ipa');
    await writeFile(invalid, 'not an IPA');
    await expect(
      exec(
        process.execPath,
        [resolve('packages/cli/bin/iparoom.mjs'), invalid, '--host', '127.0.0.1', '--no-open'],
        { cwd: dir }
      )
    ).rejects.toThrow('IPA');
    const second = await start([path], dir);
    child = second.child;
    await stop(child);
    child = undefined;
  } finally {
    if (child) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
});
test('direct HTTPS invocation serves an OTA manifest with the supplied certificate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-tls-test-'));
  let child: ChildProcess | undefined;
  try {
    const path = join(dir, 'Fixture.ipa'),
      cert = join(dir, 'server.crt'),
      key = join(dir, 'server.key');
    await writeFile(path, await fixture());
    await exec('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert
    ]);
    const running = await start([path, '--cert', cert, '--key', key], dir);
    child = running.child;
    const result = running.result;
    expect(result.serverUrl).toMatch(/^https:/);
    expect(result.build.otaUrl).toContain('itms-services:');
    const ca = await readFile(cert);
    const xml = await new Promise<string>((resolveXml, reject) => {
      get(result.build.manifestUrl, { ca }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          res.statusCode === 200
            ? resolveXml(Buffer.concat(chunks).toString())
            : reject(new Error(`Manifest HTTP ${res.statusCode}`))
        );
      }).on('error', reject);
    });
    expect(xml).toContain(result.build.downloadUrl);
    expect(xml).toContain('测试 &amp; Demo');
    const resultPath = join(dir, 'share.json');
    await writeFile(resultPath, JSON.stringify(result));
    const verified = JSON.parse(
      (
        await exec('python3', [
          resolve('skills/iparoom-install/scripts/verify-share.py'),
          '--input',
          resultPath,
          '--ca',
          cert,
          '--full',
          '--require-ota'
        ])
      ).stdout
    );
    expect(verified).toMatchObject({
      ok: true,
      httpsVerifiedFromThisHost: true,
      otaManifestVerified: true,
      sha256MatchesCli: true,
      deviceInstallation: 'not-verified',
      deviceCertificateTrust: 'not-verified',
      codeSignature: 'not-verified'
    });
  } finally {
    if (child) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
});

test('stopping during IPA import drains upload work and removes temporary data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-interrupt-test-'));
  const ipa = join(dir, 'Large.ipa');
  const preload = join(dir, 'slow-read.mjs');
  const marker = join(dir, 'reading');
  await writeFile(ipa, await fixture({ padding: 8 * 1024 * 1024 }));
  await writeFile(
    preload,
    `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.createReadStream;
    fs.createReadStream = (path, options) => {
      const stream = original(path, { ...options, highWaterMark: 1024 });
      stream.once('data', () => fs.writeFileSync(${JSON.stringify(marker)}, 'started'));
      return stream;
    };
    syncBuiltinESMExports();
  `
  );
  const before = new Set(await readdir(tmpdir()));
  const child = spawn(
    process.execPath,
    [
      '--import',
      preload,
      resolve('packages/cli/bin/iparoom.mjs'),
      ipa,
      '--host',
      '127.0.0.1',
      '--json',
      '--no-open'
    ],
    {
      cwd: dir,
      env: { ...process.env, IPAROOM_MAX_UPLOAD_BYTES: '16777216' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  let stdout = '',
    stderr = '';
  child.stdout!.on('data', (chunk) => (stdout += chunk));
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  try {
    await expect
      .poll(async () => readFile(marker, 'utf8').catch(() => ''), { timeout: 10000 })
      .toBe('started');
    const sessions = (await readdir(tmpdir())).filter(
      (name) => name.startsWith('iparoom-share-') && !before.has(name)
    );
    expect(sessions).toHaveLength(1);
    expect(stdout).toBe('');
    await stop(child);
    for (const session of sessions)
      await expect(readFile(join(tmpdir(), session, 'iparoom.sqlite'))).rejects.toThrow();
    expect((await readdir(tmpdir())).filter((name) => sessions.includes(name))).toHaveLength(0);
    expect(stderr).not.toContain('iparoom:');
    expect((await readFile(ipa)).length).toBeGreaterThan(8 * 1024 * 1024);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('persistent startup accepts IPA files larger than the adapter default without BODY_SIZE_LIMIT', async ({
  request
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-persistent-test-'));
  const reservation = createServer();
  await new Promise<void>((resolveListen) => reservation.listen(0, '127.0.0.1', resolveListen));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolveClose) => reservation.close(() => resolveClose()));
  const token = 'persistent-test-token-32-characters';
  const child = spawn(process.execPath, [resolve('scripts/serve.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      IPAROOM_LAN_HOST: '127.0.0.1',
      IPAROOM_BASE_URL: '',
      IPAROOM_PUBLIC_URL: '',
      IPAROOM_ADMIN_TOKEN: token,
      IPAROOM_DATA_DIR: dir,
      IPAROOM_MAX_UPLOAD_BYTES: '1048576',
      BODY_SIZE_LIMIT: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let diagnostics = '';
  child.stdout!.on('data', (chunk) => (diagnostics += chunk));
  child.stderr!.on('data', (chunk) => (diagnostics += chunk));
  const origin = `http://127.0.0.1:${port}`;
  try {
    await expect
      .poll(
        async () =>
          request
            .get(origin, { timeout: 500 })
            .then((r) => r.status())
            .catch(() => 0),
        { timeout: 15000 }
      )
      .toBe(200);
    const ipa = await fixture({ padding: 768 * 1024 });
    expect(ipa.length).toBeGreaterThan(512 * 1024);
    const uploaded = await request.post(`${origin}/api/builds`, {
      headers: { Authorization: `Bearer ${token}` },
      data: ipa
    });
    expect(uploaded.status(), diagnostics + (await uploaded.text())).toBe(201);
    const build = (await uploaded.json()).build;
    expect(build.downloadUrl).toContain(origin);
    expect(await (await request.get(build.downloadUrl)).body()).toEqual(ipa);
    expect(
      (
        await request.post(`${origin}/api/builds`, {
          headers: { Authorization: `Bearer ${token}` },
          data: Buffer.alloc(1048577)
        })
      ).status()
    ).toBe(413);
  } finally {
    if (child.exitCode === null) {
      await new Promise<void>((resolveExit) => {
        child.once('exit', () => resolveExit());
        child.kill('SIGTERM');
      });
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('direct CLI defaults to all interfaces and uses an explicit hostname in links', async ({
  request
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-hostname-test-'));
  let child: ChildProcess | undefined;
  try {
    const path = join(dir, 'App.ipa');
    await writeFile(path, await fixture());
    const running = await start([path, '--hostname', 'ipa.example.test'], dir, 'default');
    child = running.child;
    expect(running.result.listenHost).toBe('0.0.0.0');
    expect(new URL(running.result.build.installUrl).hostname).toBe('ipa.example.test');
    const local = new URL(running.result.build.installUrl);
    local.hostname = '127.0.0.1';
    expect((await request.get(local.toString())).status()).toBe(200);
  } finally {
    if (child) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
});
