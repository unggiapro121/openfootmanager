import { Link } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Hourglass, Minus, Plus } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { FacilitiesView, FacilityBuildView, FacilityItemView } from "../../api";
import { online } from "../../client";
import { FOCUS } from "../mobile/PhoneSheet";
import { ClubArt } from "./art/ClubArt";
import { stadiumStyleOf } from "./art/stadiumStyle";
import { DialogError, DialogFigures, FacilityDialog } from "./FacilityDialog";
import { FacilityEffects } from "./FacilityEffects";
import { facilityName, realTime, styleName, timeLeft } from "./facilityText";
import { refusalText, useFacilityWrite } from "./useFacilityWrite";

/** What a finished write tells the screen: its toast, and the view it answered with. */
export type Done = (message: string, view: FacilitiesView) => void;

const ACTIONS = "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end";

function Actions({
  confirm,
  sending,
  disabled = false,
  danger = false,
  onCancel,
  onConfirm,
  cancelLabel,
}: {
  confirm: string;
  sending: boolean;
  disabled?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={ACTIONS}>
      <Button type="button" variant="outline" onClick={onCancel}>
        {cancelLabel ?? t("common.cancel")}
      </Button>
      <Button
        type="button"
        variant={danger ? "accent" : "primary"}
        disabled={sending || disabled}
        onClick={onConfirm}
      >
        {sending ? t("online.facilities.sending") : confirm}
      </Button>
    </div>
  );
}

/** Building a facility, or its next level (c-27 §5.5). */
export function BuildDialog({
  item,
  view,
  cash,
  onClose,
  onDone,
}: {
  item: FacilityItemView;
  view: FacilitiesView;
  cash: number;
  onClose: () => void;
  onDone: Done;
}) {
  const { t } = useTranslation();
  const write = useFacilityWrite((key) => online.finance.buildFacility(item.facility, key));
  const name = facilityName(t, item.facility);
  const to = item.level + 1;
  const cost = item.cost ?? 0;
  const days = item.buildDays ?? 0;
  const daySeconds = view.daySeconds ?? 86_400;
  const stands = item.facility === "stands";
  const styleChanges = stands && stadiumStyleOf(item.level) !== stadiumStyleOf(to);

  const rows = [
    ...(stands && view.capacity !== undefined && view.nextCapacity !== undefined
      ? [
          {
            label: t("online.facilities.dialog.seats"),
            value: t("online.facilities.dialog.seatsChange", {
              before: view.capacity.toLocaleString(),
              after: view.nextCapacity.toLocaleString(),
            }),
          },
        ]
      : []),
    { label: t("online.facilities.dialog.price"), value: formatExactMoney(cost) },
    {
      label: t("online.facilities.dialog.time"),
      value:
        daySeconds < 86_400
          ? t("online.facilities.dialog.daysReal", {
              days,
              real: realTime(t, days * daySeconds),
            })
          : t("online.facilities.dialog.days", { days }),
    },
    ...(item.upkeepDelta && item.upkeepDelta > 0
      ? [
          {
            label: t("online.facilities.dialog.upkeep"),
            value: t("online.facilities.perSeason", {
              amount: `+${formatExactMoney(item.upkeepDelta)}`,
            }),
          },
        ]
      : []),
    { label: t("online.facilities.dialog.cashAfter"), value: formatExactMoney(cash - cost) },
  ];

  const confirm = async () => {
    const answered = await write.run();
    if (answered) {
      onDone(t("online.facilities.toast.started", { facility: name, level: to }), answered);
    }
  };

  return (
    <FacilityDialog
      title={
        item.level === 0
          ? t("online.facilities.dialog.buildTitle", { facility: name })
          : t("online.facilities.dialog.upgradeTitle", { facility: name, level: to })
      }
      onClose={onClose}
    >
      {stands && (
        <div className="grid grid-cols-2 gap-3">
          {[item.level, to].map((level, index) => (
            <figure key={level} className="space-y-1">
              <ClubArt art={stadiumStyleOf(level)} className="aspect-[16/10] rounded-lg" />
              <figcaption className="text-center text-xs text-gray-600 dark:text-gray-300">
                {index === 0 ? t("online.facilities.before") : t("online.facilities.after")} ·{" "}
                {styleName(t, level)}
              </figcaption>
            </figure>
          ))}
          <p className="col-span-2 text-center text-xs text-gray-500 dark:text-gray-400">
            {styleChanges
              ? t("online.facilities.dialog.styleChanges")
              : t("online.facilities.dialog.styleKept", { style: styleName(t, item.level) })}
          </p>
        </div>
      )}
      <FacilityEffects effects={item.effects} />
      <DialogFigures rows={rows} />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.facilities.dialog.note")}
      </p>
      <DialogError text={write.refusal ? refusalText(t, write.refusal) : null} />
      <Actions
        confirm={t("online.facilities.dialog.start")}
        sending={write.sending}
        disabled={cash < cost}
        onCancel={onClose}
        onConfirm={() => void confirm()}
      />
    </FacilityDialog>
  );
}

