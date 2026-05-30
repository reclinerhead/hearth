/**
 * Static illustration used as the dashboard hero placeholder when no
 * user photo is on the row. Replaces the previous AI-generated
 * architectural sketch (see issue #210). The visual contract is the
 * same: this is a stylized illustration, NOT a depiction of the actual
 * house. The accompanying figcaption — "Stylized illustration — not a
 * photo of your home." — carries the load-bearing disclaimer; this
 * component must continue to read as clearly illustrative so that
 * caption stays honest.
 *
 * Composition is a house at dusk with a single warmly-lit window — the
 * hearth metaphor. The amber accent is reserved for that window so the
 * eye is drawn to the warmth inside; everything else uses the warm-dark
 * surfaces and muted outlines from the design tokens. Tree silhouettes
 * and a chimney smoke wisp anchor it as a scene rather than a glyph.
 *
 * Sized via a 4:3 viewBox so the parent's `aspectRatio: "4 / 3"`
 * container fills cleanly without letterboxing.
 */
export function StaticHouseIllustration() {
  return (
    <svg
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Stylized illustration of a home at dusk with a warmly lit window"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="hearth-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-bg-base)" />
          <stop offset="100%" stopColor="var(--color-bg-surface)" />
        </linearGradient>
        <radialGradient id="hearth-glow" cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.45" />
          <stop offset="55%" stopColor="var(--color-accent)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Dusk sky */}
      <rect width="400" height="300" fill="url(#hearth-sky)" />

      {/* A few quiet points of light, very subtle */}
      <circle cx="60" cy="42" r="0.9" fill="var(--color-text-tertiary)" opacity="0.45" />
      <circle cx="108" cy="76" r="0.6" fill="var(--color-text-tertiary)" opacity="0.32" />
      <circle cx="252" cy="54" r="0.7" fill="var(--color-text-tertiary)" opacity="0.38" />
      <circle cx="318" cy="36" r="0.8" fill="var(--color-text-tertiary)" opacity="0.42" />
      <circle cx="356" cy="92" r="0.55" fill="var(--color-text-tertiary)" opacity="0.28" />

      {/* Distant rolling tree mass — left */}
      <path
        d="M 0 222 L 0 196 Q 18 184 36 192 Q 50 175 68 184 Q 82 178 94 188 L 94 222 Z"
        fill="var(--color-bg-base)"
        opacity="0.8"
      />

      {/* Distant rolling tree mass — right */}
      <path
        d="M 318 222 L 318 196 Q 332 188 346 194 Q 362 180 378 192 Q 390 188 400 198 L 400 222 Z"
        fill="var(--color-bg-base)"
        opacity="0.8"
      />

      {/* A single pine, framing the right side */}
      <path
        d="M 360 224 L 368 200 L 364 200 L 372 178 L 368 178 L 376 156 L 384 178 L 380 178 L 388 200 L 384 200 L 392 224 Z"
        fill="var(--color-bg-base)"
        opacity="0.72"
      />

      {/* Horizon — barely there */}
      <line
        x1="0"
        y1="222"
        x2="400"
        y2="222"
        stroke="var(--color-text-tertiary)"
        strokeWidth="0.5"
        opacity="0.28"
      />

      {/* Warm glow halo behind the lit window — the room's light spilling out */}
      <ellipse cx="225" cy="172" rx="78" ry="58" fill="url(#hearth-glow)" />

      {/* Smoke wisp from the chimney, drawn first so it sits under the roof line */}
      <path
        d="M 247 90 C 247 82, 252 78, 248 71 C 245 64, 250 58, 246 49"
        fill="none"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.32"
      />

      {/* House body — walls */}
      <path
        d="M 130 222 L 130 132 L 200 82 L 270 132 L 270 222 Z"
        fill="var(--color-bg-surface)"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeOpacity="0.6"
      />

      {/* Roof eave line, slightly stronger so the gable reads */}
      <path
        d="M 130 132 L 200 82 L 270 132"
        fill="none"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity="0.55"
      />

      {/* Chimney */}
      <rect
        x="240"
        y="92"
        width="14"
        height="28"
        fill="var(--color-bg-surface)"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.25"
        strokeOpacity="0.6"
      />

      {/* Door — bottom-left, recessed/dark */}
      <rect
        x="148"
        y="180"
        width="22"
        height="42"
        fill="var(--color-bg-base)"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1"
        strokeOpacity="0.55"
        rx="1"
      />

      {/* Small unlit window above the door */}
      <rect
        x="149"
        y="150"
        width="20"
        height="20"
        fill="var(--color-bg-base)"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1"
        strokeOpacity="0.55"
        rx="1"
      />
      <line
        x1="159"
        y1="150"
        x2="159"
        y2="170"
        stroke="var(--color-text-tertiary)"
        strokeWidth="0.5"
        opacity="0.45"
      />
      <line
        x1="149"
        y1="160"
        x2="169"
        y2="160"
        stroke="var(--color-text-tertiary)"
        strokeWidth="0.5"
        opacity="0.45"
      />

      {/* The lit window — the only saturated colour in the piece */}
      <rect x="200" y="148" width="52" height="42" fill="var(--color-accent)" rx="1" />
      {/* Mullions, drawn in the base colour so they look like silhouetted frames against the light */}
      <line
        x1="226"
        y1="148"
        x2="226"
        y2="190"
        stroke="var(--color-bg-base)"
        strokeWidth="1.5"
      />
      <line
        x1="200"
        y1="169"
        x2="252"
        y2="169"
        stroke="var(--color-bg-base)"
        strokeWidth="1.5"
      />
      {/* Window frame */}
      <rect
        x="200"
        y="148"
        width="52"
        height="42"
        fill="none"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1"
        strokeOpacity="0.6"
        rx="1"
      />
    </svg>
  );
}
