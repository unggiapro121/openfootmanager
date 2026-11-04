import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import type { ExtraDayView, MyClubView, TrainingDayView } from "../../../api";
import { useOnlineStore } from "../../../store/onlineStore";
import DailyGift from "../../items/DailyGift";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { useGiftText } from "../ExtraEntry";
import {
  ExtraListBody,
  type ExtraListName,
  ExtraListTabs,
  type RestingPlayer,
} from "../ExtraLists";
import { ExtraInfo, ExtraWarnings, InfoToggle, LastResultChip, PressBar } from "../ExtraParts";
import type { ExtraOutcome } from "../extraResult";
import { ExtraSettings } from "../ExtraSettings";
import { useExtraLists, useExtraOutcome } from "../useExtraLists";
import { useExtraSession } from "../useExtraSession";
import { PhoneExtraResult } from "./PhoneExtraResult";

const KEY = "online.training.phone";

/**
 * Extra sessions on a phone (design MTapThem "Tập thêm"), a page over the page: the last result,
 * the settings in one card, then the players who can train (chosen by a tap) apart from those
 * who rest this session, each with why; the warnings, and the press with what it will do. The
 * answer rises in a sheet. The server decides who trains.
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
  const { choice, setChoice, intensity, sending, result } = session;
  const lists = useExtraLists(club, extra, session);
  const press = useExtraOutcome(club, session, onOutcome);
  const [list, setList] = useState<ExtraListName>("ready");
  const [info, setInfo] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [why, setWhy] = useState<RestingPlayer | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    if (result) setResultOpen(true);
  }, [result]);

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
        <InfoToggle open={info} onToggle={() => setInfo(!info)} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3.5 *:shrink-0">
        {info && <ExtraInfo cap={trainingDay.sessionsCap} />}
        {outcome && <LastResultChip outcome={outcome} onOpen={() => setResultOpen(true)} />}
        {giftReady && <DailyGift />}
        <ExtraSettings
          intensity={intensity}
          costs={extra.costs}
          choice={choice}
          floor={extra.floor}
          matchToday={session.matchToday}
          disabled={sending}
          onIntensity={session.setIntensity}
          onChoice={setChoice}
        />
        <ExtraListTabs
          list={list}
          ready={lists.ready.length}
          rest={lists.rest.length}
          allOn={lists.allOn}
          disabled={sending}
          onList={setList}
          onBulk={lists.bulk}
        />
        <ExtraListBody
          list={list}
          ready={lists.ready}
          rest={lists.rest}
          chosen={lists.chosenIds}
          keepAbove={choice.keepAbove}
          disabled={sending}
          onToggle={session.toggle}
          onWhy={setWhy}
        />
        <ExtraWarnings session={session} />
      </div>

      <footer className="flex flex-col gap-2 border-t border-gray-200 bg-white/95 px-4 pb-[calc(0.625rem+var(--safe-bottom))] pt-2.5 dark:border-navy-600 dark:bg-navy-800/95">
        <PressBar
          reason={session.reason}
          summary={lists.summary}
          detail={lists.detail}
          disabled={!extra.canPress || sending || offline || lists.training === 0}
          onPress={press}
        />
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
          <p className="text-sm leading-normal text-gray-700 dark:text-gray-300">{why.why}</p>
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
