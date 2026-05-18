import type { HabitatModule } from "./types";
import EpaRadonZone from "./modules/epa-radon-zone";
import EpaSuperfundProximity from "./modules/epa-superfund-proximity";
import FemaFloodZones from "./modules/fema-flood-zones";

/**
 * Every habitat module in the system.
 *
 * Registry order drives the onboarding discovery modal's reveal
 * sequence (`app/(app)/dashboard/onboarding-discovery-modal.tsx`).
 * The current order ramps from fastest to slowest — radon resolves
 * sub-millisecond, FEMA flood zones is one HTTP call (~500 ms), and
 * Superfund pulls a whole state of NPL sites (~3 s). The orchestrator
 * itself runs applicable modules in parallel; order does not affect
 * the persisted findings.
 *
 * Adding a new module:
 *   1. Implement the HabitatModule contract under
 *      lib/habitat/modules/<key>/index.ts (default export).
 *   2. Import it here and add it to the array.
 *
 * Module keys must be unique across the registry and must match the
 * module_key value the module writes to hearth.habitat_findings.
 */
export const HABITAT_MODULES: readonly HabitatModule[] = [
  EpaRadonZone,
  FemaFloodZones,
  EpaSuperfundProximity,
] as const;
