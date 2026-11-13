import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation } from "react-router-dom";
import { usePhoneLayout } from "../../hooks/usePhoneLayout";
import { AlertTriangle, Award, Lock, Pause } from "lucide-react";
import { Button } from "../../components/ui";
import type { FacilitiesView, FacilityItemView, FinanceView } from "../api";
import { refreshFacilities, useOnlineStore } from "../store/onlineStore";
import { buildsOverTime, cardState, downgradeState } from "./facilities/cardState";
import { CompletionLayer } from "./facilities/CompletionLayer";
import { FacilitiesHero } from "./facilities/FacilitiesHero";
import { FacilityCard, useWritesOff } from "./facilities/FacilityCard";
import { FacilityDialog } from "./facilities/FacilityDialog";
import {
  BuildDialog,
  CancelDialog,
  DowngradeDialog,
  SpeedUpDialog,
} from "./facilities/FacilityDialogs";
import {
  COMMERCE_FACILITIES,
  SPORTS_FACILITIES,
  STADIUM_FACILITIES,
} from "./facilities/facilityText";
import {
  markCompletionSeen,
  markLayerShown,
  useCompletionToShow,
  useUnseenCompletion,
} from "./facilities/seen";
import { useFacilitiesScreen } from "./facilities/useFacilitiesScreen";
import { SeasonCrowd } from "./facilities/matchday/SeasonCrowd";
import { TicketPriceCard } from "./facilities/matchday/TicketPriceCard";
import { useMatchday } from "./facilities/matchday/useMatchday";
import { CampusMap } from "./facilities/map/CampusMap";
import type { MapSlot } from "./facilities/map/layout";
import { ViewToggle } from "./facilities/map/ViewToggle";
import { useFacilitiesViewMode } from "./facilities/map/viewMode";
import ResourceState from "./ResourceState";
import { PhoneHeaderPart } from "./mobile/PhoneHeaderSlots";
import { FOCUS } from "./mobile/PhoneSheet";
import { RenameForm } from "./overview/ClubCard";

/** The dialog open over the screen, if any. */
type Open =
  | { kind: "build"; facility: string }
  | { kind: "speedUp"; secondsLeft: number }
  | { kind: "cancel" }
  | { kind: "downgrade"; facility: string }
  | { kind: "rename" }
  | null;

/**
 * The club's facilities (c-27 §5, C-27c): the stadium, the commerce and sports buildings and the
 * trophy room, each with what it does and its one action, built over time by one crew. Only for a
 * season that builds them so (§5.1): another goes back to Finance, which still upgrades at once.
 */
export default function OnlineFacilities() {
  const { view, finance, loadError, load } = useFacilitiesScreen();

  if (view === undefined || finance === undefined) {
    return loadError ? <LoadFailed onRetry={load} /> : <Loading />;
  }
  if (!buildsOverTime(view) || !view) return <Navigate to="/online/finance" replace />;
  return <FacilitiesBody view={view} finance={finance} />;
}

function Loading() {
  const { t } = useTranslation();
  const block = "animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none dark:bg-navy-700";
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("online.facilities.loading")}
      className="flex flex-col gap-4"
    >
      <div className={`${block} h-48`} />
      <div className={`${block} h-10`} />
      {[0, 1].map((row) => (
        <div key={row} className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className={`${block} h-36`} />
          <div className={`${block} h-36`} />
          <div className={`${block} h-36`} />
        </div>
      ))}
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/40 dark:bg-red-500/10"
    >
      <p className="flex items-center gap-2 font-heading font-bold uppercase tracking-wider text-red-800 dark:text-red-200">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {t("online.facilities.loadFailed")}
      </p>
      <p className="text-sm text-red-700 dark:text-red-300">
        {t("online.facilities.loadFailedHint")}
      </p>
      <Button size="sm" onClick={onRetry}>
        {t("online.retry")}
      </Button>
    </div>
  );
}

