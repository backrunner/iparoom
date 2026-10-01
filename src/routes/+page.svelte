<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { Dialog, Tabs } from 'bits-ui';
  import {
    Box,
    Upload,
    ArrowUpRight,
    Search,
    Terminal,
    Link,
    X,
    Copy,
    Trash2,
    Smartphone,
    LogOut,
    Check,
    Package,
    Layers,
    HardDrive,
    Shield,
    LoaderCircle
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
  const apps = $derived(new Set(data.builds.map((build) => build.bundleId)).size);
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
      notice = '构建已上传，安装链接已生成';
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
    if (build.installUrl) qr = await QRCode.toDataURL(build.installUrl, { width: 200, margin: 1 });
  }
  async function changeShare(enabled: boolean) {
    if (!selected) return;
    busy = true;
    failure = '';
    try {
      const response = await fetch(`/api/builds/${selected.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      selected = body.build;
      qr = enabled ? await QRCode.toDataURL(body.build.installUrl, { width: 200, margin: 1 }) : '';
      await invalidateAll();
      notice = enabled ? '新链接已生成，旧链接已失效' : '分享已撤销';
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
  ><title>IPA Room · 让测试构建，即刻抵达</title><meta
    name="description"
    content="上传 Xcode 导出的 IPA，生成安装链接，与测试设备分享每一次构建。"
  /></svelte:head
>
<div class="workspace">
  <aside class="sidebar">
    <a class="brand" href="/"
      ><span class="brand-icon"><Box size={23} /></span> IPA Room
      <span class="version">BETA</span></a
    >
    <div class="workspace-label">开发者工作台</div>
    <nav aria-label="主要导航">
      <button class:active={section === 'builds'} onclick={() => (section = 'builds')}
        ><Layers size={18} />构建仓库 <span class="nav-count">{data.builds.length}</span></button
      ><button class:active={section === 'cli'} onclick={() => (section = 'cli')}
        ><Terminal size={18} />CLI 与集成 <ArrowUpRight size={14} /></button
      >
    </nav>
    <div class="sidebar-bottom">
      <div class="small-icon"><Smartphone size={18} /></div>
      <strong>从构建到设备</strong>
      <p>一个链接，连接你的下一次测试。</p>
      <span class="subtle">SvelteKit · Bits UI</span>
    </div>
  </aside>
  <div class="main-shell">
    <header class="topbar">
      <span
        >工作台 <span class="breadcrumb">/</span>
        {section === 'builds' ? '构建仓库' : 'CLI 与集成'}</span
      >
      <div class="top-actions">
        <span class="status-dot"></span><span>局域网服务</span>{#if data.admin}<form
            method="POST"
            action="?/logout"
          >
            <button class="icon-button" aria-label="退出登录"><LogOut size={17} /></button>
          </form>{/if}
      </div>
    </header>
    <main>
      {#if !data.admin}
        <div class="intro">
          <span class="eyebrow">BUILD. SHARE. INSTALL.</span>
          <h1>让测试构建，<br /><span>即刻抵达。</span></h1>
          <p>把 Xcode 的 IPA 带到这里。<br />上传、分享，在测试设备上开启下一次迭代。</p>
        </div>
        <div class="login-grid">
          <form class="panel login-panel" method="POST" action="?/login" use:enhance>
            <span class="small-icon"><Shield size={21} /></span>
            <h2>进入你的构建仓库</h2>
            <p>使用服务端配置的管理 Token 登录。</p>
            <label for="token">管理 Token</label><input
              id="token"
              name="token"
              type="password"
              autocomplete="current-password"
              required
              placeholder="输入管理 Token"
            /><button class="primary" disabled={!data.configured}
              >进入工作台 <ArrowUpRight size={17} /></button
            >{#if form?.message}<p class="error" role="alert">
                {form.message}
              </p>{/if}{#if !data.configured}<p class="error">
                请先在 .env 中配置至少 24 字符的 IPAROOM_ADMIN_TOKEN，再启动服务。
              </p>{/if}
          </form>
          <div class="workflow">
            <span class="eyebrow">A SHORTER PATH TO TESTING</span>
            <div>
              <span>01</span>
              <section>
                <h3>导出你的 IPA</h3>
                <p>使用 Xcode 导出适合测试分发的签名构建。</p>
              </section>
            </div>
            <div>
              <span>02</span>
              <section>
                <h3>上传，自动就绪</h3>
                <p>解析应用、版本和签名描述文件，生成分享入口。</p>
              </section>
            </div>
            <div>
              <span>03</span>
              <section>
                <h3>扫码开始测试</h3>
                <p>在同一局域网的 iPhone Safari 打开链接，安装到受支持设备。</p>
              </section>
            </div>
          </div>
        </div>
      {:else if section === 'builds'}
        <div class="page-heading">
          <div>
            <span class="eyebrow">YOUR BUILDS, ONE PLACE</span>
            <h1>构建仓库<span class="heading-dot">.</span></h1>
            <p>每一次迭代，都有一个抵达设备的入口。</p>
          </div>
          <button
            class="primary"
            onclick={() => {
              failure = '';
              uploadOpen = true;
            }}><Upload size={18} />上传 IPA</button
          >
        </div>
        <div class="stats">
          <div><span>应用数量</span><strong>{apps}<Package size={20} /></strong></div>
          <div><span>测试构建</span><strong>{data.builds.length}<Layers size={20} /></strong></div>
          <div><span>存储用量</span><strong>{sizeLabel(bytes)}<HardDrive size={20} /></strong></div>
        </div>
        <div class="list-toolbar">
          <h2>全部构建 <span class="count">{builds.length}</span></h2>
          <div class="filters">
            <label class="search"
              ><Search size={17} /><input
                aria-label="搜索构建"
                placeholder="搜索应用、版本或 Bundle ID"
                bind:value={query}
              /></label
            ><select aria-label="筛选签名类型" bind:value={filter}
              ><option value="all">全部签名</option
              >{#each Object.entries(signingLabels) as [key, label]}<option value={key}
                  >{label}</option
                >{/each}</select
            >
          </div>
        </div>
        {#if builds.length === 0}<div class="empty-state">
            <div class="empty-icon"><Box size={36} strokeWidth={1.4} /></div>
            <h3>{data.builds.length ? '没有匹配的构建' : '你的下一个构建，从这里开始'}</h3>
            <p>
              {data.builds.length
                ? '试试其他关键词或签名类型。'
                : '上传 Xcode 导出的 IPA，自动生成安装链接与二维码。'}
            </p>
            {#if !data.builds.length}<button class="primary" onclick={() => (uploadOpen = true)}
                ><Upload size={17} />上传第一个 IPA</button
              ><button class="text-button" onclick={() => (section = 'cli')}
                >也可以通过 CLI 上传 <ArrowUpRight size={14} /></button
              >{/if}
          </div>{:else}<div class="build-list">
            {#each builds as build (build.id)}<article class="build-row">
                <div class="app-icon">{build.name.slice(0, 1).toUpperCase()}</div>
                <div class="build-info">
                  <h3>{build.name}<span class="badge">{signingLabels[build.signing]}</span></h3>
                  <p>{build.bundleId}</p>
                  <div class="build-meta">
                    <span>v{build.version} <span class="subtle">({build.buildNumber})</span></span
                    ><span>{sizeLabel(build.size)}</span><time datetime={build.createdAt}
                      >{new Date(build.createdAt).toLocaleDateString('zh-CN')}</time
                    >
                  </div>
                  {#if build.notes}<p class="notes-preview">{build.notes}</p>{/if}
                </div>
                <div class="row-actions">
                  <span class:muted={!build.shareToken} class="share-status"
                    >{build.shareToken ? '分享中' : '已撤销'}</span
                  ><button class="secondary" onclick={() => share(build)}
                    ><Link size={15} />分享</button
                  ><button
                    class="icon-button danger"
                    aria-label={`删除 ${build.name}`}
                    onclick={() => {
                      selected = build;
                      failure = '';
                      deleteOpen = true;
                    }}><Trash2 size={17} /></button
                  >
                </div>
              </article>{/each}
          </div>{/if}
        <div class="tip">
          <Shield size={16} />
          <p>分享链接的持有者可下载此构建。使用完毕后，可随时撤销分享。</p>
        </div>
      {:else}
        <div class="page-heading">
          <div>
            <span class="eyebrow">MADE FOR YOUR WORKFLOW</span>
            <h1>从终端，直接分享<span class="heading-dot">.</span></h1>
            <p>把测试分发接入 Xcode 和你的构建流水线。</p>
          </div>
          <Terminal size={38} strokeWidth={1.2} />
        </div>
        <div class="panel cli-panel">
          <Tabs.Root value="local"
            ><Tabs.List class="tabs" aria-label="CLI 使用说明"
              ><Tabs.Trigger value="local">直接启动</Tabs.Trigger><Tabs.Trigger value="upload"
                >上传 IPA</Tabs.Trigger
              ><Tabs.Trigger value="xcode">Xcode 导出</Tabs.Trigger><Tabs.Trigger value="ci"
                >CI / 自动化</Tabs.Trigger
              ></Tabs.List
            ><Tabs.Content value="local">
              <h3>一个 IPA，直接开启测试页面</h3>
              <p>安装 CLI 后，在任意目录运行。自动选择内网地址、打开页面，并打印二维码。</p>
              <pre><code
                  >iparoom ./MyApp.ipa
iparoom ./exports --notes "本周测试构建"
# 使用设备信任的内网证书
iparoom ./MyApp.ipa --port 8443 --cert ./server.crt --key ./server.key</code
                ></pre>
              <p>
                无需提前启动服务或登录。按 Ctrl+C 停止临时分享。默认 HTTP 支持下载；iOS
                在线安装需使用受信任的 HTTPS 证书。
              </p>
            </Tabs.Content>
            <Tabs.Content value="upload"
              ><h3>一次登录，每次构建一行命令</h3>
              <p>在仓库中安装 CLI。发布 npm 包后可改用全局 npm 安装。</p>
              <pre><code
                  >pnpm build:cli
cd packages/cli
npm link
iparoom login --server {data.origin}
iparoom upload ./exports/MyApp.ipa --notes "修复登录问题"</code
                ></pre>
              <p>
                登录会交互式读取 Token，也支持 IPAROOM_TOKEN 环境变量。上传后输出安装页、IPA
                下载地址和构建 ID。
              </p></Tabs.Content
            ><Tabs.Content value="xcode"
              ><h3>从 Archive 到安装链接</h3>
              <pre><code
                  >iparoom export ./MyApp.xcarchive \
  --options ./ExportOptions.plist \
  --output ./exports \
  --notes "本周测试构建"</code
                ></pre>
              <p>
                CLI 调用 xcodebuild -exportArchive，成功导出后上传。签名证书与导出选项由 Xcode
                管理。
              </p></Tabs.Content
            ><Tabs.Content value="ci"
              ><h3>为流水线保留机器可读输出</h3>
              <pre><code
                  ># 将 Token 注入 CI 的 Secret 环境变量
export IPAROOM_SERVER={data.origin}
# IPAROOM_TOKEN 由 Secret 管理器提供
iparoom upload ./exports --json
iparoom list --json</code
                ></pre>
              <p>
                目录必须包含唯一的 IPA。失败退出码为 1，JSON 结果可继续传递到后续步骤。
              </p></Tabs.Content
            ></Tabs.Root
          >
        </div>
        <div class="panel requirement">
          <Shield size={22} />
          <div>
            <h3>安装前，确认签名与 HTTPS</h3>
            <p>
              Ad Hoc 和开发签名需要包含测试设备 UDID。App Store 导出包不适用于此安装方式。局域网
              HTTPS 、设备信任的证书与有效签名是安装的前提。
            </p>
            <a
              href="https://support.apple.com/en-gb/guide/deployment/depce7cefc4d/1/web"
              target="_blank"
              rel="noreferrer">Apple 分发说明 <ArrowUpRight size={14} /></a
            >
          </div>
        </div>
      {/if}
      <footer><span>IPA ROOM</span><span>为更轻松的每一次测试构建。</span></footer>
    </main>
  </div>
</div>
{#if notice}<div class="toast" role="status">
    <Check size={18} />{notice}<button
      class="icon-button"
      onclick={() => (notice = '')}
      aria-label="关闭提示"><X size={15} /></button
    >
  </div>{/if}
{#if failure && !uploadOpen && !shareOpen && !deleteOpen}<div class="toast error" role="alert">
    {failure}<button onclick={() => (failure = '')} aria-label="关闭错误"><X size={15} /></button>
  </div>{/if}
<Dialog.Root bind:open={uploadOpen}
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog"
      ><div class="dialog-top">
        <span class="small-icon"><Upload size={20} /></span><Dialog.Close
          class="icon-button"
          disabled={uploading}
          aria-label="关闭"><X size={19} /></Dialog.Close
        >
      </div>
      <Dialog.Title class="dialog-title">上传一个新构建</Dialog.Title><Dialog.Description
        class="dialog-description">选择 Xcode 导出的 IPA，安装链接会自动生成。</Dialog.Description
      ><label class="file-picker"
        ><Upload size={28} /><strong>{file?.name ?? '点击选择 IPA 文件'}</strong><span
          >{file ? sizeLabel(file.size) : `支持 .ipa，最大 ${sizeLabel(data.maxBytes)}`}</span
        ><input type="file" accept=".ipa" onchange={choose} disabled={uploading} /></label
      ><label for="notes">更新说明 <span class="subtle">可选</span></label><textarea
        id="notes"
        placeholder="这一次构建，有哪些值得测试的新变化？"
        maxlength={2000}
        bind:value={notes}
        disabled={uploading}></textarea>{#if uploading}<div class="upload-progress">
          <progress max="100" value={progress}></progress><span
            >{progress === 100 ? '正在解析构建…' : `上传中 ${progress}%`}</span
          >
        </div>{/if}{#if failure}<p class="error" role="alert">{failure}</p>{/if}<button
        class="primary full"
        disabled={uploading || !file}
        onclick={upload}
        >{#if uploading}<LoaderCircle class="spin" size={17} />{:else}<Upload
            size={17}
          />{/if}{uploading ? '上传处理中' : '上传并生成链接'}</button
      ></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
<Dialog.Root bind:open={shareOpen}
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog"
      ><div class="dialog-top">
        <span class="small-icon"><Link size={20} /></span><Dialog.Close
          class="icon-button"
          aria-label="关闭"><X size={19} /></Dialog.Close
        >
      </div>
      <Dialog.Title class="dialog-title">分享 {selected?.name}</Dialog.Title><Dialog.Description
        class="dialog-description">在测试设备上打开链接，或使用相机扫描二维码。</Dialog.Description
      >{#if selected?.installUrl}<div class="qr-wrap">
          {#if qr}<img src={qr} alt="安装页二维码" width="200" height="200" />{/if}<span
            >v{selected.version} · Build {selected.buildNumber}</span
          >
        </div>
        <div class="copy-field">
          <input readonly value={selected.installUrl} aria-label="安装链接" /><button
            class="icon-button"
            aria-label="复制安装链接"
            onclick={() => copy(selected!.installUrl!)}><Copy size={18} /></button
          >
        </div>
        <a class="primary full" href={selected.installUrl} target="_blank" rel="noreferrer"
          >打开安装页 <ArrowUpRight size={17} /></a
        >
        <div class="share-options">
          <button class="text-button" disabled={busy} onclick={() => changeShare(true)}
            >重新生成链接</button
          ><button class="text-button danger" disabled={busy} onclick={() => changeShare(false)}
            >撤销分享</button
          >
        </div>{:else}<div class="empty-small">
          <Shield size={30} />
          <p>当前构建的分享已撤销。</p>
        </div>
        <button class="primary full" disabled={busy} onclick={() => changeShare(true)}
          >生成新分享链接</button
        >{/if}{#if failure}<p class="error" role="alert">{failure}</p>{/if}</Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
<Dialog.Root bind:open={deleteOpen}
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog"
      ><Dialog.Title class="dialog-title">删除这个构建？</Dialog.Title><Dialog.Description
        class="dialog-description"
        >{selected?.name} 的 IPA 文件将被删除，已有安装链接会失效。设备上已经安装的应用不受影响。</Dialog.Description
      >{#if failure}<p class="error" role="alert">{failure}</p>{/if}
      <div class="dialog-actions">
        <Dialog.Close class="secondary" disabled={busy}>取消</Dialog.Close><button
          class="primary destructive"
          disabled={busy}
          onclick={remove}>{busy ? '删除中…' : '删除构建'}</button
        >
      </div></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
