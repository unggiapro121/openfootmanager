import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, Info } from "lucide-react";
import { translatePositionAbbreviation } from "../../../../components/squad/SquadTab.helpers";
import { condBgColor, condColor } from "../../../../lib/playerConditionDisplay";
import { getPositionColor } from "../../../../lib/positionColors";
import type { ExtraDayView, MyClubView, SquadPlayerView, TrainingDayView } from "../../../api";
import { useOnlineStore } from "../../../store/onlineStore";
import DailyGift from "../../items/DailyGift";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { IntensityChooser, PressResult, SessionsChooser } from "../ExtraChoosers";
import { Warning } from "../ExtraTraining";
import { ALL_SESSIONS, MATCH_CONDITION, stopReasonKey } from "../extraText";
import { extraOrder, stopsBeforeFirst } from "../trainingView";
import { listed, useExtraSession } from "../useExtraSession";

const KEY = "online.training.phone";

type List = "ready" | "rest";

const SEGMENT = (on: boolean) =>
  `h-9 rounded-lg text-[13px] font-semibold ${on ? "bg-white text-gray-900 shadow-sm dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`;

/**
 * Extra sessions on a phone (design m-tap-luyen "Tập thêm"), a page over the page: the
 * intensity and its cost, how many sessions and the condition to keep, then the players who can
 * train (chosen by a tap) apart from those the server rests today with its reason, the warnings,
 * and the press with what it will do. The answer rises in a sheet. The server decides who trains.
 */
