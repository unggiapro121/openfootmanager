import { useTranslation } from "react-i18next";
import type { JSX } from "react";
import {
  Users,
  Calendar as CalendarIcon,
  Mail,
  Settings,
  LayoutDashboard,
  Medal,
  Trophy,
  TrendingUp,
  Globe,
  Crosshair,
  Dumbbell,
  DollarSign,
  Eye,
  UsersRound,
  UserCheck,
  Building2,
  UserCog,
  Newspaper,
  LogOut,
  GraduationCap,
  PanelLeftClose,
  PanelLeftOpen,
  User,
} from "lucide-react";
import { BrandSymbol, BrandWordmark } from "../ui";
import NavItem from "./SidebarNavItem";

interface DashboardSidebarProps {
  activeTab: string;
  collapsed: boolean;
  onNavClick: (tab: string) => void;
  onToggleCollapse: () => void;
  unreadMessagesCount: number;
  todayHasMatch?: boolean;
  managerName: string | null;
  teamName: string | null;
  onNavigateSettings: () => void;
  onExitClick: () => void;
  isUnemployed: boolean;
}

export default function DashboardSidebar({
  activeTab,
  collapsed,
  onNavClick,
  onToggleCollapse,
  unreadMessagesCount,
  todayHasMatch,
  managerName,
  teamName,
  onNavigateSettings,
  onExitClick,
  isUnemployed,
}: DashboardSidebarProps): JSX.Element {
  const { t } = useTranslation();
  const appName = t("app.name");

  const clubItems: Array<{ icon: JSX.Element; label: string; tab: string }> = [
    { icon: <Users />, label: t("dashboard.squad"), tab: "Squad" },
    { icon: <Crosshair />, label: t("dashboard.tactics"), tab: "Tactics" },
    { icon: <Dumbbell />, label: t("dashboard.training"), tab: "Training" },
    { icon: <UserCog />, label: t("dashboard.staff"), tab: "Staff" },
    { icon: <Eye />, label: t("dashboard.scouting"), tab: "Scouting" },
    {
      icon: <GraduationCap />,
      label: t("dashboard.youthAcademy"),
      tab: "Youth",
    },
    { icon: <DollarSign />, label: t("dashboard.finances"), tab: "Finances" },
    { icon: <TrendingUp />, label: t("dashboard.transfers"), tab: "Transfers" },
  ];
  const worldItems: Array<{ icon: JSX.Element; label: string; tab: string }> = [
    { icon: <Globe />, label: t("transfers.centre"), tab: "TransferCentre" },
    { icon: <Medal />, label: t("dashboard.hallOfFame"), tab: "HallOfFame" },
    { icon: <UsersRound />, label: t("dashboard.players"), tab: "Players" },
    { icon: <UserCheck />, label: t("dashboard.managers"), tab: "Managers" },
    { icon: <Building2 />, label: t("dashboard.teams"), tab: "Teams" },
    {
      icon: <Trophy />,
      label: t("dashboard.tournaments"),
      tab: "Tournaments",
    },
  ];
  const toggleSidebarLabel = collapsed
    ? t("dashboard.expandSidebar")
    : t("dashboard.collapseSidebar");

  return (
    <aside
      className={`bg-navy-800 dark:bg-navy-800 border-r border-navy-700 text-white flex h-screen sticky top-0 shrink-0 flex-col transition-[width] duration-200 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Brand */}
      <div className={`border-b border-navy-700 ${collapsed ? "px-3 py-4" : "p-5"}`}>
        <div
          className={`flex ${collapsed ? "flex-col items-center gap-3" : "items-center justify-between gap-3"}`}
        >
          <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2.5"}`}>
            <BrandSymbol className="h-9 w-9" label={collapsed ? appName : undefined} />
            {collapsed ? null : (
              <h1>
                <BrandWordmark stacked onDark className="text-lg" />
              </h1>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            title={toggleSidebarLabel}
            aria-label={toggleSidebarLabel}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onNavClick("Manager")}
          title={collapsed ? t("dashboard.manager") : undefined}
          aria-label={t("dashboard.manager")}
          className={`hover:bg-white/5 mt-3 w-full rounded-lg transition-colors hover:cursor-pointer ${
            collapsed
              ? "flex justify-center px-0 py-2 text-gray-300"
              : "-mx-1 border-t border-navy-700 px-1 py-1 pt-3 text-left"
          }`}
        >
          {collapsed ? (
            <User className="h-5 w-5" />
          ) : (
            <>
              <p className="text-xs text-gray-400 uppercase tracking-wider">
                {t("dashboard.manager")}
              </p>
              <p className="text-sm font-semibold text-white mt-0.5">{managerName}</p>
              {teamName && <p className="text-xs text-primary-400 mt-0.5">{teamName}</p>}
            </>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav
        className={`scrollbar-thin scrollbar-thumb-navy-600 scrollbar-track-transparent flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <NavItem
          icon={<LayoutDashboard />}
          label={t("dashboard.home")}
          badge={undefined}
          active={activeTab === "Home"}
          collapsed={collapsed}
          onClick={() => onNavClick("Home")}
        />
        <NavItem
          icon={<Mail />}
          label={t("dashboard.inbox")}
          badge={unreadMessagesCount > 0 ? unreadMessagesCount : undefined}
          active={activeTab === "Inbox"}
          collapsed={collapsed}
          onClick={() => onNavClick("Inbox")}
        />
        <NavItem
          icon={<Newspaper />}
          label={t("dashboard.news")}
          active={activeTab === "News"}
          collapsed={collapsed}
          onClick={() => onNavClick("News")}
        />
        <NavItem
          icon={<CalendarIcon />}
          label={t("dashboard.schedule")}
          badge={todayHasMatch ? "!" : undefined}
          active={activeTab === "Schedule"}
          collapsed={collapsed}
          onClick={() => onNavClick("Schedule")}
        />

        {!isUnemployed && (
          <>
            <hr className="my-2 border-navy-700" />
            {collapsed ? null : (
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-heading px-3 pt-1 pb-1">
                {t("dashboard.sectionClub")}
              </p>
            )}
            {clubItems.map((item) => (
              <NavItem
                key={item.tab}
                icon={item.icon}
                label={item.label}
                active={activeTab === item.tab}
                collapsed={collapsed}
                onClick={() => onNavClick(item.tab)}
              />
            ))}
          </>
        )}

        <hr className="my-2 border-navy-700" />
        {collapsed ? null : (
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-heading px-3 pt-1 pb-1">
            {t("dashboard.sectionWorld")}
          </p>
        )}
        {worldItems.map((item) => (
          <NavItem
            key={item.tab}
            icon={item.icon}
            label={item.label}
            active={activeTab === item.tab}
            collapsed={collapsed}
            onClick={() => onNavClick(item.tab)}
          />
        ))}
      </nav>

      {/* Settings & Exit */}
      <div className={`border-t border-navy-700 flex flex-col gap-1 ${collapsed ? "p-2" : "p-3"}`}>
        <button
          type="button"
          onClick={onNavigateSettings}
          title={collapsed ? t("dashboard.settings") : undefined}
          aria-label={t("dashboard.settings")}
          className={`w-full rounded-lg p-3 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300 ${
            collapsed ? "flex items-center justify-center" : "flex items-center gap-3"
          }`}
        >
          <Settings className="w-5 h-5" />
          {collapsed ? null : (
            <span className="font-heading text-sm uppercase tracking-wider">
              {t("dashboard.settings")}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onExitClick}
          title={collapsed ? t("dashboard.exitToMenu") : undefined}
          aria-label={t("dashboard.exitToMenu")}
          className={`w-full rounded-lg p-3 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400 ${
            collapsed ? "flex items-center justify-center" : "flex items-center gap-3"
          }`}
        >
          <LogOut className="w-5 h-5" />
          {collapsed ? null : (
            <span className="font-heading text-sm uppercase tracking-wider">
              {t("dashboard.exitToMenu")}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
