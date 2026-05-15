import type { HabitatModule } from "./types";
import EpaRadonZone from "./modules/epa-radon-zone";

/**
 * Every habitat module in the system.
 *
 * Order does not matter — the orchestrator (workflows/habitat.ts) runs
 * applicable modules in parallel.
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
  // FemaFloodZone,
  // EpaSuperfundProximity,
] as const;
