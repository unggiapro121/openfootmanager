import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";
import type {
  ItemEffectView,
  ItemPreviewView,
  ItemTarget,
  ItemUseLimitsView,
  SquadPlayerView,
  StyleMasteryView,
} from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { formatMoment } from "../../format";
import { refreshClub, refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import {
  isMedkit,
  itemCodeText,
  itemName,
  itemsErrorText,
  type TargetKind,
  targetKindOf,
} from "./itemText";

const MATCH_LOCKED = "be.error.inventory.targetMatchLocked";

/** One choice of the picker: its target, its name, and why it is dimmed, if it is. */
interface Choice {
  key: string;
  target: ItemTarget;
  label: string;
  dimmed?: string;
}

/**
 * The picker's choices (C-7 C7-29). There is no route listing valid targets, so the club's players
 * or the coach's styles are listed, dimmed only by what the views already say: a full condition
 * (the condition stored is never above the condition now) and no injury for a medkit. Everything
 * else is the preview's to say.
 */
function choicesOf(
  t: TFunction,
  code: string,
  kind: TargetKind,
  players: SquadPlayerView[],
  styles: StyleMasteryView[],
): Choice[] {
  if (kind === "player") {
    return players.map((player) => ({
      key: player.id,
      target: { kind: "player", playerId: player.id },
      label: player.fullName,
      dimmed: isMedkit(code)
        ? player.injury
          ? undefined
          : t("online.items.reason.notInjured")
        : player.condition >= 100
          ? t("online.items.reason.conditionFull")
          : undefined,
    }));
  }
  if (kind === "style") {
    return styles.map((style) => ({
      key: style.style,
      target: { kind: "style", style: style.style },
      label: `${t(`common.playStyles.${style.style}`, style.style)} · ${style.level}`,
    }));
  }
  return [];
}

/** The target a use without a picker goes to: the club's eleven, or the account. */
function fixedTarget(kind: TargetKind): ItemTarget | undefined {
  if (kind === "club") return { kind: "club" };
  if (kind === "account") return { kind: "account" };
  return undefined;
}

function nameOf(players: SquadPlayerView[], id: string): string {
  return players.find((player) => player.id === id)?.fullName ?? id;
}

/** What a use did or would do, before and after, as lines (C-7 §17.3 step 3). */
function effectLines(t: TFunction, effect: ItemEffectView, players: SquadPlayerView[]): string[] {
  switch (effect.kind) {
    case "condition":
      return effect.players.map((change) =>
        t("online.items.preview.condition", {
          player: nameOf(players, change.playerId),
          before: change.before,
          after: change.after,
        }),
      );
    case "injury":
      return [
        effect.after === undefined
          ? t("online.items.preview.cured", {
              player: nameOf(players, effect.playerId),
              before: effect.before,
            })
          : t("online.items.preview.injury", {
              player: nameOf(players, effect.playerId),
              before: effect.before,
              after: effect.after,
            }),
      ];
    case "mastery":
      return [
        t("online.items.preview.mastery", {
          xp: effect.xp,
          before: effect.masteryBefore,
          after: effect.masteryAfter,
        }),
      ];
    case "xpX2":
      return [
        t("online.items.preview.xpX2", { matches: effect.matches, remaining: effect.remaining }),
      ];
  }
}

function limitLines(t: TFunction, language: string, limits: ItemUseLimitsView): string[] {
  const out: string[] = [];
  if (limits.usedToday !== undefined && limits.perDay !== undefined) {
    out.push(
      limits.nextAt
        ? t("online.items.limit.today", {
            used: limits.usedToday,
            perDay: limits.perDay,
            time: formatMoment(limits.nextAt, language),
          })
        : t("online.items.limit.todayPlain", { used: limits.usedToday, perDay: limits.perDay }),
    );
  }
  if (limits.seasonUsed !== undefined && limits.seasonLimit !== undefined) {
    out.push(
      t("online.items.limit.season", { used: limits.seasonUsed, limit: limits.seasonLimit }),
    );
  }
  if (limits.effectRemaining !== undefined && limits.effectMax !== undefined) {
    out.push(
      t("online.items.limit.xpX2", { remaining: limits.effectRemaining, max: limits.effectMax }),
    );
  }
  return out;
}

/** The coach's styles, for a study note's picker; read when the dialog opens. */
function useStyles(kind: TargetKind | undefined): StyleMasteryView[] {
  const [styles, setStyles] = useState<StyleMasteryView[]>([]);
  useEffect(() => {
    if (kind !== "style") return;
    let live = true;
    tracked(() => online.me.career())
      .then((career) => {
        if (live) setStyles(career.mastery);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kind]);
  return styles;
}

/**
 * Using one item (C-7 C7-14, C7-29): pick a target, see the server's preview, confirm. The preview
 * runs the use's own checks, so its refusal is the last word; nothing here adds or drops a reason.
 * One idempotency key per opening of the dialog, kept when a use with no answer is sent again.
 */
export default function UseItemDialog({
  code,
  initialTarget,
  onClose,
  onDone,
}: {
  code: string;
  /** A target already chosen where the dialog opened (a player's page). */
  initialTarget?: ItemTarget;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const kind = targetKindOf(code);
  const players = useOnlineStore((state) => state.club?.players ?? []);
  const styles = useStyles(kind);
  const [target, setTarget] = useState<ItemTarget | undefined>(
    () => initialTarget ?? (kind ? fixedTarget(kind) : undefined),
  );
  const [preview, setPreview] = useState<ItemPreviewView | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [asked, setAsked] = useState(0);
  const { run } = useActionKey();

  // One preview for the target chosen; a newer choice drops the answer to an older one.
  useEffect(() => {
    if (!target) return;
    let live = true;
    setPreview(null);
    setPreviewError(null);
    tracked(() => online.items.preview(code, target))
      .then((view) => {
        if (live) setPreview(view);
      })
      .catch((failure: unknown) => {
        if (live) setPreviewError(failure);
      });
    return () => {
      live = false;
    };
  }, [code, target, asked]);

  if (!kind) return null;
  const choices = choicesOf(t, code, kind, players, styles);
  const refusal = preview?.refusal;
  const matchLocked = refusal?.code === MATCH_LOCKED;

  const confirm = () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.items.use(code, target, key)), JSON.stringify(target))
      .then((view) => {
        useOnlineStore.setState((state) => ({
          items: state.items
            ? {
                ...state.items,
                lines: state.items.lines.map((line) =>
                  line.itemCode === code
                    ? {
                        ...line,
                        stacks: view.held,
                        total: view.held.reduce((sum, stack) => sum + stack.quantity, 0),
                      }
                    : line,
                ),
              }
            : state.items,
        }));
        void refreshItems().catch(() => undefined);
        if (target.kind === "player" || target.kind === "club")
          void refreshClub().catch(() => undefined);
        onDone(
          [
            t("online.items.used", { item: itemName(t, code) }),
            ...effectLines(t, view.effect, players),
          ].join(" "),
        );
      })
      .catch((failure: unknown) => {
        setError(failure);
        // A refusal now (the eleven locked, a cap reached meanwhile) is shown by the preview too.
        if (failure instanceof OnlineApiError && failure.status !== 0) setAsked((n) => n + 1);
      })
      .finally(() => setBusy(false));
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-lg">
      <div role="dialog" aria-modal="true" aria-labelledby="use-item-title" className="space-y-4">
        <h3
          id="use-item-title"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {t("online.items.useTitle", { item: itemName(t, code) })}
        </h3>
        {choices.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t(kind === "style" ? "online.items.pickStyle" : "online.items.pickPlayer")}
            </legend>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {choices.map((choice) => {
                const chosen = JSON.stringify(choice.target) === JSON.stringify(target);
                return (
                  <li key={choice.key}>
                    <button
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => {
                        if (!choice.dimmed) setTarget(choice.target);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${
                        chosen
                          ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                          : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-navy-700"
                      } ${choice.dimmed ? "opacity-50" : ""}`}
                    >
                      <span>{choice.label}</span>
                      {choice.dimmed && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {choice.dimmed}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
        {target && (
          <div aria-live="polite" className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {matchLocked && refusal && (
              <p
                role="alert"
                className="rounded-md border border-accent-400/50 bg-accent-50 px-3 py-2 dark:bg-accent-500/10"
              >
                {itemCodeText(t, i18n.language, refusal.code, refusal.params)}
              </p>
            )}
            {preview === null && previewError === null && <p>{t("online.items.previewing")}</p>}
            {previewError !== null && (
              <p role="alert" className="text-red-600 dark:text-red-400">
                {itemsErrorText(t, i18n.language, previewError)}
              </p>
            )}
            {preview?.effect &&
              effectLines(t, preview.effect, players).map((line) => <p key={line}>{line}</p>)}
            {preview &&
              limitLines(t, i18n.language, preview.limits).map((line) => (
                <p key={line} className="text-xs text-gray-500 dark:text-gray-400">
                  {line}
                </p>
              ))}
            {refusal && !matchLocked && (
              <p role="note" className="text-red-600 dark:text-red-400">
                {itemCodeText(t, i18n.language, refusal.code, refusal.params)}
              </p>
            )}
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {itemsErrorText(t, i18n.language, error)}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !target || !preview || Boolean(refusal)}
            onClick={confirm}
          >
            {t("online.items.confirmUse")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
