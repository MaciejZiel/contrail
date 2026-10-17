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
    gap: 8px;
    padding: 24px;
    text-align: center;
    background: var(--bg);
  }
  h1 {
    margin: 0;
    font-size: var(--fs-xl);
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  p {
    max-width: 52ch;
    margin: 0;
    line-height: 1.5;
  }
  button {
    min-height: 44px;
    padding: 0 18px;
    border-radius: var(--radius);
    border: 0;
    background: var(--surface-2);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s;
  }
  button:first-child {
    background: var(--accent);
    color: var(--accent-ink);
  }
  button:hover {
    background: var(--surface-3);
  }
  button:first-child:hover {
    background: color-mix(in srgb, var(--accent) 88%, white);
  }
  code {
    max-width: 60ch;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }
</style>
