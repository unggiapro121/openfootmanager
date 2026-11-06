import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronLeft, EllipsisVertical, Shield, Zap } from "lucide-react";
import { formatPlayerPhysique } from "../../../components/playerProfile/PlayerProfile.helpers";
import { WeakFootRating } from "../../../components/playerProfile/PlayerProfileHeroCard";
import PlayerProfileInjuryBanner from "../../../components/playerProfile/PlayerProfileInjuryBanner";
import { CountryFlag, PlayerAvatar } from "../../../components/ui";
import { countryName } from "../../../lib/countries";
import type { MyClubView, SquadPlayerView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import QuickUseChoices from "../items/QuickUseChoices";
import { PhoneHeaderPart } from "../mobile/PhoneHeaderSlots";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";
import PotentialStars from "../PotentialStars";
import HealAction from "./HealAction";
import { PlayerActions } from "./PhoneSquadActions";
import { PositionTag } from "./PhoneSquadParts";
import { KEY, SeasonTab, StatsTab, TraitsTab, valueTone } from "./PhonePlayerTabs";
import { avatarOf } from "./playerLook";
import { KeeperDrillBadge } from "../training/KeeperDrillBadge";
import { trainsKeeperDrill } from "../training/keeperDrill";

type Tab = "stats" | "traits" | "season";
const TABS: Tab[] = ["stats", "traits", "season"];

/**
 * One of the club's players on a phone (design m-cau-thu): the head card (who he is, his feet and
 * build), his condition, fitness and morale with the way to recover him, then his attributes, his
 * traits and his season on three tabs. What can be done with him sits behind the app bar's menu.
 */
export default function PhonePlayer({
  player,
  club,
}: {
  player: SquadPlayerView;
  club: MyClubView;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("stats");
  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <PhoneHeaderPart place="actions">
        <PlayerActions
          player={player}
          trigger={(open) => (
            <button
              type="button"
              aria-label={t(`${KEY}.manage`)}
              aria-haspopup="dialog"
              onClick={open}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-gray-700 dark:text-gray-200 ${FOCUS}`}
            >
              <EllipsisVertical className="h-5.5 w-5.5" aria-hidden="true" />
            </button>
          )}
        />
      </PhoneHeaderPart>
      <PhoneHeaderPart place="below">
        <div className="flex items-center border-t border-gray-200 pl-1 pr-2 dark:border-navy-700">
          <Link
            to="/online/squad"
            className={`flex h-11 items-center gap-0.5 rounded-full pl-1 pr-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 ${FOCUS}`}
          >
            <ChevronLeft className="h-5.5 w-5.5" aria-hidden="true" />
            {t("online.nav.squad")}
          </Link>
        </div>
      </PhoneHeaderPart>

      <div className="flex flex-col gap-2.5 px-4 pt-3">
        <Hero player={player} club={club} />
        {player.injury && (
          <PlayerProfileInjuryBanner
            injury={{ name: player.injury.name, days_remaining: player.injury.daysRemaining }}
            t={t}
            action={<HealAction player={player} />}
          />
        )}
        {player.suspendedMatches !== undefined && (
          <p
            role="status"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            {t("online.squad.suspended", { count: player.suspendedMatches })}
          </p>
        )}
        <Condition player={player} />
      </div>

      <div
        role="tablist"
        aria-label={t(`${KEY}.tabs`)}
        className="mt-3 grid grid-cols-3 border-b border-gray-200 px-4 dark:border-navy-700"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px h-11 border-b-2 font-heading text-[15px] font-bold uppercase tracking-wider ${tab === id ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
          >
            {t(`${KEY}.tab.${id}`)}
          </button>
        ))}
      </div>
      <main className="px-4 pb-6 pt-3">
        {tab === "stats" && <StatsTab player={player} />}
        {tab === "traits" && <TraitsTab traits={player.traits} />}
        {tab === "season" && <SeasonTab season={player.season} />}
      </main>
    </div>
  );
}

/** The head card: face and shirt, name, position, nation and age, club and place, potential, OVR. */
function Hero({ player, club }: { player: SquadPlayerView; club: MyClubView }) {
  const { t, i18n } = useTranslation();
  const pictures = useOnlineStore((state) => state.playerPictures);
  const starter = club.setup.startingXiIds.includes(player.id);
  const facts = [
    { label: t("common.footednessLabel"), value: t(`common.footedness.${player.footedness}`) },
    { label: t("common.weakFoot"), value: <WeakFootRating value={player.weakFoot} /> },
    {
      label: t("common.height"),
      value: formatPlayerPhysique(player.heightCm, "centimeter", i18n.language),
    },
    {
      label: t("common.weight"),
      value: formatPlayerPhysique(player.weightKg, "kilogram", i18n.language),
    },
  ];
  return (
    <section
      aria-labelledby="phone-player-name"
      className="flex flex-col gap-3.5 rounded-[18px] border border-gray-200 bg-linear-to-br from-accent-50 to-white p-3.5 pt-4 dark:border-navy-700 dark:from-accent-900/30 dark:to-navy-800"
    >
      <div className="flex items-start gap-3.5">
        <div className="relative shrink-0">
          <PlayerAvatar
            player={avatarOf(player, pictures)}
            className="flex h-[100px] w-[84px] items-center justify-center overflow-hidden rounded-2xl border-2 border-accent-500 bg-accent-800 font-heading text-[32px] font-bold text-white"
          />
          {player.shirtNumber !== undefined && (
            <span
              role="img"
              aria-label={t(`${KEY}.shirt`, { number: player.shirtNumber })}
              className="absolute -bottom-2 -right-2 flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border-2 border-white bg-rose-700 font-heading text-lg font-bold text-white dark:border-navy-800"
            >
              {player.shirtNumber}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2
            id="phone-player-name"
            className="font-heading text-[26px] font-bold uppercase leading-none tracking-wide text-gray-900 dark:text-white"
          >
            {player.fullName}
          </h2>
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-gray-600 dark:text-gray-300">
            <PositionTag position={player.naturalPosition} />
            {trainsKeeperDrill(
              player.naturalPosition || player.position,
              club.trainingDay?.keeperDrill,
            ) && <KeeperDrillBadge />}
            <CountryFlag
              code={player.nationality}
              locale={i18n.language}
              className="text-sm leading-none"
            />
            <span>{countryName(player.nationality, i18n.language)}</span>
            <span aria-hidden="true">·</span>
            <span>{t(`${KEY}.age`, { age: player.age })}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            {club.club.name} ·{" "}
            <span className={starter ? "text-primary-700 dark:text-primary-400" : ""}>
              {t(starter ? "squad.starter" : "squad.benchOption")}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <PotentialStars stars={player.potentialStars} />
            {t("online.squad.potential")}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-center rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 dark:border-navy-700 dark:bg-navy-900">
          <span className="text-[10px] tracking-widest text-gray-500 dark:text-gray-400">
            {t("common.ovr")}
          </span>
          <span className="font-heading text-[38px] font-bold leading-none text-accent-600 dark:text-accent-400">
            {player.ovr}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-4 gap-1.5">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="rounded-[10px] bg-white/70 px-1.5 py-2 text-center dark:bg-navy-900/60"
          >
            <dt className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">
              {fact.label}
            </dt>
            <dd className="mt-1 flex justify-center text-sm font-bold text-gray-900 dark:text-white">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The items that bring his condition back; an injury is healed from its banner (HealAction). */
function recoveryCodes(player: SquadPlayerView): string[] {
  return player.injury ? [] : ["energyDrinkSmall", "energyDrinkLarge"];
}

/** Condition, fitness and morale as three meters, and the way to recover him with an item. */
function Condition({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const items = useOnlineStore((state) => state.items);
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const usable = items?.limits && !items.locked ? items : null;
  const held = usable
    ? recoveryCodes(player)
        .map((code) => ({
          code,
          total: usable.lines.find((line) => line.itemCode === code)?.total ?? 0,
        }))
        .filter((entry) => entry.total > 0)
    : [];
  const count = held.reduce((sum, entry) => sum + entry.total, 0);
  const full = !player.injury && player.condition >= 100;
  const meters = [
    { label: t("common.condition"), value: player.condition },
    { label: t("online.squad.fitness"), value: player.fitness },
    { label: t("common.morale"), value: player.morale },
  ];
  return (
    <section
      aria-label={t("online.squad.state")}
      className="flex flex-col gap-2.5 rounded-[14px] border border-gray-200 bg-white px-3.5 py-3 dark:border-navy-700 dark:bg-navy-800"
    >
      <div className="grid grid-cols-3 gap-3">
        {meters.map((meter) => {
          const tone = valueTone(meter.value);
          return (
            <div key={meter.label} className="flex flex-col gap-1.5">
              <span className="flex justify-between gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                <span className="leading-tight">{meter.label}</span>
                <strong className={`tabular-nums ${tone.text}`}>{meter.value}%</strong>
              </span>
              <span
                role="meter"
                aria-label={meter.label}
                aria-valuenow={meter.value}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
              >
                <span className={`block h-full ${tone.bar}`} style={{ width: `${meter.value}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      {(count > 0 || full) && (
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={full}
          onClick={() => {
            setDone(null);
            setSheet(true);
          }}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border text-[13px] font-semibold disabled:border-gray-200 disabled:text-gray-500 dark:disabled:border-navy-700 dark:disabled:text-gray-400 border-primary-300 text-primary-700 dark:border-primary-800 dark:text-primary-300 ${FOCUS}`}
        >
          <Zap className="h-4 w-4" aria-hidden="true" />
          {full ? t(`${KEY}.full`) : t(`${KEY}.boost`, { count })}
        </button>
      )}
      {done && (
        <p role="status" className="text-xs text-primary-700 dark:text-primary-400">
          {done}
        </p>
      )}
      {sheet && (
        <PhoneSheet
          title={t(`${KEY}.boostTitle`)}
          aside={t(`${KEY}.now`, { value: player.condition })}
          onClose={() => setSheet(false)}
        >
          <QuickUseChoices
            codes={recoveryCodes(player)}
            player={player}
            onUsed={(text) => {
              setSheet(false);
              setDone(text);
            }}
          >
            <Link
              to="/online/shop"
              className={`flex min-h-10 items-center justify-center rounded text-[13px] font-semibold text-primary-700 dark:text-primary-400 ${FOCUS}`}
            >
              {t(`${KEY}.shop`)}
            </Link>
          </QuickUseChoices>
        </PhoneSheet>
      )}
    </section>
  );
}
