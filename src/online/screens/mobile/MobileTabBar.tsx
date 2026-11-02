import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Ellipsis, LayoutGrid, type LucideIcon, Shield, Trophy, Users } from "lucide-react";
import { claimsWaiting, useOnlineStore } from "../../store/onlineStore";
import { useGuardedNavigate } from "../leaveGuard";
import { CLUB_GROUPS, MORE_GROUP, type NavGroup, type NavGroupId, navGroupOf } from "../shellNav";
import MobileNavSheet from "./MobileNavSheet";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500";

const GROUP_ICON: Record<NavGroupId, LucideIcon> = {
  team: Users,
  matches: Trophy,
  club: Shield,
  more: Ellipsis,
};

function Tab({
  label,
  icon: Icon,
  current,
  expanded,
  badge,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  current: boolean;
  /** Whether the tab opens a sheet, and the sheet is open; undefined for the overview. */
  expanded?: boolean;
  badge?: number;
  onPress: () => void;
}) {
  const lit = current || expanded === true;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-current={current ? "page" : undefined}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      aria-expanded={expanded}
      aria-label={badge ? `${label} (${badge})` : label}
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 pt-1 text-xs font-semibold ${FOCUS} ${
        lit ? "text-primary-600 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"
      }`}
    >
      <span
        className={`absolute inset-x-5 top-0 h-0.5 rounded-full ${lit ? "bg-primary-500 dark:bg-primary-400" : "bg-transparent"}`}
        aria-hidden="true"
      />
      <span className="relative" aria-hidden="true">
        <Icon className="h-5.5 w-5.5" />
        {badge ? (
          <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500 dark:border-navy-800" />
        ) : null}
      </span>
      <span aria-hidden="true">{label}</span>
    </button>
  );
}

/**
 * A phone's tab bar (design m-tong-quan.html): Overview opens the overview; Team, Matches, Club
 * and More each open their pages in a sheet. The tab of the page open now is lit, and a dot
 * marks a group with something waiting (an academy report, market news, a reward to claim).
 */
export default function MobileTabBar() {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const { pathname } = useLocation();
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  const marketUnseen = useOnlineStore((state) => state.marketUnseen);
  const academyUnseen = useOnlineStore((state) => state.academyUnseen);
  const claims = useOnlineStore((state) => claimsWaiting(state.events));
  const [open, setOpen] = useState<NavGroup | null>(null);
  const currentGroup = navGroupOf(pathname);

  const groups = hasClub ? [...CLUB_GROUPS, MORE_GROUP] : [MORE_GROUP];
  const badgeOf: Record<NavGroupId, number> = {
    team: academyUnseen ? 1 : 0,
    matches: 0,
    club: marketUnseen,
    more: claims,
  };

  return (
    <>
      <nav
        aria-label={t("online.nav.tabs")}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-navy-700 dark:bg-navy-800/95"
      >
        <Tab
          label={t("online.nav.overview")}
          icon={LayoutGrid}
          current={currentGroup === "overview" && open === null}
          onPress={() => {
            setOpen(null);
            navigate("/online");
          }}
        />
        {groups.map((group) => (
          <Tab
            key={group.id}
            label={t(group.label)}
            icon={GROUP_ICON[group.id]}
            current={currentGroup === group.id && open === null}
            expanded={open?.id === group.id}
            badge={badgeOf[group.id] || undefined}
            onPress={() => setOpen((was) => (was?.id === group.id ? null : group))}
          />
        ))}
      </nav>
      {open && <MobileNavSheet group={open} onClose={() => setOpen(null)} />}
    </>
  );
}
