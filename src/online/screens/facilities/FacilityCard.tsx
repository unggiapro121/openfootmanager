import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HardHat, Lock, MoreHorizontal, Pause, Star } from "lucide-react";
import { formatVal } from "../../../lib/valueFormatting";
import type { FacilitiesView, FacilityItemView } from "../../api";
import { useOnlineNow } from "../../clock";
import { useOnlineStore } from "../../store/onlineStore";
import { FOCUS } from "../mobile/PhoneSheet";
import { ClubArt } from "./art/ClubArt";
import { buildClock, type CardState, type DowngradeState } from "./cardState";
import { FacilityEffects } from "./FacilityEffects";
import { cardArt, facilityName, isCommerce, timeLeft } from "./facilityText";

export interface CardActions {
  onBuild: () => void;
  onSpeedUp: (secondsLeft: number) => void;
  onCancel: () => void;
  onDowngrade: () => void;
}

const BUTTON =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";
const OPEN = `${BUTTON} bg-primary-700 text-white hover:bg-primary-800`;
const SHUT = `${BUTTON} cursor-not-allowed border border-dashed border-gray-300 bg-gray-50 text-gray-500 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-400`;

/** One facility of the list (c-27 §5.4): its picture, level, what it does, and its one action. */
export function FacilityCard({
  item,
  view,
  state,
  downgrade,
  isNew,
  onSeen,
  actions,
}: {
  item: FacilityItemView;
  view: FacilitiesView;
  state: CardState;
  downgrade: DowngradeState;
  /** A build completed and not yet seen (S8). */
  isNew: boolean;
  /** The coach touched the card: its completion counts as seen (S8). */
  onSeen: () => void;
  actions: CardActions;
}) {
  const { t } = useTranslation();
  const name = facilityName(t, item.facility);
  const titleId = useId();
  const art = cardArt(item);

  return (
    <article
      aria-labelledby={titleId}
      onPointerDown={isNew ? onSeen : undefined}
      onFocus={isNew ? onSeen : undefined}
      className={`relative flex flex-col gap-3 rounded-xl border bg-white p-3 dark:bg-navy-800 ${
        isNew
          ? "border-accent-400 ring-1 ring-accent-400/40"
          : "border-gray-200 dark:border-navy-600"
      }`}
    >
      <div className="flex items-start gap-3">
        <ClubArt art={art} dimmed={item.level === 0} className="h-16 w-24 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-1 pr-8">
          <h3
            id={titleId}
            className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
          >
            {name}
          </h3>
          <p className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-bold text-gray-700 dark:bg-navy-600 dark:text-gray-200">
              {item.level === 0
                ? t("online.facilities.card.unbuilt")
                : t("online.facilities.card.level", { level: item.level })}
            </span>
            {isNew && (
              <span className="rounded-full bg-accent-100 px-2 py-0.5 font-bold uppercase text-accent-800 dark:bg-accent-500/20 dark:text-accent-300">
                {t("online.facilities.card.new")}
              </span>
            )}
          </p>
          <CardEffect item={item} view={view} />
        </div>
        <CardMenu item={item} state={state} downgrade={downgrade} actions={actions} name={name} />
      </div>
      <CardAction item={item} state={state} actions={actions} />
      {item.facility === "academy" && (
        <Link
          to="/online/academy"
          className={`self-start rounded text-sm font-semibold text-primary-700 hover:underline dark:text-primary-400 ${FOCUS}`}
        >
          {t("online.facilities.card.openAcademy")}
        </Link>
      )}
    </article>
  );
}

/** What the facility does now: the stands' seats, a commerce building's takings, the effects. */
function CardEffect({ item, view }: { item: FacilityItemView; view: FacilitiesView }) {
  const { t } = useTranslation();
  if (item.facility === "stands" && view.capacity !== undefined) {
    return (
      <p className="text-xs text-gray-600 dark:text-gray-300">
        {t("online.facilities.card.capacity", { capacity: view.capacity.toLocaleString() })}
      </p>
    );
  }
  if (isCommerce(item.facility)) {
    return (
      <p className="text-xs text-gray-600 dark:text-gray-300">
        {item.level === 0
          ? t("online.facilities.card.noEffect")
          : t("online.facilities.card.commerce")}
        {item.seasonEarnings !== undefined && item.seasonEarnings > 0 && (
          <>
            {" · "}
            {t("online.facilities.card.seasonEarnings", { amount: formatVal(item.seasonEarnings) })}
          </>
        )}
      </p>
    );
  }
  return <FacilityEffects effects={item.effects} compact />;
}