function FacilitiesBody({ view, finance }: { view: FacilitiesView; finance: FinanceView }) {
  const writesOff = useWritesOff();
  const clubId = useOnlineStore((state) => state.club?.club.id);
  const unseen = useUnseenCompletion();
  const layer = useCompletionToShow();
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState<string | null>(null);
  const matchday = useMatchday();
  const phone = usePhoneLayout();
  const [mode, setMode] = useFacilitiesViewMode();
  const { hash } = useLocation();
  const items = view.items ?? [];
  useScrollToStands(hash);
  const byName = (facility: string) => items.find((item) => item.facility === facility);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const close = () => setOpen(null);
  const done = (message: string) => {
    setOpen(null);
    setToast(message);
  };
  const stateOf = (item: FacilityItemView) =>
    cardState(item, { view, cash: finance.cash, writesOff });
  const cardsOf = (names: readonly string[]) =>
    names.flatMap((name) => {
      const item = byName(name);
      if (!item) return [];
      return [
        <FacilityCard
          key={item.facility}
          item={item}
          view={view}
          state={stateOf(item)}
          downgrade={downgradeState(item, view, writesOff)}
          isNew={unseen?.facility === item.facility}
          onSeen={() => {
            if (clubId && unseen) markCompletionSeen(clubId, unseen.completedAt);
          }}
          actions={{
            onBuild: () => setOpen({ kind: "build", facility: item.facility }),
            onSpeedUp: (secondsLeft) => setOpen({ kind: "speedUp", secondsLeft }),
            onCancel: () => setOpen({ kind: "cancel" }),
            onDowngrade: () => setOpen({ kind: "downgrade", facility: item.facility }),
          }}
        />,
      ];
    });

  const matchdayCards = (
    <>
      {matchday.view && (
        <TicketPriceCard
          key={matchday.view.ticketPrice}
          matchday={matchday.view}
          onAnswered={matchday.setView}
          onToast={setToast}
        />
      )}
      {matchday.view && <SeasonCrowd matchday={matchday.view} />}
      {matchday.failed !== null && (
        <ResourceState
          resource={{ status: "failed", error: matchday.failed }}
          reload={matchday.reload}
        >
          {() => null}
        </ResourceState>
      )}
    </>
  );
  const panelFor = (slot: MapSlot) =>
    slot === "trophy" ? (
      <TrophyRoomCard />
    ) : (
      <>
        {cardsOf([slot])}
        {slot === "stands" && matchdayCards}
      </>
    );
  const toggle = <ViewToggle mode={mode} onChange={setMode} />;

  return (
    <div className="flex flex-col gap-5">
      {writesOff && <WritesOffBanner reason={writesOff} />}
      {phone && <PhoneHeaderPart place="actions">{toggle}</PhoneHeaderPart>}
      <FacilitiesHero
        view={view}
        onRename={() => setOpen({ kind: "rename" })}
        onSpeedUp={(secondsLeft) => setOpen({ kind: "speedUp", secondsLeft })}
        toggle={phone ? undefined : toggle}
        compact={mode === "map"}
      />
      {mode === "map" ? (
        <CampusMap
          view={view}
          stateOf={stateOf}
          newFacility={unseen?.facility ?? null}
          firstPick={hash === "#stands" ? "stands" : null}
          panelFor={panelFor}
        />
      ) : (
        <FacilitiesSections view={view} cardsOf={cardsOf} matchdayCards={matchdayCards} />
      )}
      <OpenDialog
        open={open}
        view={view}
        finance={finance}
        items={items}
        onClose={close}
        onDone={done}
      />
      {layer && clubId && !open && (
        <CompletionLayer
          done={layer}
          view={view}
          onClose={() => markLayerShown(clubId, layer.completedAt)}
        />
      )}
      {toast && (
        <p
          role="status"
          className="fixed inset-x-4 bottom-[calc(6rem+var(--safe-bottom,0px))] z-40 mx-auto max-w-md rounded-xl bg-navy-800 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl md:bottom-6 dark:bg-gray-100 dark:text-navy-900"
        >
          {toast}
        </p>
      )}
    </div>
  );
}

