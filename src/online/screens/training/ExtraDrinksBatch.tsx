import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import type { ExtraDayView, ExtraDrinksRequest, ExtraDrinksView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { refreshClub, refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { HeadBadge } from "../items/ItemDialogFrame";
import { itemCodeText, itemsErrorText } from "../items/itemText";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";
import { useActionKey } from "../useActionKey";
import type { RestingPlayer } from "./ExtraLists";
import type { useExtraSession } from "./useExtraSession";

const KEY = "online.training.extra.batch";
/** Why a player rests that a drink can lift: too tired, or under the condition to keep. */
const HELPED = new Set(["tired", "keepAbove"]);
/** The reasons the summary tells in its own words; any other is a `be.error.*` code. */
const REASONS = new Set([
  "notYours",
  "injured",
  "listed",
  "wontTrain",
  "enough",
  "notEnough",
  "dailyLimit",
  "noDrinks",
]);
/** How long the choice must stay still before the preview is asked again. */
const SETTLE_MS = 300;
const ignore = () => undefined;

type Translate = ReturnType<typeof useTranslation>["t"];

/** "3 small, 1 large": the drinks of a count by item code, the small first. */
function drinksText(t: Translate, counts: Record<string, number | undefined>): string {
  const small = counts.energyDrinkSmall ?? 0;
  const large = counts.energyDrinkLarge ?? 0;
  return [
    small > 0 ? t(`${KEY}.small`, { count: small }) : null,
    large > 0 ? t(`${KEY}.large`, { count: large }) : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function countOf(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const code of items) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
}

/**
 * Drinks for every player resting from tiredness, in one press (C-17 C17-12): while the "rest"
 * list is open the server's preview of the choice says who it would lift and with what, and a
 * button offers it; its summary is the only confirmation. Those lifted are chosen to train.
 */
export function useDrinksBatch({
  session,
  extra,
  rest,
  wanted,
  phone,
  onDone,
}: {
  session: ReturnType<typeof useExtraSession>;
  extra: ExtraDayView;
  rest: RestingPlayer[];
  /** The rest list is open and drinks can be offered. */
  wanted: boolean;
  phone: boolean;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const players = useOnlineStore((state) => state.club?.players ?? []);
  const key = useActionKey();
  const [preview, setPreview] = useState<{ ask: string; view: ExtraDrinksView } | null>(null);
  const [asked, setAsked] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { choice, intensity } = session;
  const ids = rest.filter((resting) => HELPED.has(resting.reason)).map((r) => r.player.id);
  const request: ExtraDrinksRequest | null =
    wanted && ids.length > 0
      ? {
          intensity,
          players: ids,
          sessions: choice.sessions,
          ...(choice.keepAbove === null ? {} : { keepAbove: choice.keepAbove }),
        }
      : null;
  const ask = request ? JSON.stringify(request) : null;

  useEffect(() => {
    if (!ask) return;
    let live = true;
    const timer = setTimeout(() => {
      tracked(() => online.clubs.extraDrinks.preview(JSON.parse(ask) as ExtraDrinksRequest))
        .then((view) => {
          if (live) setPreview({ ask, view });
        })
        .catch(() => {
          if (live) setPreview(null);
        });
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ask, extra, asked]);

  const shown = preview && preview.ask === ask ? preview.view : null;
  const nameOf = (id: string) => players.find((player) => player.id === id)?.matchName ?? "";
  const close = () => {
    setOpen(false);
    setError(null);
  };

  const confirm = async () => {
    if (!request || !ask) return;
    setBusy(true);
    setError(null);
    try {
      const view = await key.run(
        (idempotencyKey) => tracked(() => online.clubs.extraDrinks.use(request, idempotencyKey)),
        ask,
      );
      const current = useOnlineStore.getState().club;
      if (current) {
        useOnlineStore.getState().setClub({ ...current, trainingDay: view.trainingDay });
      }
      void refreshItems().catch(ignore);
      void refreshClub().catch(ignore);
      session.include(...view.lines.map((line) => line.playerId));
      onDone(
        view.lines.length > 0
          ? t(`${KEY}.done`, { count: view.lines.length, items: drinksText(t, view.used) })
          : t(`${KEY}.noneHelped`),
      );
      setOpen(false);
    } catch (failure) {
      setError(failure);
      // A 409 means the view was stale: read it and the preview again.
      if (failure instanceof OnlineApiError && failure.status === 409) {
        void refreshClub().catch(ignore);
        setAsked((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const button = shown && shown.lines.length > 0 && (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-800 dark:bg-cyan-600 dark:hover:bg-cyan-500 ${FOCUS}`}
    >
      <Zap className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
      {t(`${KEY}.button`, { count: shown.lines.length, items: drinksText(t, shown.used) })}
    </button>
  );

  const reasonText = (reason: string) =>
    REASONS.has(reason) ? t(`${KEY}.reason.${reason}`) : itemCodeText(t, i18n.language, reason, {});

  const summary = shown && (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-navy-600 dark:border-navy-600 dark:bg-navy-800">
        {shown.lines.map((line) => (
          <li key={line.playerId} className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                {nameOf(line.playerId)}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {drinksText(t, countOf(line.items))}
              </span>
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-primary-700 dark:text-primary-400">
              {t("online.items.quick.change", { before: line.before, after: line.after })}
            </span>
          </li>
        ))}
      </ul>
      {shown.skipped.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t(`${KEY}.skippedTitle`)}
          </h4>
          <ul className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
            {shown.skipped.map((skip) => (
              <li key={skip.playerId}>
                {t(`${KEY}.skippedLine`, {
                  name: nameOf(skip.playerId),
                  reason: reasonText(skip.reason),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t(`${KEY}.left`, {
          used: drinksText(t, shown.used),
          small: shown.held.energyDrinkSmall ?? 0,
          large: shown.held.energyDrinkLarge ?? 0,
        })}
      </p>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {itemsErrorText(t, i18n.language, error)}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void confirm()}
        className={`h-12 shrink-0 rounded-[10px] bg-primary-700 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-600 ${FOCUS}`}
      >
        {t(`${KEY}.confirm`)}
      </button>
    </div>
  );

  let layer: ReactNode = null;
  if (open && summary && phone) {
    layer = (
      <PhoneSheet
        title={t(`${KEY}.title`)}
        kicker={t(`${KEY}.kicker`, { count: shown.lines.length })}
        onClose={() => {
          if (!busy) close();
        }}
      >
        {summary}
      </PhoneSheet>
    );
  } else if (open && summary) {
    layer = (
      <ItemDialogFrame
        icon={
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300"
          >
            <Zap className="h-7 w-7" />
          </span>
        }
        title={t(`${KEY}.title`)}
        badges={
          <HeadBadge tone="plain">{t(`${KEY}.kicker`, { count: shown.lines.length })}</HeadBadge>
        }
        busy={busy}
        onClose={close}
      >
        {summary}
      </ItemDialogFrame>
    );
  }

  return { button, layer, open: open && summary !== null };
}
