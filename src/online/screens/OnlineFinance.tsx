import { type ComponentProps, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import FacilityUpgradeDialog from "../../components/finances/FacilityUpgradeDialog";
import { FACILITY_DEFINITIONS } from "../../components/finances/FinancesTab.helpers";
import { Button, Card, CardBody, CardHeader } from "../../components/ui";
import { formatDate } from "../../lib/dateFormatting";
import { formatExactMoney } from "../../lib/valueFormatting";
import type { FacilityPreviewView, FinanceView, LedgerLineView } from "../api";
import { online } from "../client";
import { refreshClub, refreshFinance, tracked, useOnlineStore } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import ResourceState from "./ResourceState";

/** The upgrade dialog's own types, read from its props: the online mode never imports an offline
 * service, even for a type (C-2 C2-15). */
type DialogProps = ComponentProps<typeof FacilityUpgradeDialog>;
type FacilityKind = DialogProps["facility"];
type FacilityUpgradePreviewData = Awaited<ReturnType<NonNullable<DialogProps["loadPreview"]>>>;
type FacilityEffectFormat = FacilityUpgradePreviewData["effects"][number]["format"];

/** Weeks of wages a season pays over its days (S10-6): only to show a day's share. */
const WEEKS_A_SEASON = 52;
const SEASON_DAYS = 28;
/** Ledger lines read a page at a time. */
const LEDGER_PAGE = 30;

const KIND_OF: Record<string, FacilityKind> = {
  training: "Training",
  medical: "Medical",
  scouting: "Scouting",
};

function titleKeyOf(facility: string): string {
  return (
    FACILITY_DEFINITIONS.find((definition) => definition.levelKey === facility)?.titleKey ??
    "finances.facilities"
  );
}

function effectKeyOf(facility: string): string {
  return (
    FACILITY_DEFINITIONS.find((definition) => definition.levelKey === facility)?.effectKey ??
    "finances.facilities"
  );
}

/** The server's preview in the shape the desktop's upgrade dialog draws (C-5 C5-5). */
function asPreview(view: FacilityPreviewView): FacilityUpgradePreviewData {
  return {
    facility: KIND_OF[view.facility] ?? "Training",
    level: view.level,
    maxLevel: view.maxLevel,
    cost: view.cost,
    effects: view.effects.map((effect) => ({
      key: effect.key,
      format: effect.format as FacilityEffectFormat,
      current: effect.current,
      next: effect.next,
    })),
  };
}

/**
 * The club's money (C-5 §3.3): what it holds and owes, what moved this season, its facilities and
 * its ledger. Every number is the server's; the page only spells them.
 */
export default function OnlineFinance() {
  const { t } = useTranslation();
  const finance = useOnlineStore((state) => state.finance);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    refreshFinance().catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  if (finance === undefined) {
    return (
      <ResourceState
        resource={loadError ? { status: "failed", error: loadError } : { status: "loading" }}
        reload={load}
      >
        {() => null}
      </ResourceState>
    );
  }
  if (!finance.economy) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.finance.noEconomy")}</p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-3 empty:hidden">
        <Banners finance={finance} />
      </div>
      <Figures finance={finance} />
      <SeasonTotals finance={finance} />
      <Facilities cash={finance.cash} locked={finance.locked} />
      <Ledger />
    </div>
  );
}