/**
 * Speeding the build up with time skips (c-27 §5.5): from one to as many as it needs or as are
 * held, what is left afterwards, and the shop when there are too few. No coin to finish it.
 */
export function SpeedUpDialog({
  build,
  view,
  secondsLeft,
  onClose,
  onDone,
}: {
  build: FacilityBuildView;
  view: FacilitiesView;
  secondsLeft: number;
  onClose: () => void;
  onDone: Done;
}) {
  const { t } = useTranslation();
  const held = view.timeSkipHeld ?? 0;
  const most = Math.max(1, Math.min(held, build.skipsToFinish));
  const [count, setCount] = useState(1);
  const write = useFacilityWrite((key) => online.finance.speedUpBuild(count, key));
  const name = facilityName(t, build.facility);
  const daySeconds = view.daySeconds ?? 86_400;
  const leftAfter = secondsLeft - count * build.skipDays * daySeconds;
  const step =
    "flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-900 disabled:opacity-50 dark:bg-navy-700 dark:text-gray-100";

  const confirm = async () => {
    const answered = await write.run(String(count));
    if (!answered) return;
    const used = answered.lastAction?.skipsUsed ?? count;
    onDone(t("online.facilities.toast.spedUp", { days: used * build.skipDays }), answered);
  };

  return (
    <FacilityDialog
      title={t("online.facilities.dialog.speedUpTitle", { facility: name, level: build.toLevel })}
      onClose={onClose}
    >
      <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <Hourglass className="h-4 w-4 text-accent-600 dark:text-accent-400" aria-hidden="true" />
        {t("online.facilities.dialog.held", { count: held })}
      </p>
      {held > 0 && (
        <fieldset className="flex items-center justify-between gap-3">
          <legend className="sr-only">{t("online.facilities.dialog.howMany")}</legend>
          <button
            type="button"
            className={`${step} ${FOCUS}`}
            aria-label={t("online.facilities.dialog.fewer")}
            disabled={count <= 1}
            onClick={() => setCount((was) => Math.max(1, was - 1))}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <output
            aria-live="polite"
            className="font-heading text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100"
          >
            {count}
          </output>
          <button
            type="button"
            className={`${step} ${FOCUS}`}
            aria-label={t("online.facilities.dialog.more")}
            disabled={count >= most}
            onClick={() => setCount((was) => Math.min(most, was + 1))}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </fieldset>
      )}
      {held > 0 && (
        <p className="text-sm text-gray-700 dark:text-gray-200">
          {leftAfter <= 0
            ? t("online.facilities.dialog.finishNow")
            : t("online.facilities.dialog.leftAfter", { time: timeLeft(t, leftAfter) })}
        </p>
      )}
      {held < build.skipsToFinish && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("online.facilities.dialog.needMore", { count: build.skipsToFinish })}{" "}
          <Link
            to="/online/shop"
            className={`rounded font-semibold text-primary-700 hover:underline dark:text-primary-400 ${FOCUS}`}
          >
            {t("online.facilities.dialog.shop")}
          </Link>
        </p>
      )}
      <DialogError text={write.refusal ? refusalText(t, write.refusal) : null} />
      <Actions
        confirm={t("online.facilities.dialog.useSkips", { count })}
        sending={write.sending}
        disabled={held === 0}
        onCancel={onClose}
        onConfirm={() => void confirm()}
      />
    </FacilityDialog>
  );
}

