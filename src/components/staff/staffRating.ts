import type { StaffData } from "../../store/gameStore";

/**
 * Per-role attribute weights, mirroring what the engine actually consumes.
 * A flat average over all four attributes rated a specialist on work their
 * role never does — an elite physio read as mediocre because coaching and
 * scouting dragged the number down.
 *
 * Sources, so these stay honest if the engine changes:
 * - Coach: `coaching` alone drives the training multiplier (`training.rs`).
 * - Physio: `physiotherapy` alone drives recovery (`training.rs`).
 * - Scout: `judgingAbility` sets assignment speed, `judgingPotential` sets
 *   potential accuracy (`scouting.rs`).
 * - AssistantManager: `(coaching*4 + judgingAbility*3 + judgingPotential*3)/10`
 *   is the engine's own `assistant_quality` (`delegated_renewals.rs`).
 */
const ROLE_ATTR_WEIGHTS: Record<string, Partial<Record<keyof StaffData["attributes"], number>>> = {
  Coach: { coaching: 10 },
  Physio: { physiotherapy: 10 },
  Scout: { judgingAbility: 5, judgingPotential: 5 },
  AssistantManager: { coaching: 4, judgingAbility: 3, judgingPotential: 3 },
};

/**
 * Weighting for a role we do not recognise. An even split says "no opinion",
 * which is the honest answer; borrowing another role's weighting would rate
 * someone confidently on work their role may never do.
 */
const UNKNOWN_ROLE_WEIGHTS = {
  coaching: 1,
  judgingAbility: 1,
  judgingPotential: 1,
  physiotherapy: 1,
} as const;

/** A staff member's overall rating, 0–100, for the work their role does. */
export function staffOvr(s: StaffData): number {
  const weights = ROLE_ATTR_WEIGHTS[s.role] ?? UNKNOWN_ROLE_WEIGHTS;
  const total = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
  if (total === 0) return 0;
  const weighted = Object.entries(weights).reduce(
    (sum, [key, weight]) =>
      sum + s.attributes[key as keyof StaffData["attributes"]] * (weight ?? 0),
    0,
  );
  return Math.round(weighted / total);
}
