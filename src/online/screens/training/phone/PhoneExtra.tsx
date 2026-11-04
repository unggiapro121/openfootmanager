import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, Info } from "lucide-react";
import type { ExtraDayView, MyClubView, TrainingDayView } from "../../../api";
import type { PlayerAttributes } from "../../../api/domain/PlayerAttributes";
import { useOnlineStore } from "../../../store/onlineStore";
import DailyGift from "../../items/DailyGift";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { useGiftText } from "../ExtraEntry";
import { Warning } from "../ExtraTraining";
import { ALL_SESSIONS, MATCH_CONDITION, stopReasonKey } from "../extraText";
import { extraOrder, stopsBeforeFirst } from "../trainingView";
import { listed, listedWithBest, useExtraSession } from "../useExtraSession";
import { pressTotals } from "./extraResult";
import { EmptyList, ReadyList, RestList, type RestingPlayer } from "./PhoneExtraLists";
import { type ExtraOutcome, PhoneExtraResult } from "./PhoneExtraResult";
import { PhoneExtraSettings } from "./PhoneExtraSettings";

const KEY = "online.training.phone";

type List = "ready" | "rest";

/** The sit-out reasons a "why" sheet explains in full; any other reads as `other`. */
const WHY_REASONS = new Set(["injured", "tired", "resting", "peaked", "focusMaxed", "keepAbove"]);

const pill = (on: boolean) =>
  `h-9 whitespace-nowrap rounded-full border px-3 text-xs font-semibold ${on ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300" : "border-gray-200 bg-white text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-300"} ${FOCUS}`;

/**
 * Extra sessions on a phone (design MTapThem "Tập thêm"), a page over the page: the last result,
 * the settings in one card, then the players who can train (chosen by a tap) apart from those
 * who rest this session — the server's sit-outs and those the condition to keep stops before the
 * first session — each with why; the warnings, and the press with what it will do. The answer
 * rises in a sheet. The server decides who trains.
 */
