<script lang="ts">
  import { Button } from 'bits-ui';
  import { Smartphone, Download, Copy } from '@lucide/svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
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
        ? ''
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
    <div class="brand"><BrandMark />IPA Room</div>
    <div class="header-actions">
      {#if data.certificateInstallUrl}<a class="ca-entry" href={data.certificateInstallUrl}
          >安装 CA</a
        >{/if}
      <Button.Root class="icon-button" aria-label="复制分享链接" onclick={copy}
        ><Copy size={17} /></Button.Root
      >
    </div>
  </header>
  <main class="install-card">
    <div class="install-app">
      <div class="app-icon large" aria-hidden="true">
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
        {#if warning}<p class="install-warning">{warning}</p>{/if}{/if}
    </div>
    {#if data.build.notes}<section class="release-notes">
        <h2>更新说明</h2>
        <p>{data.build.notes}</p>
      </section>{/if}
  </main>
  <aside class="install-qr">
    <img src={data.qr} alt="在测试设备上打开安装页的二维码" width="160" height="160" /><span
      >在设备上扫码打开</span
    >
  </aside>
  {#if message}<p role="status" class="install-hint">{message}</p>{/if}
</div>
