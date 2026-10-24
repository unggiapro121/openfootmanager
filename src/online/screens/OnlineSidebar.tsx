import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import {
  Calendar,
  Crosshair,
  Dumbbell,
  Globe2,
  Handshake,
  LayoutDashboard,
  LogOut,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import NavItem from "../../components/dashboard/SidebarNavItem";
import { useOnlineStore } from "../store/onlineStore";
import { useGuardedNavigate } from "./leaveGuard";

/** The club's pages, shown once the coach runs a club. */
const CLUB_PAGES = [
  { path: "/online/squad", label: "online.nav.squad", icon: <Users /> },
  { path: "/online/tactics", label: "online.nav.tactics", icon: <Crosshair /> },
  { path: "/online/training", label: "online.nav.training", icon: <Dumbbell /> },
  { path: "/online/league", label: "online.nav.league", icon: <Trophy /> },
  { path: "/online/schedule", label: "online.nav.schedule", icon: <Calendar /> },
  { path: "/online/friendly", label: "online.nav.friendly", icon: <Handshake /> },
];

/**
 * The online mode's sidebar (C-2 §3.1): the same entries as the dashboard's, its own pages. Each
 * way out asks first while the page holds the coach (their live match, C2-13).
 */
export default function OnlineSidebar() {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const { pathname } = useLocation();
  const clubName = useOnlineStore((state) => state.club?.club.name);
  const hasClub = clubName !== undefined;

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-navy-700 bg-navy-800 text-white">
      <div className="border-b border-navy-700 p-5">
        <div className="flex items-center gap-2">
          <Globe2 className="h-7 w-7 text-accent-400" aria-hidden="true" />
          <div>
            <p className="font-heading text-sm font-semibold uppercase tracking-wider text-white">
              {t("app.name")}
            </p>
            <p className="font-heading font-bold uppercase tracking-wider text-accent-400">
              {t("online.title")}
            </p>
          </div>
        </div>
        {clubName && <p className="mt-3 text-sm font-semibold text-primary-400">{clubName}</p>}
      </div>

      <nav aria-label={t("online.nav.label")} className="flex flex-1 flex-col gap-1 px-3 py-4">
        <NavItem
          icon={<LayoutDashboard />}
          label={t("online.nav.overview")}
          active={pathname === "/online" || pathname === "/online/takeover"}
          collapsed={false}
          onClick={() => navigate("/online")}
        />
        {hasClub && (
          <>
            <hr className="my-2 border-navy-700" />
            <p className="px-3 pb-1 pt-1 font-heading text-[10px] uppercase tracking-widest text-gray-500">
              {t("dashboard.sectionClub")}
            </p>
            {CLUB_PAGES.map((page) => (
              <NavItem
                key={page.path}
                icon={page.icon}
                label={t(page.label)}
                active={pathname === page.path}
                collapsed={false}
                onClick={() => navigate(page.path)}
              />
            ))}
            <hr className="my-2 border-navy-700" />
          </>
        )}
        <NavItem
          icon={<UserRound />}
          label={t("online.nav.profile")}
          active={pathname === "/online/profile"}
          collapsed={false}
          onClick={() => navigate("/online/profile")}
        />
      </nav>

      <div className="border-t border-navy-700 px-3 py-4">
        <NavItem
          icon={<LogOut />}
          label={t("online.nav.mainMenu")}
          collapsed={false}
          onClick={() => navigate("/")}
        />
      </div>
    </aside>
  );
}
