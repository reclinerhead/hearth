"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createCachedSignedUrl,
  type CachedSignedUrlBucket,
} from "./signed-url";

/**
 * Client-side hook that resolves a private-bucket storage path to a
 * signed URL via `createCachedSignedUrl`. Used by surfaces that show
 * images stored in `hearth-documents` (and any other supported bucket)
 * where the round-trip-saving win is sessionStorage caching of the
 * URL string across navigations — see "Signed URL caching" in the
 * Technical Guide for the reasoning.
 *
 * Returns `null` while resolution is in flight or when `path` is null,
 * so consumers can render a placeholder until the URL is ready. On
 * cache-warm reloads the effect resolves synchronously inside the
 * helper's sessionStorage read, which means the swap to the real
 * image happens in the next React frame — visually instant.
 */
export function useCachedSignedUrl(
  bucket: CachedSignedUrlBucket,
  path: string | null,
  stamp: string | null,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const signed = await createCachedSignedUrl(
        supabase,
        bucket,
        path,
        stamp,
      );
      if (!cancelled) setUrl(signed);
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, path, stamp]);

  return url;
}