export default function PhoneExtra({
  club,
  trainingDay,
  extra,
  outcome,
  onOutcome,
  onClose,
}: {
  club: MyClubView;
  trainingDay: TrainingDayView;
  extra: ExtraDayView;
  /** The last press's result while the training page stays open. */
  outcome: ExtraOutcome | null;
  onOutcome: (outcome: ExtraOutcome) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const giftReady = useOnlineStore((state) => state.items?.dailyGift?.available === true);
  const giftText = useGiftText();
  const session = useExtraSession(club, trainingDay, extra);
  const { choice, setChoice, chosen, intensity, cost, sending, result } = session;
  const [list, setList] = useState<List>("ready");
  const [info, setInfo] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [why, setWhy] = useState<RestingPlayer | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<string, PlayerAttributes>());

  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    if (!result) return;
    onOutcome({ result, before: before.current });
    setResultOpen(true);
  }, [result, onOutcome]);

  const sitOut = new Map(extra.sitOut.map((line) => [line.playerId, line.reason]));
  const keptBack = (condition: number) =>
    stopsBeforeFirst(condition, cost, extra.floor, choice.keepAbove);
  const ordered = extraOrder(club.players, extra);
  const ready = ordered.filter((p) => !sitOut.has(p.id) && !keptBack(p.condition));
  const rest: RestingPlayer[] = ordered
    .filter((p) => sitOut.has(p.id) || keptBack(p.condition))
    .map((player) => {
      const reason = sitOut.get(player.id) ?? "keepAbove";
      const text = sitOut.has(player.id)
        ? t(stopReasonKey(reason), { floor: extra.floor })
        : t(`${KEY}.underKeep`, { value: choice.keepAbove });
      return { player, reason, text };
    });
  const chosenIds = new Set(chosen);
  // The players the footer counts: those chosen who can train this session.
  const training = ready.filter((player) => chosenIds.has(player.id)).length;
  const allOn = ready.length > 0 && ready.every((player) => chosenIds.has(player.id));
  const keepNote =
    choice.keepAbove === null ? "" : ` · ${t(`${KEY}.keepAtLeast`, { value: choice.keepAbove })}`;

  const press = () => {
    before.current = new Map(club.players.map((player) => [player.id, player.attributes]));
    void session.press();
  };
  const bulk = () => {
    const readyIds = new Set(ready.map((player) => player.id));
    const kept = allOn ? chosen.filter((id) => !readyIds.has(id)) : [...chosen, ...readyIds];
    setChoice({
      ...choice,
      players: club.players.map((p) => p.id).filter((id) => kept.includes(id)),
    });
  };

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-extra-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !sending && !resultOpen && !why) onClose();
      }}
      className="fixed inset-0 z-[55] flex flex-col bg-gray-100 focus:outline-none motion-safe:animate-page-in dark:bg-navy-900"
    >
      <header className="flex items-center gap-1 border-b border-gray-200 bg-white/95 pb-2.5 pl-1.5 pr-3 pt-[calc(0.625rem+var(--safe-top))] dark:border-navy-700 dark:bg-navy-800/95">
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          aria-label={t(`${KEY}.back`)}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-900 disabled:opacity-50 dark:text-white ${FOCUS}`}
        >
          <ChevronLeft className="h-5.5 w-5.5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <h2
            id="phone-extra-title"
            className="font-heading text-xl font-bold uppercase leading-tight tracking-wide text-gray-900 dark:text-white"
          >
            {t("online.training.extra.title")}
          </h2>
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">
            {t("online.training.extra.entryToday", { count: extra.today })}
            {giftText && ` · ${giftText}`}
          </span>
        </div>
        <button
          type="button"
          aria-expanded={info}
          aria-label={t(`${KEY}.howItWorks`)}
          onClick={() => setInfo(!info)}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-600 dark:text-primary-400 ${info ? "bg-gray-100 dark:bg-navy-700" : ""} ${FOCUS}`}
        >
          <Info className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3.5">
        {info && (
          <ul className="flex list-disc flex-col gap-1.5 rounded-xl border border-gray-200 bg-white py-3 pl-7 pr-3.5 text-xs leading-snug text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-300">
            <li>{t("online.training.extra.drawerIntro")}</li>
            <li>{t(`${KEY}.notCounted`, { cap: trainingDay.sessionsCap })}</li>
            <li>{t("online.training.extra.intensityHint")}</li>
          </ul>
        )}
        {outcome && (
          <button
            type="button"
            onClick={() => setResultOpen(true)}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-primary-300 bg-primary-50 px-3 text-left text-[13px] font-semibold text-primary-800 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300 ${FOCUS}`}
          >
            <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {t(`${KEY}.lastGains`, {
                players: pressTotals(outcome.result.players).improved,
                gains: pressTotals(outcome.result.players).gains,
              })}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
        {giftReady && <DailyGift />}
        <PhoneExtraSettings
          intensity={intensity}
          costs={extra.costs}
          choice={choice}
          floor={extra.floor}
          matchToday={session.matchToday}
          disabled={sending}
          onIntensity={session.setIntensity}
          onChoice={setChoice}
        />

        <div className="flex items-center gap-1.5">
          <div
            role="tablist"
            aria-label={t("online.training.extra.playersTitle")}
            className="flex flex-1 gap-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={list === "ready"}
              onClick={() => setList("ready")}
              className={pill(list === "ready")}
            >
              {t(`${KEY}.listReady`, { count: ready.length })}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={list === "rest"}
              onClick={() => setList("rest")}
              className={pill(list === "rest")}
            >
              {t(`${KEY}.listRest`, { count: rest.length })}
            </button>
          </div>
          {list === "ready" && ready.length > 0 && (
            <button
              type="button"
              disabled={sending}
              onClick={bulk}
              className={`h-9 whitespace-nowrap px-1 text-xs font-semibold text-primary-700 disabled:opacity-50 dark:text-primary-400 ${FOCUS}`}
            >
              {t(allOn ? "online.training.extra.selectNone" : `${KEY}.selectReady`)}
            </button>
          )}
        </div>
        {list === "ready" &&
          (ready.length > 0 ? (
            <ReadyList
              players={ready}
              chosen={chosenIds}
              disabled={sending}
              onToggle={session.toggle}
            />
          ) : (
            <EmptyList
              text={
                choice.keepAbove === null
                  ? t(`${KEY}.noneReady`)
                  : t(`${KEY}.noneReadyKeep`, { value: choice.keepAbove })
              }
            />
          ))}
        {list === "rest" &&
          (rest.length > 0 ? (
            <>
              <p className="-mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t(`${KEY}.restNote`)}
              </p>
              <RestList players={rest} onWhy={setWhy} />
            </>
          ) : (
            <EmptyList text={t(`${KEY}.noneResting`)} />
          ))}
        {session.starters.length > 0 && (
          <Warning>
            {t("online.training.extra.xiWarning", {
              names: listed(t, session.starters),
              condition: MATCH_CONDITION,
            })}
          </Warning>
        )}
        {session.full.length > 0 && (
          <Warning>
            {t("online.training.extra.focusFull", { names: listedWithBest(t, session.full) })}
          </Warning>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-gray-200 bg-white/95 px-4 pb-[calc(0.625rem+var(--safe-bottom))] pt-2.5 dark:border-navy-600 dark:bg-navy-800/95">
        {session.reason && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {session.reason}
          </p>
        )}
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-[15px] font-bold text-gray-900 dark:text-white">
              {choice.sessions === ALL_SESSIONS
                ? t(`${KEY}.footerMax`, { players: training })
                : t(`${KEY}.footer`, { players: training, sessions: choice.sessions })}
            </span>
            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
              {t(`training.intensities.${intensity}.label`)}
              {cost !== undefined && ` · ${t("online.training.extra.costPer", { cost })}`}
              {keepNote}
            </span>
          </span>
          <button
            type="button"
            disabled={!extra.canPress || sending || offline || training === 0}
            onClick={press}
            className={`h-12.5 shrink-0 rounded-xl bg-primary-700 px-5.5 font-heading text-lg font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:bg-primary-600 dark:disabled:bg-navy-700 dark:disabled:text-gray-400 ${FOCUS}`}
          >
            {t("online.training.extra.pressShort")}
          </button>
        </div>
      </footer>

      {resultOpen && outcome && (
        <PhoneExtraResult
          club={club}
          outcome={outcome}
          floor={extra.floor}
          onClose={() => setResultOpen(false)}
        />
      )}
      {why && (
        <PhoneSheet title={why.player.matchName} onClose={() => setWhy(null)}>
          <p className="text-sm leading-normal text-gray-700 dark:text-gray-300">
            {t(`${KEY}.why.${WHY_REASONS.has(why.reason) ? why.reason : "other"}`, {
              name: why.player.matchName,
              condition: Math.round(why.player.condition),
              floor: extra.floor,
              value: choice.keepAbove,
            })}
          </p>
          <button
            type="button"
            onClick={() => setWhy(null)}
            className={`h-12 shrink-0 rounded-[10px] bg-gray-100 text-sm font-semibold text-gray-900 dark:bg-navy-700 dark:text-white ${FOCUS}`}
          >
            {t(`${KEY}.gotIt`)}
          </button>
        </PhoneSheet>
      )}
    </div>
  );
}
