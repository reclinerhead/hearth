// Pure hero-photo selection for inventory items (issue #282).
//
// The "hero" is the photo that represents an item across every surface —
// the detail-page hero slot, the inventory list tile, the dashboard
// inventory / Lately tiles. The rule lives here, in one tested place,
// instead of being re-implemented (a query `order by` + a client-side
// splice) on each surface:
//
//   1. If the user has explicitly pinned a hero (inventory.hero_document_id,
//      issue #105) and that photo is present, it wins — always. A user's
//      pick is never overridden by a later upload.
//   2. Otherwise the most-recently-UPLOADED photo wins (created_at desc),
//      so a freshly added photo immediately becomes the hero. This is the
//      fix #282 makes: the prior rule keyed on analyzed_at first, which
//      left a just-added, not-yet-analyzed photo sorting last and never
//      surfacing as the hero.
//
// Callers filter to hero-eligible kinds (nameplate / photo) before this —
// receipts, manuals, and other documents never reach here. `hero_document_id`
// keeps its sole meaning of "the user's explicit pick" (null = derive),
// so no migration or new column is involved.

export type HeroPhoto = {
  id: string;
  /** ISO timestamp the photo was attached/uploaded (documents.created_at). */
  created_at: string;
};

/**
 * Order photos hero-first: the pinned hero (when present in the list)
 * leads, otherwise the most-recently-uploaded photo leads; the remainder
 * follow newest-first. Pure — returns a new array, never mutates input.
 */
export function orderPhotosHeroFirst<T extends HeroPhoto>(
  photos: T[],
  heroDocumentId: string | null,
): T[] {
  const ordered = [...photos].sort(compareNewestFirst);
  if (heroDocumentId) {
    const idx = ordered.findIndex((p) => p.id === heroDocumentId);
    if (idx > 0) {
      const [pinned] = ordered.splice(idx, 1);
      ordered.unshift(pinned);
    }
  }
  return ordered;
}

/**
 * The single hero photo for an item, or null when it has none. Same
 * pinned-wins-else-newest rule as orderPhotosHeroFirst — implemented in
 * terms of it so the two can never disagree.
 */
export function selectHeroPhoto<T extends HeroPhoto>(
  photos: T[],
  heroDocumentId: string | null,
): T | null {
  return orderPhotosHeroFirst(photos, heroDocumentId)[0] ?? null;
}

// Newest-first by upload time. Unparseable or tied timestamps fall back
// to a stable id comparison so the hero never flip/flops between renders.
function compareNewestFirst(a: HeroPhoto, b: HeroPhoto): number {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return bt - at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
