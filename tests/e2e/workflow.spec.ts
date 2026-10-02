import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fixture } from '../fixture';
const token = 'integration-test-token-32-characters';
const headers = { Authorization: `Bearer ${token}` };
const run = promisify(execFile);
test('API auth, IPA validation, manifest, ranged download, rotation and revocation', async ({
  request
}) => {
  expect((await request.get('/api/builds')).status()).toBe(401);
  expect(
    (await request.post('/api/builds', { headers, data: Buffer.from('invalid') })).status()
  ).toBe(400);
  expect(
    (await request.post('/api/builds', { headers, data: Buffer.alloc(1048577) })).status()
  ).toBe(413);
  const ipa = await fixture();
  const uploaded = await request.post('/api/builds', {
    headers: { ...headers, 'X-IPAROOM-Notes': encodeURIComponent('检查 & 测试') },
    data: ipa
  });
  expect(uploaded.status()).toBe(201);
  const { build } = await uploaded.json();
  expect(build.sha256).toBe(createHash('sha256').update(ipa).digest('hex'));
  expect(build.otaUrl).toContain('itms-services:');
  const path = `/s/${build.shareToken}`;
  expect((await request.get(path)).headers()['referrer-policy']).toBe('no-referrer');
  const manifest = await request.get(`${path}/manifest.plist`);
  expect(manifest.status()).toBe(200);
  expect(await manifest.text()).toContain('https://192.168.1.10:8443');
  expect(await manifest.text()).toContain('测试 &amp; Demo');
  const download = await request.get(`${path}/download`);
  expect(await download.body()).toEqual(ipa);
  const range = await request.get(`${path}/download`, { headers: { Range: 'bytes=0-3' } });
  expect(range.status()).toBe(206);
  expect(await range.body()).toEqual(ipa.subarray(0, 4));
  expect(
    (await request.get(`${path}/download`, { headers: { Range: 'bytes=9999999-' } })).status()
  ).toBe(416);
  expect((await request.head(`${path}/download`)).headers()['content-length']).toBe(
    String(ipa.length)
  );
  const rotated = await request.post(`/api/builds/${build.id}/share`, {
    headers,
    data: { enabled: true }
  });
  const newBuild = (await rotated.json()).build;
  expect(newBuild.shareToken).not.toBe(build.shareToken);
  expect((await request.get(`${path}/download`)).status()).toBe(404);
  expect((await request.get(`/s/${newBuild.shareToken}`)).status()).toBe(200);
  await request.post(`/api/builds/${build.id}/share`, { headers, data: { enabled: false } });
  expect((await request.get(`/s/${newBuild.shareToken}/manifest.plist`)).status()).toBe(404);
  expect((await request.delete(`/api/builds/${build.id}`, { headers })).status()).toBe(204);
});

test('native login and logout preserve same-origin form protection without JavaScript', async ({
  browser,
  request
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const response = await page.goto('http://127.0.0.1:4178/');
    expect(response!.headers()['referrer-policy']).toBe('same-origin');
    await page.getByLabel('管理 Token').fill(token);
    await page.getByRole('button', { name: '进入工作台' }).click();
    await expect(page.getByRole('heading', { name: '构建仓库', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '分享你的测试构建' })).toBeVisible();
    expect(
      (
        await request.post('/?/login', {
          headers: { Origin: 'http://untrusted.example' },
          form: { token },
          maxRedirects: 0
        })
      ).status()
    ).toBe(403);
  } finally {
    await context.close();
  }
});
test('CLI login, upload, list, info, revoke and delete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iparoom-cli-test-'));
  const path = join(dir, 'Fixture.ipa');
  await writeFile(path, await fixture());
  const env = {
    ...process.env,
    IPAROOM_CONFIG_DIR: join(dir, 'config'),
    IPAROOM_TOKEN: token,
    IPAROOM_SERVER: 'http://127.0.0.1:4178'
  };
  const cli = (...args: string[]) =>
    run(process.execPath, [resolve('packages/cli/bin/iparoom.mjs'), ...args], { env });
  try {
    await cli('login', '--server', env.IPAROOM_SERVER);
    expect((await stat(join(dir, 'config/config.json'))).mode & 0o777).toBe(0o600);
    const { build } = JSON.parse(
      (await cli('upload', path, '--notes', 'CLI 测试', '--json')).stdout
    );
    expect(
      JSON.parse((await cli('list', '--json')).stdout).builds.some((b: any) => b.id === build.id)
    ).toBe(true);
    expect(JSON.parse((await cli('info', build.id, '--json')).stdout).build.notes).toBe('CLI 测试');
    expect(
      JSON.parse((await cli('share', build.id, '--revoke', '--json')).stdout).build.installUrl
    ).toBeNull();
    await expect(cli('delete', build.id)).rejects.toThrow('requires --yes');
    await cli('delete', build.id, '--yes');
    const archive = join(dir, 'App.xcarchive'),
      exportOptions = join(dir, 'ExportOptions.plist');
    await writeFile(archive, 'archive stub');
    await writeFile(exportOptions, 'options stub');
    await expect(
      cli('export', archive, '--options', exportOptions, '--output', dir)
    ).rejects.toThrow('already contains an IPA');
    await cli('logout');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('browser login, upload, search, share and mobile installation page', async ({
  page,
  request
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '进入你的构建仓库' })).toBeVisible();
  await page.getByLabel('管理 Token').fill(token);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '构建仓库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上传 IPA', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'Fixture.ipa',
    mimeType: 'application/octet-stream',
    buffer: await fixture()
  });
  await page.getByLabel('更新说明').fill('浏览器上传验证');
  await page.getByRole('button', { name: '上传并生成链接' }).click();
  await expect(page.getByRole('heading', { name: '测试 & Demo' })).toBeVisible();
  await page.getByLabel('搜索构建').fill('不存在');
  await expect(page.getByText('没有匹配的构建')).toBeVisible();
  await page.getByLabel('搜索构建').fill('');
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '分享', exact: true }).click();
  await expect(page.getByAltText('安装页二维码')).toBeVisible();
  const installUrl = await page.getByLabel('安装链接', { exact: true }).inputValue();
  const sharePath = new URL(installUrl).pathname;
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'CLI 与集成' }).click();
  await page.getByRole('tab', { name: 'Xcode 导出' }).click();
  await expect(page.getByText('从 Archive 到安装链接')).toBeVisible();
  await page.getByRole('tab', { name: 'Agent / MCP' }).click();
  await expect(page.getByRole('heading', { name: '由 Agent 独立启动 MCP' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sharePath);
  await expect(page.getByRole('link', { name: '安装到 iPhone / iPad' })).toHaveAttribute(
    'href',
    /^itms-services:/
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: 'test-results/mobile-install.png', fullPage: true });
  expect(errors).toEqual([]);
  const builds = (await (await request.get('/api/builds', { headers })).json()).builds;
  for (const build of builds) await request.delete(`/api/builds/${build.id}`, { headers });
});

test('compact layouts support both appearances and keyboard dialog dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '分享你的测试构建' })).toBeVisible();
    await page.getByRole('button', { name: 'CLI 与集成' }).click();
    await page.getByRole('tab', { name: 'Agent / MCP' }).click();
    await expect(page.getByRole('heading', { name: '由 Agent 独立启动 MCP' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.getByRole('button', { name: '构建仓库' }).click();
    await page.getByLabel('管理 Token').fill(token);
    await page.getByRole('button', { name: '进入工作台' }).click();
    const trigger = page.getByRole('button', { name: '上传 IPA', exact: true });
    const bounds = await trigger.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '分享你的测试构建' })).toBeVisible();
  }
});
