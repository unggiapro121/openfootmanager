import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Minus } from "lucide-react";
import { Button, Card } from "../../../components/ui";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { FixtureProgressView, PlayerProgressLine, XpLine } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { PlayerLink } from "../opponent/PlayerLink";
import ResourceState from "../ResourceState";
import { notPlayedOrder, playedOrder, summaryOf } from "./progressView";

const KEY = "online.progress";
const MUTED = "text-sm text-gray-600 dark:text-gray-300";
const NAME =
  "rounded font-heading text-base font-bold text-gray-900 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-white dark:focus:ring-offset-navy-800";

/**
 * What a league match did to the coach's players (C-22b §7): the points they trained since their
 * line before, the Experience bar's point, OVR, form and morale. Only the coach's own club, and
 * nothing of what the bar banked: the server sends neither the pool nor its ceiling (PO P5-25).
 */
export default function OnlineFixtureProgress() {
  const { fixtureId = "" } = useParams();
  // A page per fixture: its tries and its first-open mark start again on another one.
  return <ProgressPage key={fixtureId} fixtureId={fixtureId} />;
}

/** How long to wait before asking again for a match the server has not settled yet. */
const RETRY_MS = 5000;
/** How many times to ask again, as the full-time ratings do (`fixtureRatings.ts`). */
const TRIES = 6;

