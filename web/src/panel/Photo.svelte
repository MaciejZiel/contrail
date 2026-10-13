<script lang="ts">
  import { fetchPhoto, fetchPhotoByReg, type Photo } from "../core/planespotters";
  import { ART_LABEL, artKind, type ArtKind, type TypePhoto, typePhoto } from "../core/typePhotos";
  import CategoryArt from "./CategoryArt.svelte";

  let {
    hex,
    registration,
    typeCode,
    typeName,
    category,
    ready,
  }: {
    hex: string;
    registration: string;
    typeCode: string;
    typeName: string | null;
    category: string;
    /** True once identity (registration, type) has loaded. */
    ready: boolean;
  } = $props();

  type Shown =
    | { tier: "loading" }
    | { tier: "exact"; photo: Photo }
    | { tier: "type"; photo: TypePhoto; url: string }
    | { tier: "art"; kind: ArtKind };

  let shown = $state<Shown>({ tier: "loading" });
  let imgFailed = $state(false);
  let lastHex = "";

  // Tiers: exact airframe photo (Planespotters, hex then registration) -> representative type photo
  // (Wikimedia Commons, stored with the app) -> our own category illustration.
  $effect(() => {
    const h = hex;
    const isReady = ready;
    const reg = registration;
    const code = typeCode;
    const cat = category;
    const ctl = new AbortController();
    if (h !== lastHex) {
      lastHex = h;
      shown = { tier: "loading" };
    }
    imgFailed = false;
    void (async () => {
      let exact: Photo | null = null;
      try {
        exact = await fetchPhoto(h, ctl.signal);
        if (!exact && isReady && reg) exact = await fetchPhotoByReg(reg, ctl.signal);
      } catch {
        if (ctl.signal.aborted) return;
      }
      if (ctl.signal.aborted) return;
      if (exact) {
        shown = { tier: "exact", photo: exact };
        return;
      }
      if (!isReady) return; // wait for the type before falling back
      const fromType = await typePhoto(code);
      if (ctl.signal.aborted) return;
      shown = fromType
        ? { tier: "type", photo: fromType.photo, url: fromType.url }
        : { tier: "art", kind: artKind(null, cat) };
    })();
    return () => ctl.abort();
  });

  function typeFallback(): void {
    // the stored type photo failed to load: use the illustration
    shown = { tier: "art", kind: artKind(shown.tier === "type" ? shown.photo.class : null, category) };
  }
</script>

<figure class="photo" data-tier={shown.tier}>
  {#if shown.tier === "exact" && !imgFailed}
    <a href={shown.photo.link} target="_blank" rel="noopener" aria-label="Open this photo on Planespotters.net">
      <img src={shown.photo.thumbnail} width={shown.photo.width} height={shown.photo.height} alt={`Photo of ${registration || hex.toUpperCase()}`} onerror={() => (imgFailed = true)} />
    </a>
    <figcaption>
      Photo © {shown.photo.photographer} ·
      <a href={shown.photo.link} target="_blank" rel="noopener">Planespotters.net</a>
    </figcaption>
  {:else if shown.tier === "type"}
    <img src={shown.url} width="640" height="427" alt={`Representative photo of ${typeName ?? typeCode}`} onerror={typeFallback} />
    <span class="chip">Representative photo, not this aircraft</span>
    <figcaption>
      {shown.photo.author} ·
      <a href={shown.photo.license_url || shown.photo.source_url} target="_blank" rel="noopener">{shown.photo.license}</a> ·
      <a href={shown.photo.source_url} target="_blank" rel="noopener">Wikimedia Commons</a>
    </figcaption>
  {:else if shown.tier === "art" || (shown.tier === "exact" && imgFailed)}
    <CategoryArt kind={shown.tier === "art" ? shown.kind : artKind(null, category)} />
    <span class="chip">Illustration · {ART_LABEL[shown.tier === "art" ? shown.kind : artKind(null, category)]}</span>
  {:else}
    <div class="skeleton" aria-hidden="true"></div>
    <span class="sr-only">Loading photo</span>
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
  img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 2;
    object-fit: cover;
  }
  a {
    display: block;
  }
  figcaption {
    padding: 6px 10px 7px;
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-dim);
    background: rgba(5, 9, 20, 0.5);
  }
  figcaption a {
    display: inline;
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .chip {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 11px;
    color: #e6ebf5;
    background: rgba(5, 9, 20, 0.7);
    backdrop-filter: blur(4px);
  }
  .skeleton {
    aspect-ratio: 3 / 2;
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