/** The card's one action, or the reason it is off (S1–S7, T4). */
function CardAction({
  item,
  state,
  actions,
}: {
  item: FacilityItemView;
  state: CardState;
  actions: CardActions;
}) {
  const { t } = useTranslation();
  const next = item.level + 1;
  switch (state.kind) {
    case "building":
      return <BuildingProgress item={item} state={state} actions={actions} />;
    case "top":
      return (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-accent-700 dark:text-accent-300">
          <Star className="h-4 w-4" aria-hidden="true" />
          {t("online.facilities.card.top")}
        </p>
      );
    case "writesOff":
      return (
        <button type="button" disabled className={SHUT}>
          {state.reason === "economy" ? (
            <Pause className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Lock className="h-4 w-4" aria-hidden="true" />
          )}
          {state.reason === "economy"
            ? t("online.facilities.card.economyOff")
            : t("online.facilities.card.clubLocked")}
        </button>
      );
    case "coachLocked":
      return (
        <div className="space-y-1.5">
          <button type="button" disabled className={SHUT}>
            {t("online.facilities.card.needsCoach", { level: state.coachLevel })}
          </button>
          <Reason icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>
            {t("online.facilities.card.coachReason", {
              next,
              needed: state.coachLevel,
              current: state.current,
            })}
          </Reason>
        </div>
      );
    case "builderBusy":
      return (
        <div className="space-y-1.5">
          <button type="button" disabled className={SHUT}>
            {item.level === 0
              ? t("online.facilities.card.buildPlain")
              : t("online.facilities.card.upgradeTo", { level: next })}
          </button>
          <BusyReason busy={state.busy} />
        </div>
      );
    case "short":
      return (
        <div className="space-y-1.5">
          <button type="button" disabled className={SHUT}>
            {t("online.facilities.card.upgradeFor", { level: next, cost: formatVal(state.cost) })}
          </button>
          <Reason>{t("online.facilities.card.short", { amount: formatVal(state.missing) })}</Reason>
        </div>
      );
    case "unbuilt":
      return (
        <button type="button" className={OPEN} onClick={actions.onBuild}>
          {t("online.facilities.card.build", { cost: formatVal(state.cost) })}
        </button>
      );
    case "ready":
      return (
        <button type="button" className={OPEN} onClick={actions.onBuild}>
          {t("online.facilities.card.upgradeFor", { level: next, cost: formatVal(state.cost) })}
        </button>
      );
  }
}

function Reason({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
      {icon}
      {children}
    </p>
  );
}

function BusyReason({ busy }: { busy: { facility: string; toLevel: number } }) {
  const { t } = useTranslation();
  return (
    <Reason icon={<HardHat className="h-3.5 w-3.5" aria-hidden="true" />}>
      {t("online.facilities.card.busyReason", {
        facility: facilityName(t, busy.facility),
        level: busy.toLevel,
      })}
    </Reason>
  );
}

