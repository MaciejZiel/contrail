<script lang="ts">
  import App from "./App.svelte";
  import Crasher from "./ui/Crasher.svelte";

  const crashTest = new URLSearchParams(location.search).has("crashtest");

  function report(error: unknown): void {
    console.error("[contrail] render error:", error);
  }
</script>

<!-- the last safety net: a failure while rendering shows a message and a reload button, never a blank page -->
<svelte:boundary onerror={report}>
  <App />
  {#if crashTest}<Crasher />{/if}
  {#snippet failed(error, reset)}
    <div class="crash" role="alert" data-testid="crash">
      <h1>Something went wrong</h1>
      <p>Contrail hit an unexpected error and could not draw this page. The details are in the browser console (look for "[contrail]").</p>
      <p><button onclick={() => location.reload()}>Reload</button> <button onclick={reset}>Try again</button></p>
      <code>{error instanceof Error ? error.message : String(error)}</code>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .crash {
    position: fixed;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    background: var(--bg);
  }
  button {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    cursor: pointer;
  }
  code {
    font: 12px var(--mono);
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }
</style>
