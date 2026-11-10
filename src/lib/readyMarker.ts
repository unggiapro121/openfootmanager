import { logInfo } from "./logger";
import { isMobileBuild } from "./platform";

/** A screen whose first usable frame `scripts/mobile-measure.sh` times (phase 5 M2b-11). */
type ReadyStage = "login" | "overview";

const reached = new Set<ReadyStage>();

/**
 * Logs `OFM_READY <stage> <ms since the page started>` the first time the phone app reaches
 * `stage`. The measure script reads the line's log timestamp against the moment it launched the
 * app; the milliseconds are the WebView's share of that. No personal data, phone app only.
 */
export function markReady(stage: ReadyStage): void {
  if (!isMobileBuild() || reached.has(stage)) return;
  reached.add(stage);
  logInfo(`OFM_READY ${stage} ${Math.round(performance.now())}`);
}
