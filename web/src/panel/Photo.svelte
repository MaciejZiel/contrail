<script lang="ts">
  import { fetchPhoto, type Photo } from "../core/planespotters";

  let { hex }: { hex: string } = $props();

  type State = { kind: "loading" } | { kind: "none" } | { kind: "ok"; photo: Photo };
  let ps = $state<State>({ kind: "loading" });
  let imgFailed = $state(false);

  $effect(() => {
    const ctl = new AbortController();
    ps = { kind: "loading" };
    imgFailed = false;
    fetchPhoto(hex, ctl.signal).then(
      (photo) => {
        ps = photo ? { kind: "ok", photo } : { kind: "none" };
      },
      () => {
        if (!ctl.signal.aborted) ps = { kind: "none" };
      },
    );
    return () => ctl.abort();
  });
</script>

<figure class="photo" data-state={ps.kind}>
  {#if ps.kind === "ok" && !imgFailed}
    <a href={ps.photo.link} target="_blank" rel="noopener" aria-label="Open this photo on Planespotters.net">
      <img
        src={ps.photo.thumbnail}
        width={ps.photo.width}
        height={ps.photo.height}
        alt={`Photo of aircraft ${hex.toUpperCase()}`}
        onerror={() => (imgFailed = true)}
      />
    </a>
    <figcaption>
      Photo © {ps.photo.photographer} ·
      <a href={ps.photo.link} target="_blank" rel="noopener">Planespotters.net</a>
    </figcaption>
  {:else if ps.kind === "loading"}
    <div class="skeleton" aria-hidden="true"></div>
    <span class="sr-only">Loading photo</span>
  {:else}
    <div class="empty">No photo available</div>
  {/if}
</figure>

<style>
  .photo {
    margin: 0;
    border-radius: 12px;
    overflow: hidden;
    background: var(--surface-2);
    position: relative;
  }
  .photo[data-state="ok"] a:first-child {
    display: block;
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 2;
    object-fit: cover;
  }
  figcaption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 10px 6px;
    font-size: 11px;
    color: #e6ebf5;
    background: linear-gradient(transparent, rgba(5, 9, 20, 0.85));
  }
  figcaption a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .skeleton,
  .empty {
    aspect-ratio: 3 / 1;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 12px;
  }
  .skeleton {
    background: linear-gradient(100deg, var(--surface-2) 30%, #223052 50%, var(--surface-2) 70%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite linear;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>
