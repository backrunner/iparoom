<script lang="ts">
  import { Box, Smartphone, Download, ArrowUpRight, Shield, Copy } from '@lucide/svelte';
  import { sizeLabel, signingLabels } from '$lib/types';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let message = $state('');
  const expired = $derived(
    data.build.profileExpiresAt
      ? new Date(data.build.profileExpiresAt).getTime() < Date.now()
      : false
  );
  const allowed = $derived(
    Boolean(data.otaUrl) &&
      !expired &&
      ['ad-hoc', 'enterprise', 'development'].includes(data.build.signing)
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(data.installUrl!);
      message = '链接已复制';
    } catch {
      message = '请手动复制浏览器地址栏中的链接';
    }
  }
</script>

<svelte:head
  ><title>{data.build.name} · 安装测试构建 · IPA Room</title><meta
    name="robots"
    content="noindex,nofollow"
  /></svelte:head
>
<div class="install-shell">
  <a href="/" class="brand"><span class="brand-icon"><Box size={23} /></span> IPA Room</a>
  <main class="install-card panel">
    <span class="install-kicker">测试构建</span>
    <div class="app-icon large">{data.build.name.slice(0, 1).toUpperCase()}</div>
    <h1>{data.build.name}</h1>
    <p class="subtle">{data.build.bundleId}</p>
    <div class="install-tags">
      <span class="badge">v{data.build.version}</span><span class="badge"
        >Build {data.build.buildNumber}</span
      ><span class="badge">{signingLabels[data.build.signing]}</span>
    </div>
    <div class="install-facts">
      <div><span>安装包大小</span><strong>{sizeLabel(data.build.size)}</strong></div>
      <div><span>系统要求</span><strong>iOS {data.build.minimumOS}+</strong></div>
    </div>
    {#if allowed}<a class="primary full" href={data.otaUrl!}
        ><Smartphone size={19} />安装到 iPhone / iPad</a
      >
      <p class="install-hint">请在同一局域网的 iPhone 或 iPad 上使用 Safari 打开。</p>{:else}<div
        class="install-warning"
      >
        <Shield size={18} />
        <p>
          {expired
            ? '签名描述文件已过期，请联系开发者重新导出。'
            : !data.otaUrl
              ? '此局域网服务尚未配置 HTTPS，暂时无法在线安装；可先下载 IPA。'
              : data.build.signing === 'app-store'
                ? '此构建为 App Store 类型，请通过 TestFlight 或 App Store 分发。'
                : '无法识别此构建的签名类型，请联系开发者确认是否支持安装。'}
        </p>
      </div>{/if}<a
      class="full"
      class:primary={!allowed}
      class:secondary={allowed}
      href={data.downloadUrl!}><Download size={17} />下载 IPA 文件</a
    >{#if data.build.notes}<section class="release-notes">
        <h2>这次更新</h2>
        <p>{data.build.notes}</p>
      </section>{/if}
    <details class="install-help">
      <summary>安装遇到问题？</summary>
      <p>
        请确认设备与服务器在同一局域网，且已安装并完全信任内网 HTTPS 的根证书。Ad Hoc /
        开发签名要求你的设备 UDID 已包含在描述文件中。企业应用可能需要在「设置 → 通用 → VPN
        与设备管理」中信任开发者。描述文件信息仅用于提示，服务不会重新签名或验证签名。
      </p>
      <p>这是测试构建的分发入口。远程连接调试器仍需 Xcode 支持的设备连接方式。</p>
      <a
        href="https://support.apple.com/en-gb/guide/deployment/depce7cefc4d/1/web"
        target="_blank"
        rel="noreferrer">查看 Apple 安装说明 <ArrowUpRight size={14} /></a
      >
    </details>
  </main>
  <aside class="install-qr">
    <img src={data.qr} alt="在测试设备上打开安装页的二维码" width="160" height="160" />
    <div>
      <strong>在手机上打开</strong>
      <p>扫描二维码，打开此构建。</p>
      <button class="text-button" onclick={copy}><Copy size={14} />复制分享链接</button>
    </div>
  </aside>
  {#if message}<p role="status" class="install-hint">{message}</p>{/if}
  <footer><span>IPA Room</span><span>测试构建分发</span></footer>
</div>
