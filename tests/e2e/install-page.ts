import { expect, type Browser } from '@playwright/test';

export async function expectInstallPage(
  browser: Browser,
  build: { name: string; installUrl: string; downloadUrl: string; otaUrl: string | null },
  source: string,
  ignoreHTTPSErrors = false
) {
  expect(new URL(build.installUrl).pathname).toMatch(/^\/s\/[a-f0-9]{48}$/);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    ignoreHTTPSErrors
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(build.installUrl);
    expect(response?.status()).toBe(200);
    expect(response?.request().redirectedFrom()).toBeNull();
    expect(page.url()).toBe(build.installUrl);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(build.name);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText('在线安装需要 HTTPS')).toHaveCount(0);
    await expect(page.getByText('安装帮助')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '登录构建仓库' })).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('a[href="/"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /下载 IPA/ })).toHaveAttribute(
      'href',
      build.downloadUrl
    );
    await expect(page.getByRole('link', { name: '安装到 iPhone / iPad' })).toHaveCount(
      build.otaUrl ? 1 : 0
    );
    expect((await context.cookies()).some((cookie) => cookie.name === 'iparoom_session')).toBe(
      false
    );
    await page.screenshot({ path: `test-results/install-pages/${source}.png`, fullPage: true });
  } finally {
    await context.close();
  }
}