/** A build under way (S6): its bar, the time left, and its speed-up unless writes are off. */
function BuildingProgress({
  item,
  state,
  actions,
}: {
  item: FacilityItemView;
  state: Extract<CardState, { kind: "building" }>;
  actions: CardActions;
}) {
  const { t } = useTranslation();
  const now = useOnlineNow();
  const offset = useOnlineStore((s) => s.facilitiesOffsetMs);
  const lineupLocked = useOnlineStore((s) => s.facilities?.lineupLocked ?? false);
  const writesOff = useWritesOff();
  const clock = buildClock(state.build, lineupLocked, now, offset);
  const share = clock.kind === "running" ? clock.share : 1;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-800 dark:text-gray-100">
          {t("online.facilities.card.levelChange", { from: item.level, to: state.build.toLevel })}
        </span>
        <span className="tabular-nums text-gray-600 dark:text-gray-300">{clockText(t, clock)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("online.facilities.card.progress", {
          facility: facilityName(t, item.facility),
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
      >
        <span
          className="block h-full rounded-full bg-primary-500"
          style={{ width: `${share * 100}%` }}
        />
      </div>
      {clock.kind === "running" && (
        <button
          type="button"
          disabled={writesOff !== null}
          className={writesOff ? SHUT : OPEN}
          onClick={() => actions.onSpeedUp(clock.secondsLeft)}
        >
          {t("online.facilities.crew.speedUp")}
        </button>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.facilities.card.buildingNote")}
      </p>
    </div>
  );
}

/** What a build's clock says: the time left, after the match (R27-1), or finishing. */
export function clockText(
  t: ReturnType<typeof useTranslation>["t"],
  clock: ReturnType<typeof buildClock>,
): string {
  if (clock.kind === "running")
    return t("online.facilities.crew.left", { time: timeLeft(t, clock.secondsLeft) });
  if (clock.kind === "afterMatch") return t("online.facilities.crew.afterMatch");
  return t("online.facilities.crew.due");
}

/** Every write off for the club: the season's economy paused, or its finances locked (T4). */
export function useWritesOff(): "economy" | "locked" | null {
  return useOnlineStore((state) =>
    state.facilities?.economyDisabled ? "economy" : state.finance?.locked ? "locked" : null,
  );
}

/** The card's ⋯ menu: cancel a build under way, take the facility a level down (S9, R27-2). */
function CardMenu({
  item,
  state,
  downgrade,
  actions,
  name,
}: {
  item: FacilityItemView;
  state: CardState;
  downgrade: DowngradeState;
  actions: CardActions;
  name: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const writesOff = useWritesOff();
  const building = state.kind === "building";

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (!building && downgrade.kind === "none") return null;
  const closeOnEscape = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  };
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const item_ =
    "flex min-h-11 w-full flex-col justify-center rounded-md px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-gray-100 dark:enabled:hover:bg-navy-600";
  return (
    <div ref={wrap} className="absolute right-1.5 top-1.5">
      <button
        type="button"
        aria-label={t("online.facilities.menu.label", { facility: name })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700 ${FOCUS}`}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={closeOnEscape}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={closeOnEscape}
          className="absolute right-0 top-11 z-20 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-navy-600 dark:bg-navy-800"
        >
          {building && (
            <button
              type="button"
              role="menuitem"
              className={`${item_} ${FOCUS}`}
              disabled={writesOff !== null}
              onClick={choose(actions.onCancel)}
            >
              <span className="font-semibold text-red-700 dark:text-red-400">
                {t("online.facilities.menu.cancel")}
              </span>
              {state.kind === "building" && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("online.facilities.menu.cancelHint", {
                    refund: formatVal(state.build.refundOnCancel),
                  })}
                </span>
              )}
            </button>
          )}
          {downgrade.kind !== "none" && (
            <button
              type="button"
              role="menuitem"
              className={`${item_} ${FOCUS}`}
              disabled={downgrade.kind !== "open"}
              onClick={choose(actions.onDowngrade)}
            >
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {t("online.facilities.menu.downgrade")}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {downgradeHint(t, downgrade, item)}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function downgradeHint(
  t: ReturnType<typeof useTranslation>["t"],
  downgrade: Exclude<DowngradeState, { kind: "none" }>,
  item: FacilityItemView,
): string {
  if (downgrade.kind === "open")
    return t("online.facilities.downgradeOff.noRefund", { level: item.level - 1 });
  switch (downgrade.reason) {
    case "writesOff":
      return t("online.facilities.downgradeOff.writesOff");
    case "building":
      return t("online.facilities.downgradeOff.building");
    case "lineupLocked":
      return t("online.facilities.downgradeOff.lineupLocked");
    case "atBottom":
      return t("online.facilities.downgradeOff.atBottom");
  }
}
