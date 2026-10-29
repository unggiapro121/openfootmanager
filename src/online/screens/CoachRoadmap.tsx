import type { TFunction } from "i18next";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, CircleDot, Info, Lock } from "lucide-react";
import type { CareerView } from "../api";
import type { LicenceStep } from "../convert/licence";
import LevelCaps from "./LevelCaps";
import { type TierState, tierState } from "./profile/profileView";

/** `build_up_style` → `buildUpStyle`: the tactics board's label key of a dial. */
function dialLabelKey(dial: string): string {
  return dial.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Whether the season splits promotion places by tier for this coach (S-22, C-9): a split that
 * reaches his level and is not even. Below `fromLevel` every league of the level keeps
 * `promotionPlaces`, which `howTop` already says.
 */
function tierLine(career: CareerView): boolean {
  const tiers = career.promotion?.tierPlaces;
  return tiers !== undefined && career.level >= tiers.fromLevel && tiers.top > tiers.bottom;
}

/**
 * The coach's road (his online profile; design ho-so-hlv.html): how a level is earned this
 * season, folded; the four licences with where he stands among them, one chosen to show what it
 * holds and adds; and his level caps when the season has them.
 */
export default function CoachRoadmap({
  career,
  steps,
}: {
  career: CareerView;
  steps: LicenceStep[];
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const howId = useId();
  const [how, setHow] = useState(false);
  const held = career.licence?.tier ?? 0;
  const [chosen, setChosen] = useState(Math.max(held, 1));
  const step = steps.find((one) => one.tier === chosen) ?? steps[0];

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-navy-600 dark:bg-navy-700"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-navy-600">
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("online.roadmap.title")}
        </h2>
        <button
          type="button"
          onClick={() => setHow((was) => !was)}
          aria-expanded={how}
          aria-controls={howId}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-navy-600 dark:text-gray-200 dark:hover:bg-navy-600"
        >
          {t("online.roadmap.howTitle")}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${how ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {how && (
        <div
          id={howId}
          className="border-b border-gray-200 bg-gray-50 px-6 py-3 text-[13px] text-gray-700 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-300"
        >
          {career.promotion ? (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {t("online.roadmap.howTop", {
                  places: career.promotion.places,
                  size: career.promotion.leagueSize,
                })}
              </li>
              {tierLine(career) && (
                <li>
                  {t("online.roadmap.howTier", {
                    top: career.promotion.tierPlaces?.top,
                    bottom: career.promotion.tierPlaces?.bottom,
                  })}
                </li>
              )}
              <li>
                {t("online.roadmap.howNewcomer", {
                  matches: career.promotion.newcomerMinMatches,
                })}
              </li>
              <li>{t("online.roadmap.howNeverDown")}</li>
            </ul>
          ) : (
            <p>{t("online.roadmap.noSeason")}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-5 p-6 text-sm text-gray-700 dark:text-gray-300">
        {!career.licence && <Note>{t("online.roadmap.allOpen")}</Note>}
        {career.licence?.pending && <Note>{t("online.roadmap.pending")}</Note>}
        {steps.length > 0 && (
          <ol
            aria-label={t("online.roadmap.licences")}
            className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @4xl:grid-cols-4"
          >
            {steps.map((one) => (
              <Tier
                key={one.tier}
                step={one}
                state={tierState(one.tier, held)}
                chosen={one.tier === step?.tier}
                onChoose={() => setChosen(one.tier)}
              />
            ))}
          </ol>
        )}
        {step && (
          <Chosen
            step={step}
            before={steps.find((one) => one.tier === step.tier - 1)}
            state={tierState(step.tier, held)}
            career={career}
            next={steps.find((one) => one.tier === held + 1)}
          />
        )}
        {career.caps && <LevelCaps caps={career.caps} />}
      </div>
    </section>
  );
}

function Note({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-2 text-[13px] text-gray-600 dark:text-gray-400">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

const DOT: Record<TierState, string> = {
  passed:
    "border-primary-500 bg-primary-500 text-white dark:border-success-400 dark:bg-success-400 dark:text-navy-900",
  held: "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-400",
  ahead: "border-gray-300 text-gray-400 dark:border-navy-600 dark:text-gray-500",
};
const TAG: Record<TierState, string> = {
  passed: "bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-400",
  held: "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
  ahead: "text-gray-500 dark:text-gray-400",
};

function tagText(t: TFunction, step: LicenceStep, state: TierState): string {
  if (state === "passed") return t("online.roadmap.tag.done");
  if (state === "held") return t("online.roadmap.held");
  return step.startsAt === null
    ? t("online.roadmap.status.ahead")
    : t("online.roadmap.tag.needs", { level: step.startsAt });
}

/** One licence, a button that shows it below; the held one is the road's current step. */
function Tier({
  step,
  state,
  chosen,
  onChoose,
}: {
  step: LicenceStep;
  state: TierState;
  chosen: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const Icon = state === "passed" ? Check : state === "held" ? CircleDot : Lock;
  return (
    <li aria-current={state === "held" ? "step" : undefined} className="flex">
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        className={`flex flex-1 flex-col gap-2 rounded-xl border p-3.5 text-left hover:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
          chosen
            ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
            : state === "held"
              ? "border-primary-300 bg-gray-50 dark:border-primary-800 dark:bg-navy-800"
              : "border-gray-200 bg-gray-50 dark:border-navy-600 dark:bg-navy-800"
        } ${state === "ahead" && !chosen ? "opacity-75" : ""}`}
      >
        <span className="flex items-center justify-between gap-1.5">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${DOT[state]}`}
            aria-hidden="true"
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={state === "passed" ? 3 : 2} />
          </span>
          <span
            className={`rounded-md px-1.5 font-heading text-[11px] font-semibold uppercase tracking-wider ${TAG[state]}`}
          >
            {tagText(t, step, state)}
          </span>
        </span>
        <span className="font-heading text-xl font-bold uppercase tracking-wide text-gray-900 dark:text-white">
          {t(`tactics.licence.tier_${step.tier}`)}
        </span>
        {step.startsAt !== null && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.roadmap.fromLevel", { level: step.startsAt })}
          </span>
        )}
      </button>
    </li>
  );
}

function statusOf(t: TFunction, state: TierState): string {
  if (state === "passed") return t("online.roadmap.status.passed");
  if (state === "held") return t("online.roadmap.status.held");
  return t("online.roadmap.status.ahead");
}

/** What the chosen licence asks and gives: how far it is, its totals, and what it adds by name. */
function Chosen({
  step,
  before,
  state,
  career,
  next,
}: {
  step: LicenceStep;
  before: LicenceStep | undefined;
  state: TierState;
  career: CareerView;
  next: LicenceStep | undefined;
}) {
  const { t } = useTranslation();
  const name = t(`tactics.licence.tier_${step.tier}`);
  const stats: { label: string; value: number; earlier: number | undefined }[] = [
    {
      label: t("online.roadmap.stat.formations"),
      value: step.totals.formations,
      earlier: before?.totals.formations,
    },
    {
      label: t("online.roadmap.stat.styles"),
      value: step.totals.playStyles,
      earlier: before?.totals.playStyles,
    },
    {
      label: t("online.roadmap.stat.dials"),
      value: step.totals.dials,
      earlier: before?.totals.dials,
    },
    {
      label: t("online.roadmap.stat.roles"),
      value: step.totals.roles,
      earlier: before?.totals.roles,
    },
  ];
  return (
    <section
      aria-label={name}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4.5 py-4 dark:border-navy-600 dark:bg-navy-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">
            {name}{" "}
            <span className="font-semibold text-gray-500 dark:text-gray-400">
              · {statusOf(t, state)}
            </span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {hintOf(t, step, state, career, next)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 @xl:grid-cols-4">
          {stats.map((stat) => {
            const added = stat.earlier === undefined ? 0 : Math.max(stat.value - stat.earlier, 0);
            return (
              <div key={stat.label} className="flex min-w-16 flex-col-reverse">
                <dt className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</dt>
                <dd className="flex items-baseline gap-1">
                  <span className="font-heading text-2xl font-bold leading-none text-gray-900 dark:text-white">
                    {stat.value}
                  </span>
                  {added > 0 && (
                    <span className="text-xs font-bold text-primary-600 dark:text-success-400">
                      +{added}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-semibold text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400">
          {step.tier === 1 ? t("online.roadmap.opensFirst") : t("online.roadmap.opensMore")}
        </summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs">
          {addedLines(step, t).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** A line under the chosen licence: how far it is, or where the road goes next. */
function hintOf(
  t: TFunction,
  step: LicenceStep,
  state: TierState,
  career: CareerView,
  next: LicenceStep | undefined,
): string {
  if (state === "ahead") {
    return step.startsAt === null
      ? t("online.roadmap.status.ahead")
      : t("online.roadmap.aheadHint", {
          levels: Math.max(step.startsAt - career.level, 0),
          level: step.startsAt,
        });
  }
  if (state === "held" && next && next.startsAt !== null) {
    return t("online.roadmap.nextHint", {
      licence: t(`tactics.licence.tier_${next.tier}`),
      level: next.startsAt,
      levels: Math.max(next.startsAt - career.level, 0),
    });
  }
  if (step.tier === 1) return t("online.roadmap.firstHint");
  return t("online.roadmap.passedHint");
}

/** What a licence adds, a line a kind, its names in the player's language. */
function addedLines(step: LicenceStep, t: TFunction): string[] {
  const { added } = step;
  const join = (names: string[]) => names.join(", ");
  const lines: string[] = [];
  if (added.formations.length > 0) {
    lines.push(t("online.roadmap.addedFormations", { list: join(added.formations) }));
  }
  if (added.playStyles.length > 0) {
    const styles = added.playStyles.map((style) => t(`common.playStyles.${style}`));
    lines.push(t("online.roadmap.addedStyles", { list: join(styles) }));
  }
  if (added.dials.length > 0) {
    const dials = added.dials.map((dial) => t(`tactics.phaseSettings.${dialLabelKey(dial)}`));
    lines.push(t("online.roadmap.addedDials", { list: join(dials) }));
  }
  if (added.roles.length > 0) {
    const roles = added.roles.map((role) => t(`tactics.playerRoles.${role}`));
    lines.push(t("online.roadmap.addedRoles", { list: join(roles) }));
  }
  if (lines.length === 0) lines.push(t("online.roadmap.addedNothing"));
  return lines;
}