function Banners({ finance }: { finance: FinanceView }) {
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

const TILE = "rounded-xl bg-gray-50 p-4 text-center dark:bg-navy-800";
const TILE_LABEL =
  "mb-1 font-heading text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500";

function Figure({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={TILE}>
      <p className={TILE_LABEL}>{label}</p>
      <p className={`font-heading text-xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

/** What the club holds and owes, then its wage bill, as the offline overview lays them out. */
function Figures({ finance }: { finance: FinanceView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canExchange = useOnlineStore((state) => state.coins?.priceListVersion !== undefined);
  const perDay = Math.round((finance.weeklyWageBill * WEEKS_A_SEASON) / SEASON_DAYS);
  const net = finance.season.reduce((sum, line) => sum + line.amount, 0);
  return (
    <>
      <Card accent="accent" className="lg:col-span-2">
        <CardHeader>{t("finances.overview")}</CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Figure
              label={t("online.finance.cash")}
              value={formatExactMoney(finance.cash)}
              color={finance.cash < 0 ? "text-red-500" : "text-primary-500"}
            />
            <Figure
              label={t("online.finance.held")}
              value={formatExactMoney(finance.held)}
              color="text-gray-800 dark:text-gray-200"
            />
            <Figure
              label={t("online.finance.season")}
              value={formatExactMoney(net)}
              color={signedClass(net)}
            />
          </div>
          {canExchange && (
            <div className="mt-4 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => navigate("/online/coins")}>
                {t("online.finance.exchangeCoins")}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>{t("online.finance.wageBill")}</CardHeader>
        <CardBody>
          <div className="text-center">
            <p className={TILE_LABEL}>{t("finances.weeklyTotal")}</p>
            <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-gray-800 dark:text-gray-100">
              {formatExactMoney(finance.weeklyWageBill)}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("online.finance.wagePerDay", { amount: formatExactMoney(perDay) })}
            </p>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/** A kind of ledger event in the player's words; a kind this build does not know, as it is. */
function useKindLabel(): (kind: string) => string {
  const { t } = useTranslation();
  return (kind) => t(`online.finance.kind.${kind}`, { defaultValue: kind });
}

function signedClass(amount: number): string {
  return amount < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400";
}

function SeasonTotals({ finance }: { finance: FinanceView }) {
  const { t } = useTranslation();
  const label = useKindLabel();
  const total = finance.season.reduce((sum, line) => sum + line.amount, 0);
  return (
    <Card className="lg:col-span-3">
      <CardHeader>{t("online.finance.season")}</CardHeader>
      <CardBody>
        {finance.season.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("online.finance.seasonEmpty")}
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {finance.season.map((line) => (
              <div
                key={line.kind}
                className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center dark:border-navy-600 dark:bg-navy-800"
              >
                <dt className="mb-1 font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {label(line.kind)}
                </dt>
                <dd
                  className={`font-heading text-xl font-bold tabular-nums ${signedClass(line.amount)}`}
                >
                  {formatExactMoney(line.amount)}
                </dd>
              </div>
            ))}
            <div className="rounded-xl border border-gray-200 bg-gray-100 p-4 text-center dark:border-navy-600 dark:bg-navy-700">
              <dt className="mb-1 font-heading text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                {t("online.finance.total")}
              </dt>
              <dd className={`font-heading text-xl font-bold tabular-nums ${signedClass(total)}`}>
                {formatExactMoney(total)}
              </dd>
            </div>
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

function Facilities({ cash, locked }: { cash: number; locked: boolean }) {
  const { t } = useTranslation();
  const { resource, reload } = useOnlineResource(
    async () => (await tracked(() => online.finance.facilities())).facilities,
    [],
  );
  const [upgrading, setUpgrading] = useState<FacilityPreviewView | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <Card className="lg:col-span-3">
      <CardHeader>{t("finances.facilities")}</CardHeader>
      <CardBody>
        <ResourceState resource={resource} reload={reload}>
          {(facilities) => (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {facilities.map((facility) => (
                <li
                  key={facility.facility}
                  className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-navy-600 dark:bg-navy-800"
                >
                  <div className="space-y-1">
                    <h3 className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
                      {t(titleKeyOf(facility.facility))}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t("finances.facilityLevel", { level: facility.level })}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t(effectKeyOf(facility.facility))}
                    </p>
                  </div>
                  <div className="mt-auto space-y-2">
                    <p className="font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      {facility.cost === null
                        ? t("finances.facilityMaxLevel")
                        : t("online.finance.nextCost", { cost: formatExactMoney(facility.cost) })}
                    </p>
                    <Button
                      size="sm"
                      disabled={facility.cost === null || locked}
                      onClick={() => {
                        setDone(null);
                        setUpgrading(facility);
                      }}
                    >
                      {t("finances.upgradeFacility")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ResourceState>
        {done && (
          <p role="status" className="mt-3 text-sm text-green-700 dark:text-green-400">
            {done}
          </p>
        )}
      </CardBody>
      {upgrading && (
        <UpgradeDialog
          facility={upgrading}
          cash={cash}
          onClose={() => setUpgrading(null)}
          onDone={(level) => {
            setUpgrading(null);
            setDone(
              t("online.finance.upgraded", { facility: t(titleKeyOf(upgrading.facility)), level }),
            );
            reload();
          }}
        />
      )}
    </Card>
  );
}

/** One upgrade: one idempotency key for as long as the dialog is open (C-5 C5-4). */
function UpgradeDialog({
  facility,
  cash,
  onClose,
  onDone,
}: {
  facility: FacilityPreviewView;
  cash: number;
  onClose: () => void;
  onDone: (level: number) => void;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [isUpgrading, setUpgrading] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const confirm = () => {
    setUpgrading(true);
    setRefusal(null);
    tracked(() => online.finance.upgradeFacility(facility.facility, key))
      .then(async (upgraded) => {
        await Promise.allSettled([refreshFinance(), refreshClub()]);
        onDone(upgraded.level);
      })
      .catch((error: unknown) => {
        setRefusal(error instanceof Error ? error.message : String(error));
        setUpgrading(false);
      });
  };

  return (
    <FacilityUpgradeDialog
      facility={KIND_OF[facility.facility] ?? "Training"}
      titleKey={titleKeyOf(facility.facility)}
      balance={cash}
      blockReason={refusal}
      isUpgrading={isUpgrading}
      loadPreview={() => Promise.resolve(asPreview(facility))}
      onCancel={onClose}
      onConfirm={confirm}
    />
  );
}

function refPath(line: LedgerLineView): string | null {
  if (!line.refId) return null;
  if (line.refKind === "match") return `/online/match/${line.refId}`;
  if (line.refKind === "auction") return `/online/auctions/${line.refId}`;
  return null;
}

function Ledger() {
  const { t, i18n } = useTranslation();
  const label = useKindLabel();
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

  return (
    <Card className="lg:col-span-3">
      <CardHeader>{t("online.finance.ledger")}</CardHeader>
      <CardBody className="p-0">
        <ResourceState resource={resource} reload={reload}>
          {() =>
            lines.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                {t("online.finance.ledgerEmpty")}
              </p>
            ) : (
              <ol
                aria-label={t("online.finance.ledger")}
                className="flex flex-col divide-y divide-gray-100 dark:divide-navy-600"
              >
                {lines.map((line) => {
                  const path = refPath(line);
                  const text = `${label(line.kind)} · ${t(`online.finance.account.${line.account}`, { defaultValue: line.account })}`;
                  return (
                    <li
                      key={line.id}
                      className="flex items-center gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-navy-700/50"
                    >
                      <span className="w-32 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(line.gameDate ?? line.at, i18n.language, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-200">
                        {path ? (
                          <Link to={path} className="hover:underline">
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </span>
                      <span className={`font-medium tabular-nums ${signedClass(line.amount)}`}>
                        {formatExactMoney(line.amount)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )
          }
        </ResourceState>
        {next !== undefined && (
          <div className="border-t border-gray-100 px-5 py-3 dark:border-navy-600">
            <Button size="sm" variant="outline" onClick={more}>
              {t("online.finance.more")}
            </Button>
          </div>
        )}
        {moreError && (
          <p role="alert" className="px-5 pb-3 text-sm text-red-600 dark:text-red-400">
            {moreError}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
