<script lang="ts">
  import { Button } from 'bits-ui';
  import { Check, Copy } from '@lucide/svelte';
  let { code }: { code: string } = $props();
  let feedback = $state('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      feedback = '已复制';
    } catch {
      feedback = '请手动选择并复制命令';
    }
  }
</script>

<div class="code-block">
  <div class="code-toolbar">
    <span>Terminal</span>
    <Button.Root class="icon-button" aria-label="复制命令" onclick={copy}>
      {#if feedback === '已复制'}<Check size={15} />{:else}<Copy size={15} />{/if}
    </Button.Root>
  </div>
  <pre><code>{code}</code></pre>
  {#if feedback}<span role="status" class="code-feedback">{feedback}</span>{/if}
</div>
