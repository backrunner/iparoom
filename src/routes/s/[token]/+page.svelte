<script lang="ts">
  import { Button, Collapsible } from 'bits-ui';
  import {
    Box,
    Smartphone,
    Download,
    ArrowUpRight,
    Shield,
    Copy,
    ChevronDown
  } from '@lucide/svelte';
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
  const warning = $derived(
    expired
      ? '签名已过期'
      : !data.otaUrl
        ? '在线安装需要 HTTPS'
        : data.build.signing === 'app-store'
          ? '请使用 TestFlight 安装此构建'
          : '无法识别签名，请联系开发者'
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(data.installUrl!);
      message = '链接已复制';
    } catch {
      message = '请复制地址栏中的链接';
    }
  }
</script>

<svelte:head
  ><title>{data.build.name} · IPA Room</title><meta
    name="robots"
    content="noindex,nofollow"
  /></svelte:head
>
<div class="install-shell">
  <header class="install-header">
    <a href="/" class="brand"><span class="brand-icon"><Box size={20} /></span>IPA Room</a
    ><Button.Root class="icon-button" aria-label="复制分享链接" onclick={copy}
      ><Copy size={17} /></Button.Root
    >
  </header>
  <main class="install-card">
    <div class="install-app">
      <div class="app-icon large" data-tone={data.build.name.charCodeAt(0) % 4}>
        {data.build.name.slice(0, 1).toUpperCase()}
      </div>
      <div>
        <h1>{data.build.name}</h1>
        <p>
          版本 {data.build.version}<span class="build-number">Build {data.build.buildNumber}</span>
        </p>
      </div>
    </div>
    <div class="install-facts">
      <span>{sizeLabel(data.build.size)}</span><span>iOS {data.build.minimumOS}+</span><span
        >{signingLabels[data.build.signing]}</span
      >
    </div>
    <div class="install-actions">
      {#if allowed}<a class="primary full" href={data.otaUrl!}
          ><Smartphone size={18} />安装到 iPhone / iPad</a
        ><a class="text-link download-link" href={data.downloadUrl!}
          >下载 IPA <Download size={14} /></a
        >
      {:else}<a class="primary full" href={data.downloadUrl!}><Download size={18} />下载 IPA 文件</a
        >
        <p class="install-warning"><Shield size={15} />{warning}</p>{/if}
    </div>
    {#if data.build.notes}<section class="release-notes">
        <h2>更新说明</h2>
        <p>{data.build.notes}</p>
      </section>{/if}
    <Collapsible.Root class="help-section install-help"
      ><Collapsible.Trigger class="disclosure"
        >安装帮助 <ChevronDown size={15} /></Collapsible.Trigger
      ><Collapsible.Content class="help-content">
        <ul>
          <li>在同一局域网的 iPhone / iPad Safari 中打开。</li>
          <li>HTTPS 证书须匹配访问地址，并被设备完全信任。</li>
          <li>开发签名 / Ad Hoc 须包含设备 UDID；企业签名可能需要在设备设置中信任开发者。</li>
        </ul>
        <dl class="build-details">
          <div>
            <dt>Bundle ID</dt>
            <dd>{data.build.bundleId}</dd>
          </div>
          {#if data.build.profileExpiresAt}<div>
              <dt>签名到期</dt>
              <dd>{new Date(data.build.profileExpiresAt).toLocaleDateString('zh-CN')}</dd>
            </div>{/if}
        </dl>
        <p>签名信息仅供参考，服务不会重新签名或验证代码签名。</p>
        <a
          class="text-link"
          href="https://support.apple.com/en-gb/guide/deployment/depce7cefc4d/1/web"
          target="_blank"
          rel="noreferrer">Apple 安装说明 <ArrowUpRight size={14} /></a
        >
      </Collapsible.Content></Collapsible.Root
    >
  </main>
  <aside class="install-qr">
    <img src={data.qr} alt="在测试设备上打开安装页的二维码" width="160" height="160" /><span
      >在设备上扫码打开</span
    >
  </aside>
  {#if message}<p role="status" class="install-hint">{message}</p>{/if}
</div>
