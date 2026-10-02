<script lang="ts">
  import { page } from '$app/state';
  import { Box } from '@lucide/svelte';
</script>

<svelte:head><title>{page.status} · IPA Room</title></svelte:head>
<main class="error-page">
  <Box size={42} /><span class="eyebrow">{page.status}</span>
  <h1>{page.error?.message ?? '页面暂时不可用'}</h1>
  <p>链接可能已失效，请联系发布者。</p>
  <a class="primary" href="/">返回工作台</a>
</main>
