import { type ComponentProps, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Lock } from "lucide-react";
import type FacilityUpgradeDialog from "../../../components/finances/FacilityUpgradeDialog";
import { FACILITY_DEFINITIONS } from "../../../components/finances/FinancesTab.helpers";
import { formatDate } from "../../../lib/dateFormatting";
import type { FacilityPreviewView, FinanceView, LedgerLineView } from "../../api";
import { online } from "../../client";
import {
  refreshAcademy,
  refreshClub,
  refreshFinance,
  tracked,
  useOnlineStore,
} from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";

/**
 * What the finance page shows the same way on a desktop and on a phone: the facilities' names,
 * the ledger's kinds, the warnings, an upgrade's sending and the ledger's pages.
 */

/** The upgrade dialog's own types, read from its props: the online mode never imports an offline
 * service, even for a type (C-2 C2-15). */
type DialogProps = ComponentProps<typeof FacilityUpgradeDialog>;
export type FacilityKind = DialogProps["facility"];
type FacilityUpgradePreviewData = Awaited<ReturnType<NonNullable<DialogProps["loadPreview"]>>>;
type FacilityEffectFormat = FacilityUpgradePreviewData["effects"][number]["format"];

/** Weeks of wages a season pays over its days (S10-6): only to show a day's share. */
const WEEKS_A_SEASON = 52;
const SEASON_DAYS = 28;
/** Ledger lines read a page at a time. */
const LEDGER_PAGE = 30;

/** A season day's share of the weekly wage bill. */
export function wagePerDay(weeklyWageBill: number): number {
  return Math.round((weeklyWageBill * WEEKS_A_SEASON) / SEASON_DAYS);
}

export const KIND_OF: Record<string, FacilityKind> = {
  training: "Training",
  medical: "Medical",
};

/**
 * Facilities the online game has no use for (C-27a, Dfac-10): scouting does nothing online, so
 * the server refuses its upgrade and drops it from its view (S-49a). A server older than that
 * still sends it; the page leaves it out all the same. Offline keeps its scouting facility.
 */
const NOT_ONLINE = new Set(["scouting"]);

/** The academy (S-18, C-7c) is the server's own facility: the desktop game has no such row. */
const ONLINE_FACILITIES: Record<string, { titleKey: string; effectKey: string }> = {
  academy: {
    titleKey: "online.finance.facility.academy",
    effectKey: "online.finance.facility.academyEffect",
  },
};

export function titleKeyOf(facility: string): string {
  return (
    FACILITY_DEFINITIONS.find((definition) => definition.levelKey === facility)?.titleKey ??
    ONLINE_FACILITIES[facility]?.titleKey ??
    "finances.facilities"
  );
}

export function effectKeyOf(facility: string): string {
  return (
    FACILITY_DEFINITIONS.find((definition) => definition.levelKey === facility)?.effectKey ??
    ONLINE_FACILITIES[facility]?.effectKey ??
    "finances.facilities"
  );
}

/**
 * An effect's label key: the fork's effects send the whole key, the academy's slots only its last
 * part (`academySlots`).
 */
function effectLabelKey(key: string): string {
  return key.includes(".") ? key : `finances.facilityEffects.${key}`;
}

/** The server's preview in the shape the desktop's upgrade dialog draws (C-5 C5-5). */
export function asPreview(view: FacilityPreviewView): FacilityUpgradePreviewData {
  return {
    facility: KIND_OF[view.facility] ?? "Training",
    level: view.level,
    maxLevel: view.maxLevel,
    cost: view.cost,
    effects: view.effects.map((effect) => ({
      key: effectLabelKey(effect.key),
      format: effect.format as FacilityEffectFormat,
      current: effect.current,
      next: effect.next,
    })),
  };
}

/** A kind of ledger event in the player's words; a kind this build does not know, as it is. */
export function useKindLabel(): (kind: string) => string {
  const { t } = useTranslation();
  return (kind) => t(`online.finance.kind.${kind}`, { defaultValue: kind });
}

export function signedClass(amount: number): string {
  return amount < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400";
}

/** Where a ledger line leads: its match or its auction. */
export function refPath(line: LedgerLineView): string | null {
  if (!line.refId) return null;
  if (line.refKind === "match") return `/online/match/${line.refId}`;
  if (line.refKind === "auction") return `/online/auctions/${line.refId}`;
  return null;
}

/** The audit's lock and the wages owed, when the club has either. */
export function Banners({ finance }: { finance: FinanceView }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {finance.locked && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("be.error.economy.clubLocked")}
        </p>
      )}
      {finance.arrears && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-accent-400/50 bg-accent-50 px-4 py-3 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-100"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400"
            aria-hidden="true"
          />
          {t("online.finance.arrears", {
            days: finance.arrears.days,
            since: formatDate(finance.arrears.since, i18n.language),
            limit: finance.arrearsDaysToForcedListing ?? 3,
          })}
        </p>
      )}
    </>
  );
}

/** The club's facilities, read once a visit and again after an upgrade. */
export function useFacilities() {
  return useOnlineResource(
    async () =>
      (await tracked(() => online.finance.facilities())).facilities.filter(
        (facility) => !NOT_ONLINE.has(facility.facility),
      ),
    [],
  );
}

/**
 * One upgrade: one idempotency key for as long as its dialog or sheet is open (C-5 C5-4). The
 * club and its money are read again once it is done; the academy too, when its slots grew.
 */
export function useFacilityUpgrade(facility: FacilityPreviewView, onDone: (level: number) => void) {
  const [key] = useState(() => crypto.randomUUID());
  const [isUpgrading, setUpgrading] = useState(false);
  const [refusal, setRefusal] = useState<unknown>(null);

  const confirm = () => {
    setUpgrading(true);
    setRefusal(null);
    tracked(() => online.finance.upgradeFacility(facility.facility, key))
      .then(async (upgraded) => {
        await Promise.allSettled([refreshFinance(), refreshClub()]);
        if (facility.facility === "academy" && useOnlineStore.getState().academy) {
          void refreshAcademy().catch(() => undefined);
        }
        onDone(upgraded.level);
      })
      .catch((error: unknown) => {
        setRefusal(error);
        setUpgrading(false);
      });
  };
  return { confirm, isUpgrading, refusal };
}

/** The ledger newest first, a page at a time. */
export function useLedger() {
  const [lines, setLines] = useState<LedgerLineView[]>([]);
  const [next, setNext] = useState<number | undefined>(undefined);
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.finance.ledger(undefined, LEDGER_PAGE)),
    [],
  );
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    if (resource.status !== "ready") return;
    setLines(resource.data.items);
    setNext(resource.data.nextCursor);
  }, [resource]);

  const more = () => {
    if (next === undefined) return;
    setMoreError(null);
    tracked(() => online.finance.ledger(next, LEDGER_PAGE))
      .then((page) => {
        setLines((shown) => [...shown, ...page.items]);
        setNext(page.nextCursor);
      })
      .catch((error: unknown) => setMoreError(error instanceof Error ? error.message : null));
  };
  return { resource, reload, lines, hasMore: next !== undefined, more, moreError };
}
