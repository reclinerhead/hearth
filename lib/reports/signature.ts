/**
 * Report cache-signature hashing (issue #207). Pure — kept in its own
 * module (no `server-only`) so it and the report templates that depend on
 * it stay unit-testable without dragging the Node-only render/cache code
 * into the test graph.
 */

import { createHash } from "node:crypto";

/**
 * Stable opaque signature over everything that can change a report's
 * output. Callers pass the ordered parts (finding content version, static
 * reference-data version, template version, …); identical inputs always
 * hash to the same value, so an unchanged report serves from cache, and any
 * change to any part invalidates it.
 */
export function computeReportSignature(
  parts: Array<string | number | null | undefined>,
): string {
  const canonical = parts
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join(" ");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