/** Cancelling the build: the server's refund, and the time skips spent are not given back. */
export function CancelDialog({
  build,
  fromLevel,
  onClose,
  onDone,
}: {
  build: FacilityBuildView;
  fromLevel: number;
  onClose: () => void;
  onDone: Done;
}) {
  const { t } = useTranslation();
  const write = useFacilityWrite((key) => online.finance.cancelBuild(key));
  const name = facilityName(t, build.facility);
  const refund = formatExactMoney(build.refundOnCancel);

  const confirm = async () => {
    const answered = await write.run();
    if (!answered) return;
    const given = answered.lastAction?.refund ?? build.refundOnCancel;
    onDone(t("online.facilities.toast.cancelled", { refund: formatExactMoney(given) }), answered);
  };

  return (
    <FacilityDialog title={t("online.facilities.dialog.cancelTitle")} onClose={onClose}>
      <p className="text-sm text-gray-700 dark:text-gray-200">
        {t("online.facilities.dialog.cancelBody", {
          facility: name,
          to: build.toLevel,
          from: fromLevel,
        })}
      </p>
      <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
        {t("online.facilities.dialog.cancelWarning", { refund })}
      </p>
      <DialogError text={write.refusal ? refusalText(t, write.refusal) : null} />
      <Actions
        confirm={t("online.facilities.menu.cancel")}
        cancelLabel={t("online.facilities.dialog.keepBuilding")}
        danger
        sending={write.sending}
        onCancel={onClose}
        onConfirm={() => void confirm()}
      />
    </FacilityDialog>
  );
}

/** Taking a facility a level down: what it then does, the upkeep saved, and no refund. */
export function DowngradeDialog({
  item,
  onClose,
  onDone,
}: {
  item: FacilityItemView;
  onClose: () => void;
  onDone: Done;
}) {
  const { t } = useTranslation();
  const write = useFacilityWrite((key) => online.finance.downgradeFacility(item.facility, key));
  const name = facilityName(t, item.facility);
  const to = item.level - 1;

  const confirm = async () => {
    const answered = await write.run();
    if (answered)
      onDone(t("online.facilities.toast.downgraded", { facility: name, level: to }), answered);
  };

  return (
    <FacilityDialog
      title={t("online.facilities.dialog.downgradeTitle", { facility: name })}
      onClose={onClose}
    >
      <p className="text-sm text-gray-700 dark:text-gray-200">
        {t("online.facilities.dialog.downgradeBody", { facility: name, from: item.level, to })}
      </p>
      <FacilityEffects effects={item.downgradeEffects} />
      {item.downgradeUpkeepSaving > 0 && (
        <DialogFigures
          rows={[
            {
              label: t("online.facilities.dialog.upkeep"),
              value: t("online.facilities.dialog.upkeepSaved", {
                amount: formatExactMoney(item.downgradeUpkeepSaving),
              }),
            },
          ]}
        />
      )}
      <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
        {t("online.facilities.dialog.downgradeWarning")}
      </p>
      <DialogError text={write.refusal ? refusalText(t, write.refusal) : null} />
      <Actions
        confirm={t("online.facilities.menu.downgrade")}
        danger
        sending={write.sending}
        onCancel={onClose}
        onConfirm={() => void confirm()}
      />
    </FacilityDialog>
  );
}