function ProgressPage({ fixtureId }: { fixtureId: string }) {
  const { t } = useTranslation();
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.fixtures.progress(fixtureId)),
    [fixtureId],
  );
  // "Progress" is tapped at full time, usually before the server settles the match: an unsettled
  // answer is asked for again every 5 s, six times, then left to a reload button (PO P6, K1). The
  // last answer stays on screen while the next is read, so the page does not flicker.
  const [tries, setTries] = useState(0);
  const [last, setLast] = useState<FixtureProgressView | null>(null);
  useEffect(() => {
    if (resource.status === "ready") setLast(resource.data);
  }, [resource]);
  const waiting = resource.status === "ready" && !resource.data.settled;
  useEffect(() => {
    if (!waiting || tries >= TRIES) return;
    const timer = setTimeout(() => {
      setTries((count) => count + 1);
      reload();
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [waiting, tries, reload]);
  const askAgain = () => {
    setTries(0);
    reload();
  };
  const notYours =
    resource.status === "failed" &&
    resource.error instanceof OnlineApiError &&
    resource.error.code === "be.error.fixture.notYourClub";
  const shown =
    resource.status === "loading" && last && !last.settled
      ? ({ status: "ready", data: last } as const)
      : resource;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white">
          {t(`${KEY}.title`)}
        </h2>
        <Link
          to={`/online/fixtures/${fixtureId}`}
          className="inline-flex items-center gap-1 rounded text-sm font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("online.match.phone.ratings")}
        </Link>
      </div>
      {notYours ? (
        <p role="status" className={MUTED}>
          {resolveBackendError(resource.error)}
        </p>
      ) : (
        <ResourceState resource={shown} reload={reload}>
          {(view) =>
            view.settled ? (
              <Progress view={view} />
            ) : (
              <Pending gaveUp={tries >= TRIES && waiting} onReload={askAgain} />
            )
          }
        </ResourceState>
      )}
    </div>
  );
}

/** A match not settled yet: its figures are to come, and after the tries, a reload (P6). */
function Pending({ gaveUp, onReload }: { gaveUp: boolean; onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="status" className={MUTED}>
        {t(`${KEY}.pending`)}
      </p>
      {gaveUp && (
        <Button variant="outline" size="sm" onClick={onReload}>
          {t(`${KEY}.reload`)}
        </Button>
      )}
    </div>
  );
}

/**
 * Whether this is the first time the squad's lines show for this fixture in this tab: the bars
 * run only then (C-22 §7.2). Read when the lines first mount, so a visit while the match was
 * not settled yet does not use it up.
 */
function useFirstOpen(fixtureId: string): boolean {
  const reduced = usePrefersReducedMotion();
  const [first] = useState(() => {
    try {
      const key = `progress-seen:${fixtureId}`;
      const seen = window.sessionStorage.getItem(key) !== null;
      window.sessionStorage.setItem(key, "1");
      return !seen;
    } catch {
      // Storage off (private mode): the bars stay still rather than run on every open.
      return false;
    }
  });
  return first && !reduced;
}

/** A settled match: its lines, or none when the club was a bot's as it was settled. */
function Progress({ view }: { view: FixtureProgressView }) {
  const { t } = useTranslation();
  // Settled with no line: the club was still a bot's when the match was settled (Qs45-1).
  if (view.players.length === 0) {
    return (
      <p role="status" className={MUTED}>
        {t(`${KEY}.empty`)}
      </p>
    );
  }
  return <SquadProgress view={view} />;
}

function SquadProgress({ view }: { view: FixtureProgressView }) {
  const { t } = useTranslation();
  const animate = useFirstOpen(view.fixtureId);
  const summary = summaryOf(view.players);
  const played = playedOrder(view.players);
  const benched = notPlayedOrder(view.players);
  return (
    <div className="space-y-5">
      <Card accent="primary">
        <div className="space-y-2 p-5">
          <p className="font-heading text-lg font-bold text-gray-900 dark:text-white">
            {t(`${KEY}.summary`, {
              improved: summary.improved,
              points: summary.points,
              ovrUp: summary.ovrUp,
            })}
          </p>
          {summary.withXp && <p className={MUTED}>{t(`${KEY}.explain`)}</p>}
        </div>
      </Card>
      <ul className="grid gap-4 xl:grid-cols-2">
        {played.map((line) => (
          <li key={line.playerId}>
            <PlayerCard line={line} animate={animate} />
          </li>
        ))}
      </ul>
      {benched.length > 0 && <NotPlayed lines={benched} />}
    </div>
  );
}

function PlayerCard({ line, animate }: { line: PlayerProgressLine; animate: boolean }) {
  const { t } = useTranslation();
  return (
    <Card className="h-full">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <PlayerLink id={line.playerId} className={NAME}>
              {line.name}
            </PlayerLink>
            <p className="mt-0.5 text-sm tabular-nums text-gray-600 dark:text-gray-300">
              {line.ovrBefore === line.ovrAfter
                ? t(`${KEY}.ovrSame`, { ovr: line.ovrAfter })
                : t(`${KEY}.ovr`, { before: line.ovrBefore, after: line.ovrAfter })}
            </p>
          </div>
          {line.rating > 0 && (
            <span className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 font-heading text-base font-bold tabular-nums text-gray-800 dark:bg-navy-700 dark:text-gray-100">
              <span className="sr-only">
                {t(`${KEY}.rating`, { rating: line.rating.toFixed(1) })}
              </span>
              <span aria-hidden="true">{line.rating.toFixed(1)}</span>
            </span>
          )}
        </div>
        <Gains line={line} />
        {line.xp && <Experience xp={line.xp} animate={animate} />}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
          <Change
            label={t(`${KEY}.form`)}
            before={line.formBefore}
            after={line.formAfter}
            shown={(value) => (value / 10).toFixed(1)}
          />
          <Change
            label={t("common.morale")}
            before={line.moraleBefore}
            after={line.moraleAfter}
            shown={String}
          />
        </div>
      </div>
    </Card>
  );
}

function attributeName(t: (key: string) => string, attribute: string): string {
  return t(`common.attributes.${attribute}`);
}

/** The bar's point as a bright chip, what he trained since his line before as faint ones. */
function Gains({ line }: { line: PlayerProgressLine }) {
  const { t } = useTranslation();
  const up = line.xp?.attributeUp;
  if (!up && line.trainedSince.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t(`${KEY}.gains`)}>
      {up && (
        <li className="rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-bold text-primary-800 dark:bg-primary-500/20 dark:text-primary-300">
          {t(`${KEY}.up`, { attribute: attributeName(t, up) })}
        </li>
      )}
      {line.trainedSince.map((gain) => (
        <li
          key={gain.attribute}
          className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 dark:bg-navy-700 dark:text-gray-300"
        >
          {t(`${KEY}.trained`, {
            points: gain.points,
            attribute: attributeName(t, gain.attribute),
          })}
        </li>
      ))}
    </ul>
  );
}

