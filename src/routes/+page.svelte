<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { Button, Collapsible, Dialog, DropdownMenu, Label, Progress, Tabs } from 'bits-ui';
  import CodeBlock from '$lib/components/CodeBlock.svelte';
  import SigningFilter from '$lib/components/SigningFilter.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import {
    Box,
    Upload,
    ArrowUpRight,
    Search,
    Link,
    X,
    Copy,
    Trash2,
    LogOut,
    Check,
    LoaderCircle,
    ChevronDown,
    MoreHorizontal,
    Plus
  } from '@lucide/svelte';
  import QRCode from 'qrcode';
  import { sizeLabel, signingLabels, type Build } from '$lib/types';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let query = $state(''),
    filter = $state('all'),
    section = $state('builds');
  let uploadOpen = $state(false),
    shareOpen = $state(false),
    deleteOpen = $state(false);
  let uploadTrigger = $state<HTMLButtonElement | null>(null);
  let deleteReturnFocus = $state<HTMLButtonElement | null>(null);
  let file = $state<File | null>(null),
    notes = $state(''),
    uploading = $state(false),
    progress = $state(0);
  let notice = $state(''),
    failure = $state(''),
    busy = $state(false);
  let selected = $state<(Build & { installUrl: string | null }) | null>(null),
    qr = $state('');
  const builds = $derived(
    data.builds.filter(
      (build) =>
        `${build.name} ${build.bundleId} ${build.version}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === 'all' || build.signing === filter)
    )
  );
  const bytes = $derived(data.builds.reduce((sum, build) => sum + build.size, 0));
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notice = '已复制到剪贴板';
    } catch {
      failure = '无法访问剪贴板，请手动复制链接';
    }
  }
  function choose(event: Event) {
    file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  }
  async function upload() {
    failure = '';
    if (!file) {
      failure = '请先选择 IPA 文件';
      return;
    }
    if (!file.name.toLowerCase().endsWith('.ipa')) {
      failure = '请选择 .ipa 文件';
      return;
    }
    if (file.size > data.maxBytes) {
      failure = `上传上限为 ${sizeLabel(data.maxBytes)}`;
      return;
    }
    uploading = true;
    progress = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/builds');
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-IPAROOM-Notes', encodeURIComponent(notes));
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) progress = Math.round((event.loaded / event.total) * 100);
        };
        xhr.onerror = () => reject(new Error('网络连接失败，请重试'));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            let message = '上传失败';
            try {
              message = JSON.parse(xhr.responseText).message ?? message;
            } catch {}
            reject(new Error(message));
          }
        };
        xhr.send(file);
      });
      await invalidateAll();
      uploadOpen = false;
      file = null;
      notes = '';
      notice = '已上传';
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : '上传失败';
    } finally {
      uploading = false;
    }
  }
  async function share(build: (typeof data.builds)[number]) {
    selected = build;
    qr = '';
    failure = '';
    shareOpen = true;
    if (!build.installUrl) return;
    try {
      const image = await QRCode.toDataURL(build.installUrl, { width: 200, margin: 1 });
      if (shareOpen && selected?.id === build.id && selected.installUrl === build.installUrl)
        qr = image;
    } catch {
      if (shareOpen && selected?.id === build.id) failure = '无法生成二维码，请复制分享链接';
    }
  }
  async function changeShare(enabled: boolean) {
    if (!selected) return;
    const id = selected.id;
    busy = true;
    failure = '';
    try {
      const response = await fetch(`/api/builds/${id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      await invalidateAll();
      notice = enabled ? '新链接已生成，旧链接已失效' : '分享已撤销';
      if (shareOpen && selected?.id === id) {
        selected = body.build;
        qr = '';
        if (enabled) {
          const image = await QRCode.toDataURL(body.build.installUrl, { width: 200, margin: 1 });
          if (shareOpen && selected?.id === id && selected.installUrl === body.build.installUrl)
            qr = image;
        }
      }
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : '操作失败';
    } finally {
      busy = false;
    }
  }
  async function remove() {
    if (!selected) return;
    busy = true;
    failure = '';
    try {
      const response = await fetch(`/api/builds/${selected.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).message);
      await invalidateAll();
      deleteOpen = false;
      notice = '构建已删除';
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : '删除失败';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>IPA Room</title><meta
    name="description"
    content="局域网 IPA 分发与构建管理"
  /></svelte:head
>

<div class="workspace">
  <header class="app-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="IPA Room 首页"><BrandMark />IPA Room</a>
      <nav class="workspace-nav" aria-label="主要导航">
        <Button.Root
          class={section === 'builds' ? 'active' : ''}
          aria-current={section === 'builds' ? 'page' : undefined}
          onclick={() => (section = 'builds')}>构建仓库</Button.Root
        >
        <Button.Root
          class={section === 'cli' ? 'active' : ''}
          aria-current={section === 'cli' ? 'page' : undefined}
          onclick={() => (section = 'cli')}>CLI 与集成</Button.Root
        >
      </nav>
      <div class="header-actions">
        {#if data.certificateInstallUrl}<a class="ca-entry" href={data.certificateInstallUrl}
            >安装 CA</a
          >{/if}
        {#if data.admin}<form method="POST" action="?/logout">
            <Button.Root type="submit" class="icon-button" aria-label="退出登录"
              ><LogOut size={17} /></Button.Root
            >
          </form>{/if}
      </div>
    </div>
  </header>
  <main class="workspace-main">
    {#if !data.admin && section === 'builds'}
      <div class="login-layout">
        <form class="login-panel" method="POST" action="?/login" use:enhance>
          <h1>登录构建仓库</h1>
          <Label.Root for="token">管理 Token</Label.Root>
          <input
            id="token"
            name="token"
            type="password"
            autocomplete="current-password"
            required
            placeholder="输入 Token"
          />
          <Button.Root type="submit" class="primary full" disabled={!data.configured}
            >登录 <ArrowUpRight size={16} /></Button.Root
          >
          {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
          {#if !data.configured}<p class="error">服务尚未配置管理 Token。</p>
            <Collapsible.Root class="help-section"
              ><Collapsible.Trigger class="disclosure"
                >配置方法 <ChevronDown size={15} /></Collapsible.Trigger
              ><Collapsible.Content class="help-content">
                <p>
                  在 ~/.iparoom/config.yaml 中设置至少 24 字符的 server.adminToken，重新启动服务。
                </p>
              </Collapsible.Content></Collapsible.Root
            >
          {/if}
        </form>
      </div>
    {:else if section === 'builds'}
      <div class="page-heading">
        <div>
          <h1>构建仓库</h1>
          <p class="repository-summary">
            {data.builds.length} 个构建，共 {sizeLabel(bytes)}
          </p>
        </div>
        <Button.Root
          class="primary"
          bind:ref={uploadTrigger}
          onclick={() => {
            failure = '';
            uploadOpen = true;
          }}><Plus size={18} />上传 IPA</Button.Root
        >
      </div>
      <div class="repository">
        <div class="list-toolbar">
          <label class="search"
            ><Search size={17} /><input
              aria-label="搜索构建"
              placeholder="搜索构建"
              bind:value={query}
            /></label
          >
          <SigningFilter bind:value={filter} />
        </div>
        {#if builds.length === 0}
          <div class="empty-state">
            <Box size={36} strokeWidth={1.25} />
            <h2>{data.builds.length ? '没有匹配的构建' : '还没有构建'}</h2>
            {#if data.builds.length}<Button.Root
                class="secondary"
                onclick={() => {
                  query = '';
                  filter = 'all';
                }}>清除筛选</Button.Root
              >
            {:else}<Button.Root class="secondary" onclick={() => (uploadOpen = true)}
                ><Plus size={16} />上传 IPA</Button.Root
              >{/if}
          </div>
        {:else}
          <div class="build-columns" aria-hidden="true">
            <span>应用</span><span>版本</span><span>签名</span><span>大小</span><span>上传时间</span
            ><span></span>
          </div>
          <div class="build-list">
            {#each builds as build (build.id)}
              <article class="build-row">
                <div class="build-app">
                  <div class="app-icon" aria-hidden="true">
                    {build.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div class="build-info">
                    <h2>{build.name}</h2>
                    <p>{build.bundleId}</p>
                  </div>
                </div>
                <div class="build-version">
                  <strong>{build.version}</strong><span>Build {build.buildNumber}</span>
                </div>
                <div class="build-signing">
                  <span class="signing-label">{signingLabels[build.signing]}</span>
                </div>
                <span class="build-size">{sizeLabel(build.size)}</span>
                <time class="build-date" datetime={build.createdAt}
                  >{new Date(build.createdAt).toLocaleDateString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit'
                  })}</time
                >
                <div class="row-actions">
                  {#if !build.shareToken}<span class="revoked-status">已撤销</span>{/if}
                  <Button.Root
                    class="secondary share-button"
                    aria-label="分享"
                    onclick={() => share(build)}><Link size={15} /><span>分享</span></Button.Root
                  >
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      class="icon-button"
                      aria-label={`更多操作 ${build.name}`}
                      onfocus={(event) => {
                        deleteReturnFocus = event.currentTarget;
                      }}><MoreHorizontal size={19} /></DropdownMenu.Trigger
                    >
                    <DropdownMenu.Portal
                      ><DropdownMenu.Content
                        class="popover"
                        sideOffset={6}
                        align="end"
                        onCloseAutoFocus={(event) => {
                          if (deleteOpen) event.preventDefault();
                        }}
                      >
                        <DropdownMenu.Item
                          class="popover-item danger"
                          onSelect={() => {
                            selected = build;
                            failure = '';
                            deleteOpen = true;
                          }}><Trash2 size={16} />删除构建</DropdownMenu.Item
                        >
                      </DropdownMenu.Content></DropdownMenu.Portal
                    >
                  </DropdownMenu.Root>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="page-heading">
        <div>
          <h1>CLI 与集成</h1>
        </div>
      </div>
      <div class="integration-panel">
        <Tabs.Root value="local">
          <Tabs.List class="tabs" aria-label="CLI 使用说明"
            ><Tabs.Trigger value="local">直接启动</Tabs.Trigger><Tabs.Trigger value="upload"
              >上传 IPA</Tabs.Trigger
            ><Tabs.Trigger value="xcode">Xcode 导出</Tabs.Trigger><Tabs.Trigger value="mcp"
              >Agent / MCP</Tabs.Trigger
            ><Tabs.Trigger value="ci">CI</Tabs.Trigger></Tabs.List
          >
          <Tabs.Content value="local" class="integration-content"
            ><h2>直接启动</h2>
            <p>传入 IPA，启动临时分发页。</p>
            <CodeBlock code={'iparoom ./MyApp.ipa'} />
            <Collapsible.Root class="help-section"
              ><Collapsible.Trigger class="disclosure"
                >HTTPS 与 hostname <ChevronDown size={15} /></Collapsible.Trigger
              ><Collapsible.Content class="help-content">
                <CodeBlock
                  code={'iparoom ./MyApp.ipa --hostname ipa.lan --port 8443 \\\n  --cert ./server.crt --key ./server.key'}
                />
                <p>
                  默认生成本机 CA 并启用 HTTPS；右上角可安装 CA。hostname 需能被设备解析。按 Ctrl+C
                  停止临时分享。
                </p>
              </Collapsible.Content></Collapsible.Root
            >
          </Tabs.Content>
          <Tabs.Content value="upload" class="integration-content"
            ><h2>上传到常驻服务</h2>
            <CodeBlock
              code={`iparoom login --server ${data.origin}
iparoom upload ./MyApp.ipa --notes "修复登录问题"`}
            />
            <p>登录时输入管理 Token。</p></Tabs.Content
          >
          <Tabs.Content value="xcode" class="integration-content"
            ><h2>Xcode 导出</h2>
            <CodeBlock
              code={'iparoom export ./MyApp.xcarchive \\\n  --options ./ExportOptions.plist \\\n  --output ./exports'}
            />
            <p>导出成功后自动上传到已登录的服务。</p></Tabs.Content
          >
          <Tabs.Content value="mcp" class="integration-content"
            ><h2>独立 MCP</h2>
            <CodeBlock code={'iparoom-mcp'} />
            <p>使用 stdio；工具 iparoom_create_install_link 接收 path 和 notes。</p></Tabs.Content
          >
          <Tabs.Content value="ci" class="integration-content"
            ><h2>CI</h2>
            <CodeBlock
              code={`export IPAROOM_SERVER=${data.origin}
iparoom upload ./exports --json`}
            />
            <p>通过 CI Secret 注入 IPAROOM_TOKEN。</p></Tabs.Content
          >
        </Tabs.Root>
      </div>
    {/if}
  </main>
</div>
{#if notice}<div class="toast" role="status">
    <Check size={16} />{notice}<Button.Root
      class="icon-button"
      onclick={() => (notice = '')}
      aria-label="关闭提示"><X size={15} /></Button.Root
    >
  </div>{/if}
{#if failure && !uploadOpen && !shareOpen && !deleteOpen}<div class="toast error" role="alert">
    {failure}<Button.Root class="icon-button" onclick={() => (failure = '')} aria-label="关闭错误"
      ><X size={15} /></Button.Root
    >
  </div>{/if}

<Dialog.Root bind:open={uploadOpen}>
  <Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
      class="dialog"
      onEscapeKeydown={(event) => {
        if (uploading) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (uploading) event.preventDefault();
      }}
    >
      <div class="dialog-heading">
        <Dialog.Title class="dialog-title">上传 IPA</Dialog.Title><Dialog.Close
          class="icon-button"
          disabled={uploading}
          aria-label="关闭"><X size={19} /></Dialog.Close
        >
      </div>
      <Dialog.Description class="sr-only">上传 Xcode 导出的 IPA 并生成安装链接。</Dialog.Description
      >
      <label class="file-picker"
        ><Upload size={25} /><strong>{file?.name ?? '选择 IPA 文件'}</strong><span
          >{file ? sizeLabel(file.size) : `最大 ${sizeLabel(data.maxBytes)}`}</span
        ><input
          class="sr-only"
          type="file"
          accept=".ipa"
          onchange={choose}
          disabled={uploading}
        /></label
      >
      <Label.Root for="notes">更新说明 <span class="subtle">可选</span></Label.Root><textarea
        id="notes"
        placeholder="更新内容"
        maxlength={2000}
        bind:value={notes}
        disabled={uploading}></textarea>
      {#if uploading}<div class="upload-progress">
          <Progress.Root value={progress} max={100} aria-label="上传进度"
            ><div class="progress-fill" style:width={`${progress}%`}></div></Progress.Root
          ><span>{progress === 100 ? '正在解析…' : `${progress}%`}</span>
        </div>{/if}
      {#if failure}<p class="error" role="alert">{failure}</p>{/if}
      <Button.Root class="primary full" disabled={uploading || !file} onclick={upload}
        >{#if uploading}<LoaderCircle class="spin" size={17} />{/if}{uploading
          ? '上传中…'
          : '上传并生成链接'}</Button.Root
      >
    </Dialog.Content></Dialog.Portal
  >
</Dialog.Root>
<Dialog.Root bind:open={shareOpen}>
  <Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog share-dialog">
      <div class="dialog-heading">
        <Dialog.Title class="dialog-title">{selected?.name}</Dialog.Title><Dialog.Close
          class="icon-button"
          aria-label="关闭"><X size={19} /></Dialog.Close
        >
      </div>
      <Dialog.Description class="dialog-description"
        >{selected?.version} · Build {selected?.buildNumber}</Dialog.Description
      >
      {#if selected?.installUrl}<div class="qr-wrap">
          {#if qr}<img src={qr} alt="安装页二维码" width="200" height="200" />{/if}
        </div>
        <div class="copy-field">
          <input readonly value={selected.installUrl} aria-label="安装链接" /><Button.Root
            class="icon-button"
            aria-label="复制安装链接"
            onclick={() => copy(selected!.installUrl!)}><Copy size={17} /></Button.Root
          >
        </div>
        <a class="primary full" href={selected.installUrl} target="_blank" rel="noreferrer"
          >打开安装页 <ArrowUpRight size={16} /></a
        >
        <Collapsible.Root class="help-section"
          ><Collapsible.Trigger class="disclosure"
            >链接管理 <ChevronDown size={15} /></Collapsible.Trigger
          ><Collapsible.Content class="help-content">
            <p>持有链接即可下载。重新生成或撤销后，旧链接失效。</p>
            <div class="share-options">
              <Button.Root class="secondary" disabled={busy} onclick={() => changeShare(true)}
                >重新生成</Button.Root
              ><Button.Root
                class="secondary danger"
                disabled={busy}
                onclick={() => changeShare(false)}>撤销分享</Button.Root
              >
            </div>
          </Collapsible.Content></Collapsible.Root
        >
      {:else}<div class="empty-small">
          <Link size={28} />
          <p>分享已撤销</p>
        </div>
        <Button.Root class="primary full" disabled={busy} onclick={() => changeShare(true)}
          >生成新分享链接</Button.Root
        >{/if}
      {#if failure}<p class="error" role="alert">{failure}</p>{/if}
    </Dialog.Content></Dialog.Portal
  >
</Dialog.Root>
<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
      class="dialog"
      onEscapeKeydown={(event) => {
        if (busy) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (busy) event.preventDefault();
      }}
      onCloseAutoFocus={(event) => {
        const target = deleteReturnFocus?.isConnected ? deleteReturnFocus : uploadTrigger;
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }}
    >
      <Dialog.Title class="dialog-title">删除 {selected?.name}？</Dialog.Title><Dialog.Description
        class="dialog-description">IPA 和分享链接将被删除。</Dialog.Description
      >
      {#if failure}<p class="error" role="alert">{failure}</p>{/if}
      <div class="dialog-actions">
        <Dialog.Close class="secondary" disabled={busy}>取消</Dialog.Close><Button.Root
          class="destructive"
          disabled={busy}
          onclick={remove}>{busy ? '删除中…' : '删除构建'}</Button.Root
        >
      </div>
    </Dialog.Content></Dialog.Portal
  >
</Dialog.Root>
