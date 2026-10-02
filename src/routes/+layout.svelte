<script lang="ts">
  import '$lib/styles/app.scss';
  import logo from '$lib/assets/logo.svg';
  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" type="image/svg+xml" href={logo} />
</svelte:head>

{@render children()}
