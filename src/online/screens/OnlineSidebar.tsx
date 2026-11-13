import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import { BrandSymbol, BrandWordmark } from "../../components/ui";
import { useOnlineStore } from "../store/onlineStore";
import ClubCrestMark from "./ClubCrestMark";
import { useGuardedNavigate } from "./leaveGuard";
import { useNavBadges } from "./navBadges";
import { buildsOverTime } from "./facilities/cardState";
import { clubGroups, isCurrent, type NavEntry, seasonText } from "./shellNav";

function SideEntry({
  entry,
  current,
  badge,
  onOpen,
}: {
  entry: NavEntry;
  current: boolean;
  badge?: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const label = t(entry.label);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={current ? "page" : undefined}
      aria-label={badge ? `${label} (${badge})` : label}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-heading text-sm uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
        current
          ? "bg-linear-to-r from-primary-500 to-primary-600 font-bold text-white shadow-md shadow-primary-500/20"
          : "font-semibold text-gray-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <entry.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="min-w-5 rounded-full bg-primary-500 px-2 py-0.5 text-center font-sans text-xs font-bold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-4 font-heading text-xs font-semibold uppercase tracking-widest text-gray-400">
      {children}
    </p>
  );
}

/** The brand: the shield-and-ball symbol beside the name, its last word in gold (design vi-coin.html). */
function Brand() {
  return (
    <p className="flex items-center gap-2.5 px-3 pb-5">
      <BrandSymbol className="h-10 w-10" />
      <BrandWordmark stacked onDark className="text-xl" />
    </p>
  );
}

/** The coach's club: its crest, its name, the season's day. */
function ClubCard() {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club?.club);
  const season = useOnlineStore((state) => state.season);
  if (!club) return null;
  return (
    <div className="mx-1 mb-3 flex items-center gap-3 rounded-xl border border-navy-600 bg-navy-700 p-3">
      <span className="h-10 w-10 shrink-0" aria-hidden="true">
        <ClubCrestMark profile={club} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-white">{club.name}</span>
        <span className="text-xs leading-snug text-gray-400">
          {t("online.header.clubLine", { season: seasonText(t, season) })}
        </span>
      </span>
    </div>
  );
}

/**
 * The online mode's sidebar (C-2 §3.1; design vi-coin.html): the brand, the coach's club, and
 * the club's pages by group. It stays dark in both themes, as the dashboard's does. Each way out
 * asks first while the page holds the coach (their live match, C2-13).
 */
export default function OnlineSidebar() {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const { pathname } = useLocation();
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  const builds = useOnlineStore((state) => buildsOverTime(state.facilities));
  const badgeOf = useNavBadges();

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-navy-800 px-3 pt-6 text-white">
      <Brand />
      <ClubCard />
      <nav
        aria-label={t("online.nav.label")}
        // min-h-0 lets the list shrink inside the screen-high panel and scroll
        // there; without it, a short window spills the entries below the panel.
        className="scrollbar-thin scrollbar-thumb-navy-600 scrollbar-track-transparent flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-6"
      >
        <SideEntry
          entry={{ path: "/online", label: "online.nav.overview", icon: LayoutDashboard }}
          current={isCurrent("/online", pathname)}
          onOpen={() => navigate("/online")}
        />
        {hasClub &&
          clubGroups(builds).map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <GroupLabel>{t(group.label)}</GroupLabel>
              {group.entries.map((entry) => (
                <SideEntry
                  key={entry.path}
                  entry={entry}
                  current={isCurrent(entry.path, pathname)}
                  badge={badgeOf(entry.path) || undefined}
                  onOpen={() => navigate(entry.path)}
                />
              ))}
            </div>
          ))}
      </nav>
    </aside>
  );
}
