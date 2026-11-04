import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ExtraDayView, MyClubView, TrainingDayView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import DailyGift from "../items/DailyGift";
import { keepFocusInside } from "../items/ItemDialogFrame";
import { useGiftText } from "./ExtraEntry";
import { ExtraListBody, type ExtraListName, ExtraListTabs } from "./ExtraLists";
import { ExtraInfo, ExtraWarnings, InfoToggle, LastResultChip, PressBar } from "./ExtraParts";
import { ExtraResultBody, resultKicker } from "./ExtraResultBody";
import type { ExtraOutcome } from "./extraResult";
import { ExtraSettings } from "./ExtraSettings";
import { useExtraLists, useExtraOutcome } from "./useExtraLists";
import { useExtraSession } from "./useExtraSession";

/**
 * Extra sessions on top of the day's, in a panel from the right, laid out as the phone's page
 * (design MTapThem; C-12a C12-1…C12-6): the last result, folded open after a press; the settings
 * in one card; the players who can train (the whole squad by default) apart from those who rest
 * this session, each row telling why; the warnings, and the press with what it will do. The
 * server decides who trains. Escape, the backdrop and × close it unless a press is on its way.
 */
export default function ExtraTraining({
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

  useEffect(() => {
    if (result) setResultOpen(true);
  }, [result]);

  return (
    <Drawer busy={sending} onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-5 py-4 dark:border-navy-700 dark:bg-navy-800">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2
            id="extra-training-title"
            className="font-heading text-2xl font-bold uppercase tracking-wide text-gray-900 dark:text-white"
          >
            {t("online.training.extra.title")}
          </h2>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {t("online.training.extra.entryToday", { count: extra.today })}
            {giftText && ` · ${giftText}`}
          </p>
        </div>
        <InfoToggle open={info} onToggle={() => setInfo(!info)} />
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          aria-label={t("common.close")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-navy-600"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {info && <ExtraInfo cap={trainingDay.sessionsCap} />}
        {outcome && (
          <LastResultChip
            outcome={outcome}
            expanded={resultOpen}
            onOpen={() => setResultOpen(!resultOpen)}
          />
        )}
        {outcome && resultOpen && (
          <section
            aria-labelledby="extra-result-title"
            className="flex flex-col gap-3 rounded-[14px] border border-gray-200 bg-white p-3.5 dark:border-navy-600 dark:bg-navy-800"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {resultKicker(t, outcome)}
              </span>
              <h3
                id="extra-result-title"
                className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-white"
              >
                {t("online.training.phone.resultTitle")}
              </h3>
            </div>
            <ExtraResultBody club={club} outcome={outcome} floor={extra.floor} />
          </section>
        )}
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
        />
        <ExtraWarnings session={session} />
      </div>
      <div className="flex flex-col gap-2 border-t border-gray-200 bg-white px-5 py-3.5 dark:border-navy-600 dark:bg-navy-800">
        <PressBar
          reason={session.reason}
          summary={lists.summary}
          detail={lists.detail}
          disabled={!extra.canPress || sending || offline || lists.training === 0}
          onPress={press}
        />
      </div>
    </Drawer>
  );
}

/**
 * The panel's frame: a dark backdrop and a column on the right, full height. It takes the focus
 * when it opens, keeps Tab inside, and closes on Escape or a click on the backdrop unless busy.
 */
function Drawer({
  busy,
  onClose,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") keepFocusInside(ref.current, event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* The backdrop is for the mouse; the keyboard closes with Escape or the × button. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="extra-training-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-130 flex-col border-l border-gray-200 bg-gray-100 shadow-2xl outline-none dark:border-navy-600 dark:bg-navy-900"
      >
        {children}
      </div>
    </div>
  );
}
