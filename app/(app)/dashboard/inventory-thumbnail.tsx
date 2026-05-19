"use client";

import { Icon, type IconName } from "@/components/icon";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";

/**
 * Dashboard inventory tile thumbnail. Resolves the document's
 * thumbnail signed URL on the client so the URL string is cached in
 * `sessionStorage` across navigations (matching the house-image
 * pattern). A stable URL is what lets the browser's HTTP cache hit
 * the `hearth-documents` immutable bytes on reload — without that,
 * a fresh signed URL on every render meant the cache always missed.
 *
 * Renders the type-based fallback icon when the inventory item has
 * no attached document and during the brief moment between mount
 * and the URL resolving on a cache miss.
 */
export function InventoryThumbnail({
  thumbnailPath,
  fallbackIcon,
}: {
  thumbnailPath: string | null;
  fallbackIcon: IconName;
}) {
  // Stamp is null: `hearth-documents` paths embed a `{document_id}`
  // segment that is unique per upload, so the path itself is the
  // version key. No per-row timestamp needs to bust the cache.
  const url = useCachedSignedUrl("hearth-documents", thumbnailPath, null);

  if (!url) {
    return <Icon name={fallbackIcon} size={20} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-full w-full object-cover" />;
}
