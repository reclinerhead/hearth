// Pure prompt builder for the generated architectural sketch placeholder.
//
// The image step in workflows/house-image.ts calls buildHouseImagePrompt
// with the row's year_built and description and hands the result to the
// AI Gateway image model. Keeping the builder pure and uncoupled from
// the gateway call makes it trivially testable — the failure modes that
// would silently degrade image quality (a missed style hint, a wrong era
// bucket, a description detail leaking through) are exactly the ones
// Vitest can lock down.
//
// Design rule: the prompt is deliberately generic. We pass only the
// era / style / stories signals — never the full description. Feeding the
// model specific details (brick color, shutters, porch railings) makes it
// over-literalize and produce noticeably worse output.

export type BuildPromptInput = {
  yearBuilt: number | null;
  description: string | null;
};

export type PromptParts = {
  eraDescriptor: string | null;
  styleHint: string | null;
  stories: string | null;
};

// Era buckets are calibrated to housing-stock generations rather than
// strict decades — pre-war / interwar / mid-century / late-century /
// modern. Boundaries are inclusive on the lower end.
export function deriveEraDescriptor(yearBuilt: number | null): string | null {
  if (yearBuilt === null) return null;
  if (yearBuilt < 1920) return "early 20th century";
  if (yearBuilt <= 1945) return "1930s-era";
  if (yearBuilt <= 1965) return "mid-century";
  if (yearBuilt <= 1985) return "1970s-era";
  if (yearBuilt <= 2005) return "late 20th century";
  return "contemporary";
}

// Style words we look for in the description. Order matters only when
// two could match the same span (e.g. "Cape Cod" before "Cape"); the
// first match wins. Multi-word styles must be listed before their
// single-word prefixes.
const STYLE_KEYWORDS: { keyword: RegExp; label: string }[] = [
  { keyword: /\bcape cod\b/i, label: "Cape Cod" },
  { keyword: /\bcraftsman\b/i, label: "Craftsman" },
  { keyword: /\bcolonial\b/i, label: "Colonial" },
  { keyword: /\bvictorian\b/i, label: "Victorian" },
  { keyword: /\bfarmhouse\b/i, label: "Farmhouse" },
  { keyword: /\bbungalow\b/i, label: "Bungalow" },
  { keyword: /\bcottage\b/i, label: "Cottage" },
  { keyword: /\btudor\b/i, label: "Tudor" },
  { keyword: /\branch(?:er)?\b/i, label: "Ranch" },
  { keyword: /\bcontemporary\b/i, label: "Contemporary" },
];

export function deriveStyleHint(description: string | null): string | null {
  if (!description) return null;
  for (const { keyword, label } of STYLE_KEYWORDS) {
    if (keyword.test(description)) return label;
  }
  return null;
}

// Stories: surface whichever variant the description states. We don't
// guess from square footage — a 2,400 sf single-story ranch is just as
// common as a 2,400 sf two-story colonial, and a wrong guess costs more
// than an omitted hint.
const STORIES_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bsingle[-\s]story\b/i, label: "single-story" },
  { pattern: /\bone[-\s]story\b/i, label: "single-story" },
  { pattern: /\b1[-\s]story\b/i, label: "single-story" },
  { pattern: /\btwo[-\s]story\b/i, label: "two-story" },
  { pattern: /\b2[-\s]story\b/i, label: "two-story" },
  { pattern: /\bthree[-\s]story\b/i, label: "three-story" },
  { pattern: /\b3[-\s]story\b/i, label: "three-story" },
];

export function deriveStories(description: string | null): string | null {
  if (!description) return null;
  for (const { pattern, label } of STORIES_PATTERNS) {
    if (pattern.test(description)) return label;
  }
  return null;
}

export function derivePromptParts(input: BuildPromptInput): PromptParts {
  const eraDescriptor = deriveEraDescriptor(input.yearBuilt);
  const styleHint = deriveStyleHint(input.description);
  let stories = deriveStories(input.description);

  // Style-implies-stories fallback. "Ranch" is single-story by
  // definition — split-level variants exist but the prompt asks for a
  // "typical" home of the style, and a description that names the
  // style without an explicit stories phrase ("south Portage brick
  // rancher") should still get the right silhouette. An explicit
  // stories phrase always wins over the implication.
  if (styleHint === "Ranch" && stories === null) {
    stories = "single-story";
  }

  return { eraDescriptor, styleHint, stories };
}

// Assemble the final prompt. Omitted hints don't leave dangling phrases
// or double spaces — every joined fragment is space-normalized at the
// end so the model receives clean input regardless of which signals
// were present.
export function buildHouseImagePrompt(input: BuildPromptInput): string {
  const parts = derivePromptParts(input);

  const subjectFragments = ["typical"];
  if (parts.eraDescriptor) subjectFragments.push(parts.eraDescriptor);
  if (parts.styleHint) subjectFragments.push(parts.styleHint);
  subjectFragments.push("home");

  const subject = subjectFragments.join(" ");
  const storiesClause = parts.stories ? `${parts.stories}, ` : "";

  const raw = `Architectural pencil sketch illustration of a ${subject}, ${storiesClause}simple line work on white background, no people, no cars, front exterior view, hand-drawn style, soft graphite shading, architectural drawing aesthetic.`;

  return raw.replace(/\s+/g, " ").trim();
}
