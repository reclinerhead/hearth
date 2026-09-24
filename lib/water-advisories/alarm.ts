/**
 * The watcher-blind alarm decision (issue #351). Pure.
 *
 * An alarm means "this source has been broken for hours", not "one run
 * failed". Two rails keep a flapping source (Portage's origin drops
 * Vercel's connections in hour-long windows) from turning the inbox
 * into noise:
 *   - threshold: consecutive failures before the first alarm (default 6
 *     runs ≈ 3 hours at the 30-minute cadence);
 *   - cooldown: after an alarm, no new alarm for that source until
 *     `cooldownHours` have passed — even if it recovered and failed again
 *     in between. `failure_alerted_at` is the anchor and is deliberately
 *     NOT cleared on recovery.
 */

export const DEFAULT_FAILURE_ALERT_AFTER = 6;
export const DEFAULT_ALARM_COOLDOWN_HOURS = 24;

export type AlarmInput = {
  /** Failures in a row including the current run. */
  consecutiveFailures: number;
  threshold: number;
  /** When this source last alarmed, or null if never. */
  failureAlertedAt: string | null;
  nowIso: string;
  cooldownHours: number;
};

export function shouldSendAlarm(input: AlarmInput): boolean {
  if (input.consecutiveFailures < input.threshold) return false;
  if (!input.failureAlertedAt) return true;
  const last = Date.parse(input.failureAlertedAt);
  const now = Date.parse(input.nowIso);
  if (Number.isNaN(last) || Number.isNaN(now)) return true;
  return now - last >= input.cooldownHours * 3_600_000;
}
