"use client";

import dynamic from "next/dynamic";

/**
 * `@mapbox/search-js-react` touches `document` at module load, so it can't be
 * evaluated during SSR — even from a "use client" file, which Next still
 * renders on the server for the initial HTML. We isolate the import behind
 * `next/dynamic({ ssr: false })` so the heavy module only loads in the browser.
 */
export const AddressForm = dynamic(
  () => import("./address-form").then((m) => m.AddressForm),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-4">
        <div>
          <div className="label">Street address</div>
          <div
            className="input"
            aria-hidden
            style={{
              opacity: 0.5,
              display: "flex",
              alignItems: "center",
              color: "var(--color-text-tertiary)",
            }}
          >
            Loading address lookup…
          </div>
        </div>
      </div>
    ),
  },
);