/**
 * The Experience bar, before to after (0 to 100). On the first open it runs from where it was:
 * to the end and back to the rest when it gave a point, straight to the new value otherwise.
 * A bar that gave its point reads "90 → 100 · 20", so the rest is not taken for a fall (PO N3).
 */
function Experience({ xp, animate }: { xp: XpLine; animate: boolean }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState(animate ? 0 : 2);
  useEffect(() => {
    if (!animate) return;
    const run = setTimeout(() => setStage(1), 60);
    const rest = setTimeout(() => setStage(2), 900);
    return () => {
      clearTimeout(run);
      clearTimeout(rest);
    };
  }, [animate]);
  const width = stage === 0 ? xp.before : stage === 1 && xp.attributeUp ? 100 : xp.after;
  const shown = stage === 2 ? xp.after : xp.before;
  if (xp.gained === 0 && !xp.ready) return null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-700 dark:text-gray-200">
          {t("online.squad.experience")}{" "}
          <span className="tabular-nums text-gray-500 dark:text-gray-400">
            {xp.before} → {xp.attributeUp && stage === 2 && "100 · "}
            <span
              className={`inline-block transition-transform duration-300 ${stage === 2 && animate ? "scale-110" : ""}`}
            >
              {shown}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {xp.gained > 0 && (
            <span className="font-bold text-primary-700 dark:text-primary-400">
              {t(`${KEY}.xpGained`, { gained: xp.gained })}
            </span>
          )}
          {xp.ready && (
            <span className="rounded-full bg-accent-100 px-2 py-0.5 font-bold text-accent-800 dark:bg-accent-500/20 dark:text-accent-300">
              {t(`${KEY}.ready`)}
            </span>
          )}
        </span>
      </div>
      <span
        role="meter"
        aria-label={t("online.squad.experience")}
        aria-valuenow={xp.after}
        aria-valuemin={0}
        aria-valuemax={100}
        className="block h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
      >
        <span
          className={`block h-full bg-primary-500 ${animate && stage === 1 ? "transition-[width] duration-700 ease-out" : ""}`}
          style={{ width: `${width}%` }}
        />
      </span>
    </div>
  );
}

/** A figure before and after the match, with its direction. */
function Change({
  label,
  before,
  after,
  shown,
}: {
  label: string;
  before: number;
  after: number;
  shown: (value: number) => string;
}) {
  const Icon = after > before ? ArrowUp : after < before ? ArrowDown : Minus;
  const tone =
    after > before
      ? "text-primary-700 dark:text-primary-400"
      : after < before
        ? "text-red-600 dark:text-red-400"
        : "text-gray-500 dark:text-gray-400";
  return (
    <span className="inline-flex items-center gap-1">
      {label}{" "}
      <span className="tabular-nums">
        {shown(before)} → {shown(after)}
      </span>
      <Icon className={`h-3.5 w-3.5 ${tone}`} aria-hidden="true" />
    </span>
  );
}

/** The players who did not play, folded: only what they trained (C-22 §7.2). */
function NotPlayed({ lines }: { lines: PlayerProgressLine[] }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
      <summary className="cursor-pointer rounded-xl px-4 py-3 font-heading text-sm font-bold uppercase tracking-wider text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-200">
        {t(`${KEY}.notPlayed`, { count: lines.length })}
      </summary>
      <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-navy-600 dark:border-navy-600">
        {lines.map((line) => (
          <li key={line.playerId} className="space-y-1.5 px-4 py-2.5">
            <PlayerLink id={line.playerId}>{line.name}</PlayerLink>
            <Gains line={line} />
          </li>
        ))}
      </ul>
    </details>
  );
}
