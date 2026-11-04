import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HeartPulse, MapPin, Shirt, SlidersHorizontal } from "lucide-react";
import { GeneratedCrest } from "../../../components/ui/GeneratedCrest";
import type { ClubRef, FixtureView, MyClubView, StandingRow } from "../../api";
import { deviceDiffersFromRegion, formatMoment, formatRegionClock } from "../../format";
import { useOnlineStore } from "../../store/onlineStore";
import ClubCrestMark from "../ClubCrestMark";
import { crestLabel } from "../crestLabel";
import { itemName } from "../items/itemText";
import { useCountdownText } from "../useCountdownText";
import OverviewCard, { CardBadge, LABEL } from "./OverviewCard";
import { useUsableCount } from "./useItemUse";

const RECOVERY = "teamRecoveryPack";

/**
 * The club's next match (design tong-quan.html): both clubs, the time left to the kick-off, and
 * what to prepare before it: the lineup, the tactics, the squad's recovery pack.
 */
export default function NextMatchCard({ onUse }: { onUse: (code: string) => void }) {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const fixture = club?.nextFixture;

  if (!club || !fixture) {
    return (
      <OverviewCard title={t("online.fixture.title")} edge="primary" className="flex-[2_1_560px]">
        <p className="p-6 text-sm text-gray-600 dark:text-gray-300">{t("online.fixture.none")}</p>
      </OverviewCard>
    );
  }

  const atHome = fixture.home.id === club.club.id;
  return (
    <OverviewCard
      edge="primary"
      className="flex-[2_1_560px]"
      title={
        <>
          {t("online.fixture.title")}{" "}
          <span aria-hidden="true" className="font-semibold text-gray-500 dark:text-gray-400">
            ·
          </span>{" "}
          <span className="font-semibold text-gray-500 dark:text-gray-400">
            {t("online.fixture.round", { round: fixture.round })}
          </span>
        </>
      }
      action={
        <CardBadge tone={atHome ? "green" : "plain"}>
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {atHome ? t("online.fixture.home") : t("online.fixture.away")}
        </CardBadge>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-6 py-7 max-md:gap-2 max-md:px-3 max-md:py-4">
        <Side club={fixture.home} home mine={atHome} myClub={club} />
        <Kickoff fixture={fixture} club={club} atHome={atHome} />
        <Side club={fixture.away} home={false} mine={!atHome} myClub={club} />
      </div>
      <Preparation onUse={onUse} />
    </OverviewCard>
  );
}

function Side({
  club,
  home,
  mine,
  myClub,
}: {
  club: ClubRef;
  home: boolean;
  mine: boolean;
  myClub: MyClubView;
}) {
  const { t } = useTranslation();
  const row: StandingRow | undefined = useOnlineStore((state) =>
    state.league?.table.find((line) => line.club.id === club.id),
  );
  const profile = mine ? myClub.club : undefined;
  return (
    <div className="flex min-w-0 flex-col items-center gap-2.5 text-center">
      <span
        className={`h-19 w-19 rounded-2xl max-md:h-14 max-md:w-14 ${mine ? "ring-4 ring-primary-500/30 dark:ring-primary-400/30" : ""}`}
      >
        {profile ? (
          <ClubCrestMark profile={profile} />
        ) : (
          <GeneratedCrest
            name={club.name}
            label={crestLabel(club.name)}
            className="h-full w-full"
          />
        )}
      </span>
      <span
        className={`max-w-full break-words font-heading text-xl font-bold uppercase tracking-wider max-md:font-sans max-md:text-sm max-md:font-semibold max-md:normal-case max-md:tracking-normal ${
          mine ? "text-primary-700 dark:text-primary-300" : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {club.name}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {row
          ? t("online.overview.standingLine", { position: row.position, points: row.points })
          : home
            ? t("online.overview.homeSide")
            : t("online.overview.awaySide")}
      </span>
    </div>
  );
}

function Kickoff({
  fixture,
  club,
  atHome,
}: {
  fixture: FixtureView;
  club: MyClubView;
  atHome: boolean;
}) {
  const { t, i18n } = useTranslation();
  const labelId = useId();
  const countdown = useCountdownText(fixture.kickoffAt);
  const region = club.club.region;
  const playing =
    fixture.matchId && (fixture.matchStatus === "live" || fixture.matchStatus === "scheduled");
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 text-center max-md:gap-1 max-md:px-0">
      <span id={labelId} className={LABEL}>
        {t("online.overview.kickoffIn")}
      </span>
      <span
        role="timer"
        aria-live="off"
        aria-labelledby={labelId}
        className="font-heading text-5xl font-bold leading-none tabular-nums text-gray-900 max-md:text-3xl max-md:text-accent-700 dark:text-white dark:max-md:text-accent-400"
      >
        {countdown ?? "—"}
      </span>
      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {formatMoment(fixture.kickoffAt, i18n.language)}
      </span>
      {deviceDiffersFromRegion(region, fixture.kickoffAt) && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.fixture.regionTime", {
            time: formatRegionClock(fixture.kickoffAt, region, i18n.language),
            region: t(`coach.regions.${region}`),
          })}
        </span>
      )}
      {atHome && (
        <span className="text-xs text-gray-500 dark:text-gray-400">{club.club.stadiumName}</span>
      )}
      {fixture.status === "prepared" && (
        <span className="text-xs font-semibold text-accent-700 dark:text-accent-300">
          {t("online.fixture.prepared")}
        </span>
      )}
      {playing && (
        <Link
          to={`/online/match/${fixture.matchId}`}
          className="mt-1 inline-flex h-10 items-center rounded-lg bg-red-600 px-3.5 font-heading text-sm font-bold uppercase tracking-wider text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:bg-red-600 dark:hover:bg-red-500 dark:focus:ring-offset-navy-800"
        >
          {fixture.matchStatus === "live"
            ? t("online.fixture.enterLive")
            : t("online.fixture.enterMatch")}
        </Link>
      )}
    </div>
  );
}

const QUICK =
  "flex min-h-12 items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-gray-900 hover:border-primary-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:bg-white dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100 dark:hover:border-primary-500 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800 dark:disabled:hover:border-navy-600 dark:disabled:hover:bg-navy-700";
const QUICK_ICON = "h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400";
/** On a phone the lineup is the card's main action, a full-width green button (design m-tong-quan.html). */
const LINEUP_ON_PHONE =
  "max-md:basis-full max-md:justify-center max-md:border-primary-600 max-md:bg-primary-600 max-md:text-white max-md:hover:bg-primary-700 dark:max-md:border-primary-600 dark:max-md:bg-primary-600 dark:max-md:text-white dark:max-md:hover:bg-primary-700";

/** What the coach sets before the match: the lineup, the tactics, the recovery pack held. */
function Preparation({ onUse }: { onUse: (code: string) => void }) {
  const { t } = useTranslation();
  const held = useUsableCount(RECOVERY);
  const recovery = useOnlineStore((state) => state.items?.limits?.teamRecovery);
  const left = recovery ? Math.max(0, recovery.perDay - recovery.usedToday) : 0;
  return (
    <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 max-md:gap-2 max-md:border-t-0 max-md:bg-transparent max-md:px-3 max-md:pb-3 max-md:pt-0 dark:border-navy-600 dark:bg-navy-800 dark:max-md:bg-transparent">
      <span className={`${LABEL} basis-full max-md:sr-only`}>{t("online.overview.prepare")}</span>
      <Link to="/online/squad" className={`${QUICK} ${LINEUP_ON_PHONE} flex-[1_1_150px]`}>
        <Shirt
          className={`${QUICK_ICON} max-md:text-white dark:max-md:text-white`}
          aria-hidden="true"
        />
        <span className="text-sm font-semibold max-md:font-heading max-md:text-base max-md:font-bold max-md:uppercase max-md:tracking-wider">
          {t("online.overview.toLineup")}
        </span>
      </Link>
      <Link to="/online/tactics" className={`${QUICK} flex-[1_1_150px] max-md:justify-center`}>
        <SlidersHorizontal className={QUICK_ICON} aria-hidden="true" />
        <span className="text-sm font-semibold">{t("online.nav.tactics")}</span>
      </Link>
      {held > 0 && recovery && (
        <button
          type="button"
          className={`${QUICK} flex-[1_1_150px] max-md:justify-center`}
          disabled={left === 0}
          onClick={() => onUse(RECOVERY)}
        >
          <HeartPulse className={QUICK_ICON} aria-hidden="true" />
          <span className="flex flex-col gap-px">
            <span className="text-sm font-semibold">{t("online.overview.recovery")}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {recovery.perDay === 0
                ? t("online.inventory.offThisSeason")
                : left === 0
                  ? t("online.overview.recoveryUsed")
                  : t("online.overview.recoveryLine", {
                      item: itemName(t, RECOVERY),
                      count: held,
                      left,
                    })}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
