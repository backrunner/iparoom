<script lang="ts">
  import logo from '$lib/assets/logo.svg';
  let { size = 40 }: { size?: number } = $props();
</script>

<img class="brand-mark" src={logo} alt="" aria-hidden="true" width={size} height={size} />
