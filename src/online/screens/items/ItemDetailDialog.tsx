import type { TFunction } from "i18next";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { ProgressBar } from "../../../components/ui";
import { formatDate } from "../../../lib/dateFormatting";
import type { InventoryLineView, InventoryView, ItemTarget, NoteLimitView } from "../../api";
import { formatMoment } from "../../format";
import { useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { FRAME_ACTION, FrameCancel, HeadBadge } from "./ItemDialogFrame";
import { lookOf } from "./itemLook";
import { groupOf, itemDescription, itemName, type TargetKind, targetKindOf } from "./itemText";
import { useStyles } from "./UseItemDialog";

/** Why the item cannot be used now, in the order the coach would fix it; `null` when it can. */
function useBlocker(
  t: TFunction,
  kind: TargetKind | undefined,
  items: InventoryView,
  hasClub: boolean,
): { text: string; takeOver?: boolean } | null {
  if (!kind) return null;
  if (items.locked) return { text: t("online.inventory.lockedShort") };
  if (!items.limits) return { text: t("online.inventory.notThisSeason") };
  if ((kind === "player" || kind === "club") && !hasClub) {
    return { text: t("online.inventory.needClub"), takeOver: true };
  }
  return null;
}

/** One style a study note may go to, with what notes banked in it this season when known. */
interface StyleChoice {
  style: string;
  level?: number;
  note?: NoteLimitView;
}

/** The coach's styles, and any the inventory's caps name that the career did not. */
function styleChoices(
  career: { style: string; level: number }[],
  notes: NoteLimitView[],
): StyleChoice[] {
  const choices: StyleChoice[] = career.map((mastery) => ({
    style: mastery.style,
    level: mastery.level,
    note: notes.find((note) => note.style === mastery.style),
  }));
  for (const note of notes) {
    if (!choices.some((choice) => choice.style === note.style)) {
      choices.push({ style: note.style, note });
    }
  }
  return choices;
}

/**
 * An item held (design kho-do.html): what it does, what it is used on, when its rows expire, the
 * day's or the season's caps the server counts, and the way to use it. A study note picks its
 * style here; every other use picks its target in the use dialog, which previews it.
 */
export default function ItemDetailDialog({
  line,
  items,
  onClose,
  onUse,
}: {
  line: InventoryLineView;
  items: InventoryView;
  onClose: () => void;
  onUse: (target?: ItemTarget) => void;
}) {
  const { t } = useTranslation();
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  const code = line.itemCode;
  const kind = targetKindOf(code);
  const group = groupOf(code);
  const look = lookOf(code);
  const descriptionId = useId();
  const [style, setStyle] = useState<string | null>(null);
  const career = useStyles(kind);
  const blocker = useBlocker(t, kind, items, hasClub);
  const recovery = code === "teamRecoveryPack" ? items.limits?.teamRecovery : undefined;
  // A ruleset with no use a day turns the pack off for the whole season, not until tomorrow.
  const recoveryOff = recovery?.perDay === 0;
  const recoveryDone = recovery !== undefined && recovery.usedToday >= recovery.perDay;
  const choices = kind === "style" ? styleChoices(career, items.limits?.notes ?? []) : [];
  const description = itemDescription(t, code);

  return (
    <ItemDialogFrame
      code={code}
      title={itemName(t, code)}
      describedBy={description ? descriptionId : undefined}
      onClose={onClose}
      badges={
        <>
          <HeadBadge tone={look.gold ? "gold" : "green"}>
            {t(`online.inventory.group.${group}`)}
          </HeadBadge>
          <HeadBadge tone="plain">{t("online.inventory.holding", { count: line.total })}</HeadBadge>
        </>
      }
    >
      {description && (
        <div className="flex flex-col gap-2">
          <span className="font-heading text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("online.shop.effectLabel")}
          </span>
          <p
            id={descriptionId}
            className="text-base leading-normal text-gray-900 dark:text-gray-100"
          >
            {description}
          </p>
        </div>
      )}
      <Facts line={line} items={items} />
      {kind === "style" && (
        <StylePicker
          choices={choices}
          picked={style}
          disabled={blocker !== null}
          onPick={setStyle}
        />
      )}
      {blocker && (
        <p
          role="note"
          className="flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-400"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {blocker.text}
            {blocker.takeOver && (
              <>
                {" "}
                <Link
                  to="/online/takeover"
                  className="rounded font-semibold text-primary-700 underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400"
                >
                  {t("online.coins.takeOver")}
                </Link>
              </>
            )}
          </span>
        </p>
      )}
      {group === "custom" && (
        <p role="note" className="text-sm text-gray-600 dark:text-gray-400">
          {t("online.inventory.renameAt")}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <FrameCancel onClick={onClose}>{t("common.close")}</FrameCancel>
        {kind && (
          <button
            type="button"
            className={FRAME_ACTION}
            disabled={blocker !== null || recoveryDone || (kind === "style" && style === null)}
            onClick={() => onUse(kind === "style" && style ? { kind: "style", style } : undefined)}
          >
            {recoveryOff
              ? t("online.inventory.action.offThisSeason")
              : actionText(t, kind, style, recoveryDone)}
          </button>
        )}
        {group === "custom" && hasClub && (
          <Link to="/online/squad" className={FRAME_ACTION}>
            {t("online.inventory.action.rename")}
          </Link>
        )}
        {group === "academy" && hasClub && (
          <Link to="/online/academy" className={FRAME_ACTION}>
            {t("online.inventory.action.academy")}
          </Link>
        )}
      </div>
    </ItemDialogFrame>
  );
}

function actionText(
  t: TFunction,
  kind: TargetKind,
  style: string | null,
  recoveryDone: boolean,
): string {
  if (recoveryDone) return t("online.inventory.action.usedToday");
  if (kind === "style") {
    return style
      ? t("online.inventory.action.style", { style: t(`common.playStyles.${style}`, style) })
      : t("online.inventory.action.pickStyle");
  }
  return t(`online.inventory.action.${kind}`);
}

/** What the item is used on, when its rows expire, and the caps that concern it. */
function Facts({ line, items }: { line: InventoryLineView; items: InventoryView }) {
  const { t, i18n } = useTranslation();
  const code = line.itemCode;
  const scope = lookOf(code).scope;
  const recovery = code === "teamRecoveryPack" ? items.limits?.teamRecovery : undefined;
  const xpX2 = code === "xpBoosterX2" ? items.limits?.xpX2 : undefined;
  const allLast = line.stacks.every((stack) => stack.expiresAt === undefined);
  const dt = "text-gray-500 dark:text-gray-400";
  const dd = "text-right font-semibold text-gray-900 dark:text-gray-100";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
      {scope && (
        <>
          <dt className={dt}>{t("online.shop.appliesTo")}</dt>
          <dd className={dd}>{t(`online.shop.scope.${scope}`)}</dd>
        </>
      )}
      <dt className={dt}>{t("online.inventory.expiry")}</dt>
      <dd className={dd}>
        {allLast ? (
          t("online.inventory.neverExpire")
        ) : (
          <ul aria-label={t("online.inventory.stacks")} className="flex flex-col gap-0.5">
            {line.stacks.map((stack) => (
              <li key={stack.expiresAt ?? "never"}>
                {stack.expiresAt
                  ? t("online.inventory.expires", {
                      count: stack.quantity,
                      date: formatDate(stack.expiresAt, i18n.language, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }),
                    })
                  : t("online.inventory.neverExpires", { count: stack.quantity })}
              </li>
            ))}
          </ul>
        )}
      </dd>
      {recovery && (
        <>
          <dt className={dt}>{t("online.inventory.dailyLimit")}</dt>
          {recovery.perDay === 0 ? (
            <dd className="text-right font-semibold text-accent-700 dark:text-accent-300">
              {t("online.inventory.offThisSeason")}
            </dd>
          ) : (
            <dd className="flex flex-col items-end gap-0.5 text-right">
              <span
                className={`font-semibold ${
                  recovery.usedToday >= recovery.perDay
                    ? "text-accent-700 dark:text-accent-300"
                    : "text-gray-900 dark:text-gray-100"
                }`}
              >
                {t("online.inventory.dailyUsed", {
                  used: recovery.usedToday,
                  perDay: recovery.perDay,
                })}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("online.inventory.refreshAt", {
                  time: formatMoment(recovery.nextAt, i18n.language),
                })}
              </span>
            </dd>
          )}
        </>
      )}
      {xpX2 && (
        <>
          <dt className={dt}>{t("online.inventory.xpWaiting")}</dt>
          <dd className={`${dd} tabular-nums`}>
            {xpX2.remaining}/{xpX2.max}
          </dd>
        </>
      )}
    </dl>
  );
}

