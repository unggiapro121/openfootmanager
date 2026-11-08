import type { useTranslation } from "react-i18next";
import type { FocusFitView, TrainingPlan } from "../../api";

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * "Auto" as a choice of the club's focus (C-13b C13b-1). It is not one of the engine's focuses
 * (`TRAINING_FOCUS_IDS`): the plan keeps a real focus beside `autoFocus`, the one a session falls
 * back to when no focus lifts a player.
 */
export const AUTO_FOCUS = "Auto";

/**
 * The plan as it may be saved (R31c-C1): the server refuses "Auto" with Recovery, yet shows that
 * pair to a coach with no plan of his own whose club the AI left on Recovery. Auto then keeps
 * Technical, whatever the change being saved.
 */
export function savablePlan(plan: TrainingPlan): TrainingPlan {
  return plan.autoFocus && plan.focus === "Recovery" ? { ...plan, focus: "Technical" } : plan;
}

/** The club's focus as a screen names it: "Auto" while the club trains on it. */
export function planFocusLabel(t: Translate, plan: TrainingPlan): string {
  return plan.autoFocus ? t("online.training.focus.auto") : t(`training.focuses.${plan.focus}.label`);
}

/**
 * What a player with no group and no focus of his own trains, as a screen names it (C13b-3): on
 * "Auto", the focus "Auto" picks for him today (`focusFit.current`, S-31c), or only "Auto" when
 * the server gives no fit; otherwise the club's focus.
 */
export function teamFocusLabel(
  t: Translate,
  teamFocus: string,
  teamAuto: boolean,
  fit?: FocusFitView,
): string {
  if (!teamAuto) return t(`training.focuses.${teamFocus}.label`);
  return fit
    ? t("online.training.focus.autoPick", { focus: t(`training.focuses.${fit.current}.label`) })
    : t("online.training.focus.auto");
}