/** Opened at `#stands` (the sold-out mail's way, c-27 §7.3): the stands' card scrolled to. */
function useScrollToStands(hash: string) {
  useEffect(() => {
    if (hash !== "#stands") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    document
      .getElementById("facility-card-stands")
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [hash]);
}

/** The List (c-27 §5.3): the stadium, commerce, sports and the trophy room, each a section. */
function FacilitiesSections({
  view,
  cardsOf,
  matchdayCards,
}: {
  view: FacilitiesView;
  cardsOf: (names: readonly string[]) => ReactNode[];
  matchdayCards: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Section id="facilities-stadium-section" title={t("online.facilities.section.stadium")}>
        {cardsOf(STADIUM_FACILITIES)}
        {matchdayCards}
      </Section>
      <Section
        id="facilities-commerce"
        title={t("online.facilities.section.commerce")}
        subtitle={t("online.facilities.section.commerceHint")}
      >
        {cardsOf(COMMERCE_FACILITIES)}
      </Section>
      <Section
        id="facilities-sports"
        title={t("online.facilities.section.sports")}
        subtitle={
          view.coachLevel === undefined
            ? undefined
            : t("online.facilities.section.coachLevel", { level: view.coachLevel })
        }
      >
        {cardsOf(SPORTS_FACILITIES)}
      </Section>
      <Section
        id="facilities-trophies"
        title={t("online.facilities.section.trophies")}
        subtitle={
          view.honoursCount === undefined
            ? t("online.facilities.section.trophiesNoUpgrade")
            : t("online.facilities.section.trophiesCount", { count: view.honoursCount })
        }
      >
        <TrophyRoomCard />
      </Section>
    </>
  );
}

/** The dialog the screen has open: building, speeding up, cancelling, downgrading, renaming. */
function OpenDialog({
  open,
  view,
  finance,
  items,
  onClose,
  onDone,
}: {
  open: Open;
  view: FacilitiesView;
  finance: FinanceView;
  items: FacilityItemView[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  if (!open) return null;
  const build = view.build ?? null;
  switch (open.kind) {
    case "build": {
      const item = items.find((entry) => entry.facility === open.facility);
      return item ? (
        <BuildDialog
          item={item}
          view={view}
          cash={finance.cash}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null;
    }
    case "speedUp":
      return build ? (
        <SpeedUpDialog
          build={build}
          view={view}
          secondsLeft={open.secondsLeft}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null;
    case "cancel": {
      const from = items.find((entry) => entry.facility === build?.facility)?.level ?? 0;
      return build ? (
        <CancelDialog build={build} fromLevel={from} onClose={onClose} onDone={onDone} />
      ) : null;
    }
    case "downgrade": {
      const item = items.find((entry) => entry.facility === open.facility);
      return item ? <DowngradeDialog item={item} onClose={onClose} onDone={onDone} /> : null;
    }
    case "rename":
      return club ? (
        <FacilityDialog title={t("online.facilities.hero.rename")} onClose={onClose}>
          <RenameForm
            current={club.club.name}
            currentStadium={club.club.stadiumName}
            free={club.renameFree}
            onDone={() => {
              onClose();
              void refreshFacilities().catch(() => undefined);
            }}
          />
        </FacilityDialog>
      ) : null;
  }
}

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2
          id={id}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        {subtitle && <span className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

/** Every write off (c-27 T4): the season's economy paused, or the club's finances locked. */
function WritesOffBanner({ reason }: { reason: "economy" | "locked" }) {
  const { t } = useTranslation();
  const Icon = reason === "economy" ? Pause : Lock;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-accent-300 bg-accent-50 px-4 py-3 text-sm text-gray-800 dark:border-accent-500/40 dark:bg-accent-500/10 dark:text-gray-100"
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-accent-700 dark:text-accent-300"
        aria-hidden="true"
      />
      {reason === "economy"
        ? t("online.facilities.banner.economyOff")
        : t("online.facilities.banner.clubLocked")}
    </div>
  );
}

/** The trophy room: where the club's honours are shown; it is never upgraded. */
function TrophyRoomCard() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-navy-600 dark:bg-navy-800">
      <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <Award
          className="h-5 w-5 shrink-0 text-accent-600 dark:text-accent-400"
          aria-hidden="true"
        />
        {t("online.facilities.trophies.body")}
      </p>
      <Link
        to="/online/honours"
        className={`flex min-h-11 items-center justify-center rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-navy-600 dark:text-gray-100 dark:hover:bg-navy-700 ${FOCUS}`}
      >
        {t("online.facilities.trophies.open")}
      </Link>
    </div>
  );
}
