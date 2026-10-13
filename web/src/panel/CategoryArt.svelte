<script lang="ts">
  import { ART_LABEL, type ArtKind } from "../core/typePhotos";

  let { kind }: { kind: ArtKind } = $props();
</script>

<svg viewBox="0 0 420 280" role="img" aria-label={`Illustration: ${ART_LABEL[kind]}`} class="art">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c3f6e" />
      <stop offset="1" stop-color="#5d8fc7" />
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset="1" stop-color="#c9d4e6" />
    </linearGradient>
  </defs>
  <rect width="420" height="280" fill="url(#sky)" />
  <g fill="#ffffff" opacity="0.16">
    <ellipse cx="70" cy="70" rx="46" ry="12" /><ellipse cx="108" cy="62" rx="30" ry="10" />
    <ellipse cx="330" cy="205" rx="60" ry="13" /><ellipse cx="372" cy="196" rx="34" ry="10" />
  </g>

  {#if kind === "airliner"}
    <g transform="translate(0 4)">
      <path d="M92 150L72 96L102 96L142 134Z" fill="#e7edf7" />
      <path d="M78 146L36 134L40 128L96 138Z" fill="#c2cee3" />
      <path d="M42 150C42 136 66 130 112 130L318 130C362 130 392 142 402 152C392 162 362 170 318 170L112 170C66 170 42 164 42 150Z" fill="url(#body)" />
      <path d="M336 138C352 138 372 142 384 149L330 149Z" fill="#33496e" />
      <path d="M170 164L252 214L274 214L226 164Z" fill="#aab9d3" />
      <ellipse cx="236" cy="190" rx="26" ry="9" fill="#94a5c4" />
      <path d="M150 168L206 168" stroke="#5d7bb0" stroke-width="3" opacity="0.8" />
      <path d="M118 142H318" stroke="#47638f" stroke-width="4" stroke-dasharray="3 7" stroke-linecap="round" opacity="0.7" />
    </g>
  {:else if kind === "regional"}
    <g transform="translate(0 6)">
      <path d="M72 148L58 82L84 82L112 130Z" fill="#e7edf7" />
      <path d="M44 86L110 86L110 94L44 94Z" fill="#c2cee3" />
      <path d="M62 152C62 140 84 134 122 134L300 134C338 134 368 144 380 153C368 162 338 168 300 168L122 168C84 168 62 164 62 152Z" fill="url(#body)" />
      <path d="M316 142C330 142 350 146 362 152L310 152Z" fill="#33496e" />
      <ellipse cx="116" cy="140" rx="26" ry="9" fill="#94a5c4" />
      <path d="M180 164L236 206L256 206L220 164Z" fill="#aab9d3" />
      <path d="M116 146H296" stroke="#47638f" stroke-width="4" stroke-dasharray="3 7" stroke-linecap="round" opacity="0.7" />
    </g>
  {:else if kind === "bizjet"}
    <g transform="translate(0 4)">
      <path d="M96 146L82 84L100 84L130 128Z" fill="#e7edf7" />
      <path d="M62 86L126 86L126 93L62 93Z" fill="#c2cee3" />
      <path d="M74 154C74 142 100 136 140 134L290 138C340 140 380 150 394 160C380 168 340 172 290 172L140 172C100 170 74 164 74 154Z" fill="url(#body)" />
      <path d="M330 146C346 148 366 152 378 158L326 158Z" fill="#33496e" />
      <ellipse cx="128" cy="140" rx="24" ry="8" fill="#94a5c4" />
      <path d="M200 168L246 198L262 198L232 168Z" fill="#aab9d3" />
      <path d="M150 150H300" stroke="#47638f" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round" opacity="0.7" />
    </g>
  {:else if kind === "ga"}
    <g transform="translate(0 6)">
      <path d="M92 152L78 118L98 118L124 144Z" fill="#e7edf7" />
      <path d="M60 140L100 140L100 146L60 146Z" fill="#c2cee3" />
      <path d="M92 156C92 142 118 134 150 134L252 134C282 134 300 144 312 154C300 164 280 170 252 170L150 170C118 170 92 168 92 156Z" fill="url(#body)" />
      <path d="M232 138H262L282 152H232Z" fill="#33496e" />
      <path d="M130 124L330 124L330 130L130 130Z" fill="#c9d4e6" />
      <path d="M210 130L236 142M270 130L262 144" stroke="#aab9d3" stroke-width="4" />
      <circle cx="320" cy="152" r="5" fill="#e7edf7" /><rect x="316" y="124" width="4" height="56" fill="#e7edf7" opacity="0.35" />
      <path d="M248 170L242 190M290 166L296 190" stroke="#8294b4" stroke-width="4" /><circle cx="241" cy="194" r="7" fill="#27324a" /><circle cx="297" cy="194" r="7" fill="#27324a" />
    </g>
  {:else if kind === "helicopter"}
    <g transform="translate(0 4)">
      <path d="M40 120L140 144L140 154L40 132Z" fill="#c2cee3" />
      <path d="M28 104L48 104L52 140L36 140Z" fill="#e7edf7" />
      <path d="M130 150C130 120 170 108 220 108C270 108 308 126 308 156C308 176 276 188 220 188C166 188 130 176 130 150Z" fill="url(#body)" />
      <path d="M250 122C272 124 294 136 298 152L250 152Z" fill="#33496e" />
      <rect x="214" y="92" width="12" height="18" fill="#9fb0cc" />
      <rect x="64" y="86" width="296" height="6" rx="3" fill="#dfe7f4" opacity="0.9" />
      <path d="M150 206H300M170 188L166 206M270 188L274 206" stroke="#8294b4" stroke-width="5" stroke-linecap="round" />
    </g>
  {:else if kind === "glider"}
    <g transform="translate(0 10)">
      <path d="M40 140L56 108L66 108L74 132Z" fill="#e7edf7" />
      <path d="M44 112L88 112L88 117L44 117Z" fill="#c2cee3" />
      <path d="M40 142C80 138 150 140 240 142C290 142 330 142 372 150C330 160 290 160 240 160C150 160 80 154 40 142Z" fill="url(#body)" />
      <path d="M318 146C336 146 350 148 362 150L316 152Z" fill="#33496e" />
      <path d="M90 128L400 120L400 128L90 138Z" fill="#dfe7f4" opacity="0.95" />
      <path d="M180 158L200 176L216 176L198 158Z" fill="#aab9d3" />
    </g>
  {:else if kind === "military"}
    <g transform="translate(0 6)">
      <path d="M70 156L56 96L92 96L130 138Z" fill="#cfd8e6" />
      <path d="M50 160C50 146 90 140 150 140L270 140C330 140 380 150 400 160C380 170 330 176 270 176L150 176C90 176 50 172 50 160Z" fill="#b7c3d8" />
      <path d="M330 148C350 148 372 152 388 158L326 158Z" fill="#2c3a58" />
      <path d="M160 170L290 214L304 214L238 170Z" fill="#8fa0bf" />
      <ellipse cx="86" cy="160" rx="22" ry="8" fill="#6c7da0" />
    </g>
  {:else}
    <g transform="translate(210 140) scale(2.6) translate(-32 -32)">
      <path d="M32 4C34 4 35 8 35 14L35 26L58 40L58 45L35 38L35 50L42 56L42 59L32 57L22 59L22 56L29 50L29 38L6 45L6 40L29 26L29 14C29 8 30 4 32 4Z" fill="url(#body)" />
    </g>
  {/if}
</svg>

<style>
  .art {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 2;
  }
</style>
