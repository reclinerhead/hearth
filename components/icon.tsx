import type { SVGProps } from "react";

/**
 * Tabler-style outline icons. Inline SVG (no runtime dep) — stroke 1.75,
 * round joins, 24x24 viewBox so they pair cleanly with the type scale.
 */

export type IconName =
  | "flame"
  | "plus"
  | "menu"
  | "x"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "search"
  | "filter"
  | "sun"
  | "moon"
  | "home"
  | "layout-dashboard"
  | "device-tv-old"
  | "leaf"
  | "user"
  | "settings"
  | "logout"
  | "sparkles"
  | "message-circle"
  | "fridge"
  | "flame-burner"
  | "wind"
  | "droplet"
  | "bolt"
  | "tool"
  | "calendar"
  | "clock"
  | "map-pin"
  | "ruler"
  | "bed"
  | "bath"
  | "key"
  | "camera"
  | "file-text"
  | "note"
  | "history"
  | "circle-check"
  | "circle-dot"
  | "alert-triangle"
  | "shield"
  | "info"
  | "photo"
  | "upload"
  | "edit"
  | "arrow-right"
  | "refresh-cw"
  | "external-link";

const base: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const paths: Record<IconName, React.ReactNode> = {
  flame: (
    <>
      <path d="M12 12c2-3 0-5-1-6 0 3-2 3.5-3 5.5a5 5 0 1 0 9 1.5c-.5-1-1.5-2-2-2 0 1-1 2-3 1z" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M5.6 5.6l1.4 1.4" />
      <path d="M17 17l1.4 1.4" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="M5.6 18.4 7 17" />
      <path d="M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 13a8 8 0 1 1-10-10 7 7 0 0 0 10 10z" />,
  home: (
    <>
      <path d="m4 11 8-7 8 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  "layout-dashboard": (
    <>
      <rect x="4" y="4" width="7" height="9" rx="1.5" />
      <rect x="13" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="15" width="7" height="5" rx="1.5" />
    </>
  ),
  "device-tv-old": (
    <>
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="M17 9h4v8h-4" />
      <path d="M7 21h6" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" />
      <path d="M5 19 19 5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 4 13.6 8.4 18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
      <path d="M19 16l.7 1.8L21.5 18.5 19.7 19.2 19 21l-.7-1.8L16.5 18.5l1.8-.7z" />
      <path d="M5 4l.5 1.3L6.8 6l-1.3.5L5 8l-.5-1.5L3.2 6l1.3-.7z" />
    </>
  ),
  "message-circle": (
    <>
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />
    </>
  ),
  fridge: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M6 10h12" />
      <path d="M9 6.5v1.5" />
      <path d="M9 13v3" />
    </>
  ),
  "flame-burner": (
    <>
      <circle cx="12" cy="13" r="6" />
      <circle cx="12" cy="13" r="2" />
      <path d="M12 4v3" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8h12a3 3 0 1 0-3-3" />
      <path d="M3 12h16a3 3 0 1 1-3 3" />
      <path d="M3 16h10" />
    </>
  ),
  droplet: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />,
  bolt: <path d="M13 3 4 14h7l-1 7 9-11h-7z" />,
  tool: (
    <>
      <path d="M14 6a4 4 0 0 1 5 5l-1 1-4-4 1-1z" />
      <path d="M14 11 5 20l-2-2 9-9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  ruler: (
    <>
      <path d="m3 17 14-14 4 4L7 21z" />
      <path d="M7 13l2 2" />
      <path d="M10 10l2 2" />
      <path d="M13 7l2 2" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18V8" />
      <path d="M3 12h18v6" />
      <path d="M21 18v-4a2 2 0 0 0-2-2h-7v4" />
      <circle cx="7" cy="11" r="1.5" />
    </>
  ),
  bath: (
    <>
      <path d="M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
      <path d="M5 12V6a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2" />
      <path d="M5 21l1-2" />
      <path d="M19 21l-1-2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="14" r="4" />
      <path d="m11 11 9-9" />
      <path d="m17 5 3 3" />
    </>
  ),
  camera: (
    <>
      <path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  "file-text": (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </>
  ),
  note: (
    <>
      <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M8 9h8" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  "circle-check": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  "circle-dot": (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M12 4 2 20h20z" />
      <path d="M12 10v4" />
      <path d="M12 17h0" />
    </>
  ),
  shield: <path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h0" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m3 17 5-5 5 5 3-3 5 5" />
    </>
  ),
  upload: (
    <>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M12 15V4" />
      <path d="m7 9 5-5 5 5" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="m14 5 4 4" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  "refresh-cw": (
    <>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L21 15" />
      <path d="M21 20v-5h-5" />
    </>
  ),
  "external-link": (
    <>
      <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
      <path d="M14 4h6v6" />
      <path d="m10 14 10-10" />
    </>
  ),
};

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  "aria-label"?: string;
};

export function Icon({
  name,
  size = 20,
  className,
  strokeWidth,
  "aria-label": ariaLabel,
}: IconProps) {
  const decorative = !ariaLabel;
  return (
    <svg
      {...base}
      width={size}
      height={size}
      strokeWidth={strokeWidth ?? base.strokeWidth}
      className={className}
      aria-hidden={decorative}
      aria-label={ariaLabel}
      role={decorative ? undefined : "img"}
      focusable={false}
    >
      {paths[name]}
    </svg>
  );
}
