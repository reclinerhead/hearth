/**
 * Activity log for habitat module check() runs.
 *
 * A habitat module's check() does several discrete things — looks up data,
 * applies a published threshold, computes severity, decides what to
 * surface — and the user deserves to see that reasoning. This helper lets
 * a module emit a step-by-step record of what it did, which is then
 * persisted on the habitat_findings row alongside the finding itself.
 *
 * The log is module-emitted, not framework-derived. The orchestrator
 * doesn't try to infer steps from observing the module — the module
 * explicitly calls log.step() at meaningful points. This keeps the log
 * honest: it describes what the module thinks it did, not what the
 * framework guessed it might have done.
 *
 * The log is also a frozen-in-time artifact of one specific run, not
 * module documentation. If the module's logic changes later, old findings
 * still have logs describing the old behavior — which is correct, because
 * the log records what happened the last time the user's house was
 * checked.
 *
 * Narration voice: write each `narration` as if a person were doing the
 * lookup personally for the user — "I checked…", "I looked up…", "I found…".
 * Keep jargon, URLs, and raw lookup keys out of `narration` and put them
 * in `detail` where a curious reader can dig in.
 */

/**
 * Categories of step a module may emit. Drives any future per-kind
 * styling in the finding detail UI, and also makes the log easy to
 * skim — a reader can see at a glance whether a step was a data fetch,
 * a rule application, or a final decision.
 */
export type ActivityStepKind =
  | "fetch"
  | "rule"
  | "compute"
  | "decide"
  | "finding"
  | "error";

export type ActivitySource = {
  label: string;
  url: string;
};

export type ActivityStep = {
  /** 1-indexed, sequential within a single log. */
  step: number;
  kind: ActivityStepKind;
  /** User-facing, in first-person voice. No jargon. */
  narration: string;
  /** Technical/implementation detail — URLs, raw values, query shapes. */
  detail?: string;
  /** Short outcome — "Found 3 sites", "Zone 1", "Severity: high". */
  result_summary?: string;
  /** Citation for the rule or dataset this step applied. */
  source?: ActivitySource;
  /** Milliseconds since createActivityLogger() was called. */
  at_ms: number;
};

export type ActivityLog = {
  steps: ActivityStep[];
  /** ISO timestamp at logger creation. */
  started_at: string;
  /** ISO timestamp at finalize(). */
  completed_at: string;
  total_duration_ms: number;
};

export type ActivityLogger = {
  /**
   * Append a step to the log. step number and at_ms are filled in
   * automatically. Throws if called after finalize().
   */
  step(input: Omit<ActivityStep, "step" | "at_ms">): void;
  /**
   * Close the logger and return the serializable log. Subsequent calls
   * to step() throw — this catches bugs where a module accidentally logs
   * past the point its check() returned.
   */
  finalize(): ActivityLog;
};

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createActivityLogger(): ActivityLogger {
  const started_at = new Date().toISOString();
  const start_ms = nowMs();
  const steps: ActivityStep[] = [];
  let closed = false;

  return {
    step(input) {
      if (closed) {
        throw new Error(
          "ActivityLogger: step() called after finalize(). " +
            "A module emitted a step after returning its finding — fix the module's check() flow.",
        );
      }
      steps.push({
        step: steps.length + 1,
        at_ms: Math.round(nowMs() - start_ms),
        ...input,
      });
    },
    finalize() {
      closed = true;
      const completed_ms = nowMs();
      return {
        steps,
        started_at,
        completed_at: new Date().toISOString(),
        total_duration_ms: Math.round(completed_ms - start_ms),
      };
    },
  };
}