/** The styles a note may go to; one that banked its season's XP from notes cannot be picked. */
function StylePicker({
  choices,
  picked,
  disabled,
  onPick,
}: {
  choices: StyleChoice[];
  picked: string | null;
  disabled: boolean;
  onPick: (style: string) => void;
}) {
  const { t } = useTranslation();
  const limit = choices.find((choice) => choice.note)?.note?.limit;
  const name = useId();
  if (choices.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2 border-t border-gray-200 pt-5 dark:border-navy-600">
      <legend className="contents">
        <span className="font-heading text-sm font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
          {t("online.inventory.pickStyle")}
        </span>
      </legend>
      {limit !== undefined && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.inventory.styleCap", { limit })}
        </span>
      )}
      {choices.map((choice) => {
        const used = choice.note?.usedXp ?? 0;
        const cap = choice.note?.limit ?? limit;
        const full = cap !== undefined && used >= cap;
        const on = picked === choice.style;
        return (
          <label
            key={choice.style}
            className={`grid grid-cols-[20px_1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary-500 ${
              on
                ? "border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/40"
                : "border-gray-200 bg-gray-50 hover:border-primary-500 dark:border-navy-600 dark:bg-navy-900 dark:hover:border-primary-500"
            } ${full || disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name={name}
              checked={on}
              disabled={full || disabled}
              onChange={() => onPick(choice.style)}
              className="h-4 w-4 accent-primary-600 focus:outline-none"
            />
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t(`common.playStyles.${choice.style}`, choice.style)}
            </span>
            <span
              className={`text-xs font-bold tabular-nums ${
                used > 0
                  ? "text-primary-700 dark:text-primary-300"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {cap !== undefined
                ? t("online.inventory.styleXp", { used, limit: cap })
                : choice.level !== undefined &&
                  t("online.inventory.styleLevel", { level: choice.level })}
            </span>
            {cap !== undefined && (
              <ProgressBar
                value={(used / cap) * 100}
                variant="primary"
                className="col-start-2 col-end-4"
              />
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
