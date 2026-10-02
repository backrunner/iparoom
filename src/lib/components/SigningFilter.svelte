<script lang="ts">
  import { Select } from 'bits-ui';
  import { Check, ChevronDown, SlidersHorizontal } from '@lucide/svelte';
  import { signingLabels } from '$lib/types';
  let { value = $bindable('all') }: { value?: string } = $props();
  const items = [
    { value: 'all', label: '全部签名' },
    ...Object.entries(signingLabels).map(([value, label]) => ({ value, label }))
  ];
</script>

<Select.Root type="single" bind:value {items} allowDeselect={false}>
  <Select.Trigger class="filter-trigger" aria-label="筛选签名类型">
    <SlidersHorizontal size={16} /><Select.Value /><ChevronDown size={14} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content class="popover select-popover" sideOffset={6} align="end">
      <Select.Viewport>
        {#each items as item (item.value)}
          <Select.Item class="popover-item" value={item.value} label={item.label}>
            {#snippet children({ selected })}
              <span>{item.label}</span>{#if selected}<Check size={16} />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
