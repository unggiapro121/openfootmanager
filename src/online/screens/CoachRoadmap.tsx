import type { TFunction } from "i18next";
import { Check, Circle, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, Card, CardBody, CardHeader } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import type { CareerView } from "../api";
import { online } from "../client";
import { type LicenceStep, licenceSteps } from "../convert/licence";
import { tracked } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";

/** `build_up_style` → `buildUpStyle`: the tactics board's label key of a dial. */
function dialLabelKey(dial: string): string {
  return dial.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * The coach's road (his online profile): his level and record, how a level is earned this
 * season, and the four licences with where he stands among them and what each opens.
 */
export default function CoachRoadmap() {
  const { t } = useTranslation();
  const { resource } = useOnlineResource(async () => {
    const [career, table] = await Promise.all([
      tracked(() => online.me.career()),
      tracked(() => online.licences.table()),
    ]);
    return { career, steps: table.levels ? licenceSteps(table) : [] };
  }, []);

  return (
    <Card className="max-w-2xl">
      <CardHeader>{t("online.roadmap.title")}</CardHeader>
      <CardBody className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        {resource.status === "loading" && <p>{t("online.loading")}</p>}
        {resource.status === "failed" && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {resolveBackendError(resource.error)}
          </p>
        )}
        {resource.status === "ready" && (
          <Road career={resource.data.career} steps={resource.data.steps} />
        )}
      </CardBody>
    </Card>
  );
}

function Road({ career, steps }: { career: CareerView; steps: LicenceStep[] }) {
  const { t } = useTranslation();
  const licence = career.licence;
  return (
    <>
      <div className="space-y-1">
        <p className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">
          {licence
            ? t("online.roadmap.standing", {
                level: career.level,
                licence: t(`tactics.licence.tier_${licence.tier}`),
              })
            : t("online.roadmap.level", { level: career.level })}
        </p>
        <p>
          {t("online.roadmap.record", {
            seasons: career.seasons,
            promotions: career.promotions,
          })}
        </p>
      </div>

      <section aria-labelledby="online-roadmap-how" className="space-y-1">
        <h3
          id="online-roadmap-how"
          className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400"
        >
          {t("online.roadmap.howTitle")}
        </h3>
        {career.promotion ? (
          <ul className="list-disc space-y-0.5 pl-5">
            <li>
              {t("online.roadmap.howTop", {
                places: career.promotion.places,
                size: career.promotion.leagueSize,
              })}
            </li>
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
      </section>

      {!licence && <p>{t("online.roadmap.allOpen")}</p>}
      {licence?.pending && <p>{t("online.roadmap.pending")}</p>}

      {steps.length > 0 && (
        <ol aria-label={t("online.roadmap.licences")} className="space-y-2">
          {steps.map((step) => (
            <Step key={step.tier} step={step} career={career} />
          ))}
        </ol>
      )}
    </>
  );
}

function Step({ step, career }: { step: LicenceStep; career: CareerView }) {
  const { t } = useTranslation();
  const held = career.licence?.tier ?? 0;
  const state = step.tier < held ? "passed" : step.tier === held ? "held" : "ahead";
  const Icon = state === "passed" ? Check : state === "held" ? CircleDot : Circle;
  const name = t(`tactics.licence.tier_${step.tier}`);
  return (
    <li
      aria-current={state === "held" ? "step" : undefined}
      className={`rounded-lg border px-3 py-2 ${
        state === "held"
          ? "border-primary-400 bg-primary-50 dark:border-primary-500 dark:bg-primary-500/10"
          : "border-gray-200 dark:border-navy-600"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 ${
            state === "ahead"
              ? "text-gray-400 dark:text-gray-500"
              : "text-primary-600 dark:text-primary-400"
          }`}
        />
        <span className="font-semibold text-gray-900 dark:text-gray-100">{name}</span>
        {step.startsAt !== null && (
          <span>{t("online.roadmap.atLevel", { level: step.startsAt })}</span>
        )}
        {state === "held" && (
          <Badge variant="primary" size="sm">
            {t("online.roadmap.held")}
          </Badge>
        )}
        {state === "ahead" && step.startsAt !== null && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.roadmap.levelsToGo", { levels: Math.max(step.startsAt - career.level, 0) })}
          </span>
        )}
      </div>
      <p className="mt-1">
        {t("online.roadmap.totals", {
          formations: step.totals.formations,
          styles: step.totals.playStyles,
          dials: step.totals.dials,
          roles: step.totals.roles,
        })}
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-semibold text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400">
          {step.tier === 1 ? t("online.roadmap.opensFirst") : t("online.roadmap.opensMore")}
        </summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {addedLines(step, t).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </li>
  );
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