export default function PhoneExtra({
  club,
  trainingDay,
  extra,
  onClose,
}: {
  club: MyClubView;
  trainingDay: TrainingDayView;
  extra: ExtraDayView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const session = useExtraSession(club, trainingDay, extra);
  const { choice, setChoice, chosen, intensity, cost, sending, result } = session;
  const [list, setList] = useState<List>("ready");
  const [info, setInfo] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    if (result) setResultOpen(true);
  }, [result]);

  const sitOut = new Map(extra.sitOut.map((line) => [line.playerId, line.reason]));
  const ordered = extraOrder(club.players, extra);
  const ready = ordered.filter((player) => !sitOut.has(player.id));
  const rest = ordered.filter((player) => sitOut.has(player.id));
  const intensityLabel = t(`training.intensities.${intensity}.label`);
  // The players the summary counts: those chosen whom the server lets train today.
  const training = chosen.filter((id) => !sitOut.has(id)).length;
  const summary =
    choice.sessions === ALL_SESSIONS
      ? t("online.training.extra.summaryAll", { players: training, intensity: intensityLabel })
      : t("online.training.extra.summary", {
          players: training,
          sessions: choice.sessions,
          intensity: intensityLabel,
        });

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-extra-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !sending && !resultOpen) onClose();
      }}
      className="fixed inset-0 z-[55] flex flex-col bg-gray-100 focus:outline-none dark:bg-navy-900"
    >
      <header className="flex items-center gap-1 border-b border-gray-200 bg-white/95 pb-2 pl-1 pr-2 pt-[calc(0.5rem+var(--safe-top))] dark:border-navy-700 dark:bg-navy-800/95">
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          aria-label={t("common.close")}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-gray-700 disabled:opacity-50 dark:text-gray-200 ${FOCUS}`}
        >
          <ChevronLeft className="h-5.5 w-5.5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2
            id="phone-extra-title"
            className="font-heading text-xl font-bold uppercase leading-tight tracking-wide text-gray-900 dark:text-white"
          >
            {t("online.training.extra.title")}
          </h2>
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">
            {t("online.training.extra.entryToday", { count: extra.today })}
          </span>
        </div>
        <button
          type="button"
          aria-expanded={info}
          aria-label={t(`${KEY}.howItWorks`)}
          onClick={() => setInfo(!info)}
          className={`flex h-11 w-11 items-center justify-center rounded-full ${info ? "bg-gray-100 text-gray-900 dark:bg-navy-700 dark:text-white" : "text-gray-600 dark:text-gray-300"} ${FOCUS}`}
        >
          <Info className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {info && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white p-3 text-[13px] leading-snug text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-300">
            <p>{t("online.training.extra.drawerIntro")}</p>
            <p>{t("online.training.extra.intensityHint")}</p>
          </div>
        )}
        {result && (
          <button
            type="button"
            onClick={() => setResultOpen(true)}
            className={`flex items-center justify-between rounded-xl border border-primary-300 bg-primary-50 px-3 py-2 text-left text-[13px] font-semibold text-primary-800 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300 ${FOCUS}`}
          >
            {t(`${KEY}.lastResult`, { held: result.held })}
            <span aria-hidden="true">›</span>
          </button>
        )}
        <DailyGift />
        <IntensityChooser
          numbered={false}
          value={intensity}
          costs={extra.costs}
          disabled={sending}
          onChange={session.setIntensity}
        />
        <SessionsChooser
          numbered={false}
          choice={choice}
          floor={extra.floor}
          matchToday={session.matchToday}
          disabled={sending}
          onChange={setChoice}
        />
        <section
          aria-label={t("online.training.extra.playersTitle")}
          className="flex flex-col gap-2"
        >
          <div
            role="radiogroup"
            aria-label={t("online.training.extra.playersTitle")}
            className="grid grid-cols-2 rounded-[10px] border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-700 dark:bg-navy-800"
          >
            <button
              type="button"
              role="radio"
              aria-checked={list === "ready"}
              onClick={() => setList("ready")}
              className={SEGMENT(list === "ready")}
            >
              {t(`${KEY}.listReady`, { count: ready.length })}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={list === "rest"}
              onClick={() => setList("rest")}
              className={SEGMENT(list === "rest")}
            >
              {t(`${KEY}.listRest`, { count: rest.length })}
            </button>
          </div>
          {list === "ready" ? (
            <ReadyList
              players={ready}
              chosen={chosen}
              extra={extra}
              cost={cost}
              keepAbove={choice.keepAbove}
              disabled={sending}
              onToggle={session.toggle}
              onAll={() => setChoice({ ...choice, players: null })}
              onNone={() => setChoice({ ...choice, players: [] })}
            />
          ) : (
            <RestList players={rest} sitOut={sitOut} floor={extra.floor} />
          )}
        </section>
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
            {t("online.training.extra.focusFull", { names: listed(t, session.full) })}
          </Warning>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-gray-200 bg-white px-4 pb-[calc(0.75rem+var(--safe-bottom))] pt-2.5 dark:border-navy-700 dark:bg-navy-800">
        <span className="text-[13px] text-gray-600 dark:text-gray-400">
          {summary}
          {cost !== undefined && ` (${t("online.training.extra.costPer", { cost })})`}
        </span>
        {session.reason && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {session.reason}
          </p>
        )}
        <button
          type="button"
          disabled={!extra.canPress || sending || offline || chosen.length === 0}
          onClick={() => void session.press()}
          className={`h-12 rounded-xl bg-primary-700 font-heading text-base font-bold uppercase tracking-wider text-white disabled:bg-gray-200 disabled:text-gray-500 dark:bg-primary-600 dark:disabled:bg-navy-700 dark:disabled:text-gray-400 ${FOCUS}`}
        >
          {t("online.training.extra.pressShort")}
        </button>
      </footer>

      {resultOpen && result && (
        <PhoneSheet title={t(`${KEY}.resultTitle`)} onClose={() => setResultOpen(false)}>
          <div className="overflow-x-auto">
            <PressResult club={club} result={result} />
          </div>
        </PhoneSheet>
      )}
    </div>
  );
}

function PositionBadge({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  return (
    <span
      className={`rounded px-1 text-center font-heading text-[11px] font-bold leading-[18px] text-white ${getPositionColor(player.naturalPosition)}`}
    >
      {translatePositionAbbreviation(t, player.naturalPosition)}
    </span>
  );
}

function ConditionCell({ value, faded }: { value: number; faded?: boolean }) {
  const condition = Math.round(value);
  return (
    <>
      <span
        aria-hidden="true"
        className={`h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700 ${faded ? "opacity-45" : ""}`}
      >
        <span
          className={`block h-full ${condBgColor(condition)}`}
          style={{ width: `${Math.min(100, Math.max(0, condition))}%` }}
        />
      </span>
      <span
        className={`text-right text-[13px] font-bold tabular-nums ${condColor(condition)} ${faded ? "opacity-45" : ""}`}
      >
        {condition}%
      </span>
    </>
  );
}

/** Those the server lets train today: a tap chooses one; who the condition to keep would stop. */
function ReadyList({
  players,
  chosen,
  extra,
  cost,
  keepAbove,
  disabled,
  onToggle,
  onAll,
  onNone,
}: {
  players: SquadPlayerView[];
  chosen: string[];
  extra: ExtraDayView;
  cost: number | undefined;
  keepAbove: number | null;
  disabled: boolean;
  onToggle: (playerId: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const { t } = useTranslation();
  const ids = new Set(chosen);
  const allOn = players.length > 0 && players.every((player) => ids.has(player.id));
  if (players.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t(`${KEY}.noneReady`)}
      </p>
    );
  }
  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={disabled}
          onClick={allOn ? onNone : onAll}
          className={`h-8 rounded-lg px-2.5 text-xs font-semibold text-primary-700 disabled:opacity-50 dark:text-primary-400 ${FOCUS}`}
        >
          {t(allOn ? "online.training.extra.selectNone" : "online.training.extra.selectAll")}
        </button>
      </div>
      <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
        {players.map((player) => {
          const on = ids.has(player.id);
          const stops = on && stopsBeforeFirst(player.condition, cost, extra.floor, keepAbove);
          return (
            <li
              key={player.id}
              className="border-t border-gray-100 first:border-t-0 dark:border-navy-700"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={player.matchName}
                disabled={disabled}
                onClick={() => onToggle(player.id)}
                className={`grid min-h-12 w-full grid-cols-[22px_34px_minmax(0,1fr)_64px_40px] items-center gap-2 px-3 py-1.5 text-left disabled:opacity-50 ${on ? "bg-primary-50 dark:bg-primary-900/20" : ""} ${FOCUS}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded border-2 ${on ? "border-primary-500 bg-primary-500 text-white dark:text-navy-900" : "border-gray-400 dark:border-gray-500"}`}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <PositionBadge player={player} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {player.matchName}
                  </span>
                  {stops && (
                    <span className="text-[11px] text-accent-700 dark:text-accent-300">
                      {t("online.training.extra.willStop")}
                    </span>
                  )}
                </span>
                <ConditionCell value={player.condition} />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Those the server rests today, each with why. */
function RestList({
  players,
  sitOut,
  floor,
}: {
  players: SquadPlayerView[];
  sitOut: Map<string, string>;
  floor: number;
}) {
  const { t } = useTranslation();
  if (players.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t(`${KEY}.noneResting`)}
      </p>
    );
  }
  return (
    <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
      {players.map((player) => (
        <li
          key={player.id}
          className="grid min-h-12 grid-cols-[34px_minmax(0,1fr)_64px_40px] items-center gap-2 border-t border-gray-100 px-3 py-1.5 first:border-t-0 dark:border-navy-700"
        >
          <PositionBadge player={player} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-gray-500 dark:text-gray-400">
              {player.matchName}
            </span>
            <span className="text-[11px] text-red-600 dark:text-red-400">
              {t(stopReasonKey(sitOut.get(player.id) ?? ""), { floor })}
            </span>
          </span>
          <ConditionCell value={player.condition} faded />
        </li>
      ))}
    </ul>
  );
}
