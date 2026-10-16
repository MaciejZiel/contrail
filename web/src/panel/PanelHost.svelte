<script lang="ts">
  import { onMount, type Snippet } from "svelte";

  let {
    children,
    onClose,
    onHeight,
    label,
  }: { children: Snippet; onClose: () => void; onHeight: (px: number) => void; label: string } = $props();

  // Snap heights as fractions of the available height on phones.
  const PEEK = 196;
  let desktop = $state(false);
  let vh = $state(800);
  // open straight at the half snap point: starting from the peek would animate the sheet up from 196 px
  let height = $state(typeof window === "undefined" ? PEEK : Math.round(window.innerHeight * 0.52));
  let dragging = $state(false);
  let startY = 0;
  let startH = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0; // px per ms, positive = moving up

  const maxH = $derived(Math.max(PEEK + 120, vh - 84));
  const snaps = $derived([PEEK, Math.round(vh * 0.52), maxH]);
  const expanded = $derived(!desktop && height >= maxH - 4);

  onMount(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => {
      desktop = mq.matches;
      vh = window.innerHeight;
    };
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    height = snaps[1] ?? PEEK; // open at the middle snap point
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      onHeight(0);
    };
  });

  $effect(() => {
    onHeight(desktop ? 0 : height);
  });

  function down(e: PointerEvent): void {
    dragging = true;
    startY = lastY = e.clientY;
    startH = height;
    lastT = performance.now();
    velocity = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent): void {
    if (!dragging) return;
    const now = performance.now();
    velocity = (lastY - e.clientY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    height = Math.max(60, Math.min(maxH, startH + (startY - e.clientY)));
  }

  function up(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (height < PEEK - 50 && velocity <= 0.05) {
      onClose();
      return;
    }
    // flick: prefer the next snap in the direction of travel
    const projected = height + velocity * 220;
    height = snaps.reduce((best, s) => (Math.abs(s - projected) < Math.abs(best - projected) ? s : best), snaps[0] ?? PEEK);
  }

  function cycle(): void {
    const i = snaps.findIndex((s) => Math.abs(s - height) < 6);
    height = snaps[(i + 1) % snaps.length] ?? PEEK;
  }

  function key(e: KeyboardEvent): void {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      height = snaps.find((s) => s > height + 6) ?? maxH;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const lower = [...snaps].reverse().find((s) => s < height - 6);
      if (lower === undefined) onClose();
      else height = lower;
    }
  }
</script>

{#if desktop}
  <div class="side" role="region" aria-label={label}>
    {@render children()}
  </div>
{:else}
  <div class="sheet" class:dragging class:expanded style={`height:${height}px`} role="region" aria-label={label}>
    <div
      class="grab"
      role="button"
      tabindex="0"
      aria-label={expanded ? "Collapse panel" : "Expand panel"}
      aria-expanded={expanded}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={key}
      onclick={(e) => {
        if (e.detail === 0) cycle(); // keyboard activation; pointer taps are handled by dragging
      }}
    >
      <span class="bar"></span>
    </div>
    <div class="content">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .side {
    position: absolute;
    z-index: 6;
    left: var(--gutter);
    top: calc(12px + env(safe-area-inset-top));
    bottom: 12px;
    width: 380px;
    display: flex;
  }
  .side > :global(.panel) {
    flex: 1;
    min-width: 0;
  }
  .sheet {
    position: absolute;
    z-index: 7;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--surface);
    border-radius: 8px 8px 0 0;
    box-shadow: 0 -12px 36px rgba(0, 0, 0, 0.5); /* taste-skill-ignore: the phone sheet floats over the map */
    transition: height 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
    overflow: hidden;
  }
  .sheet.dragging {
    transition: none;
  }
  .grab {
    flex: none;
    display: grid;
    place-items: center;
    height: 32px;
    touch-action: none;
    cursor: grab;
  }
  .bar {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }
  .content {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .content > :global(.panel) {
    flex: 1;
    min-width: 0;
    border-radius: 0;
    box-shadow: none; /* taste-skill-ignore: reset */
    background: none;
    overflow-y: hidden;
  }
  .expanded .content > :global(.panel) {
    overflow-y: auto;
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      transition: none;
    }
  }
</style>
