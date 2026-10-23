import type { JSX, ReactNode } from "react";

/** One entry of a game sidebar: the dashboard's, and the online mode's (C-2). */
interface NavItemProps {
  active?: boolean;
  badge?: number | string;
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}

export default function NavItem({
  active,
  badge,
  collapsed,
  icon,
  label,
  onClick,
}: NavItemProps): JSX.Element {
  const buttonClassName = collapsed
    ? `relative flex w-full items-center justify-center rounded-lg p-3 transition-all duration-200 ${
        active
          ? "bg-linear-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/20"
          : "text-gray-400 hover:bg-white/5 hover:text-white"
      }`
    : `relative flex w-full items-center justify-between rounded-lg p-3 transition-all duration-200 ${
        active
          ? "bg-linear-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/20"
          : "text-gray-400 hover:bg-white/5 hover:text-white"
      }`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={
        badge !== undefined && badge !== 0 && badge !== "" ? `${label} (${badge})` : label
      }
      className={buttonClassName}
    >
      <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
        <div className="[&>svg]:w-5 [&>svg]:h-5">{icon}</div>
        {collapsed ? null : (
          <span className="font-heading font-semibold text-sm uppercase tracking-wider">
            {label}
          </span>
        )}
      </div>
      {badge !== undefined && badge !== 0 && badge !== "" && (
        <span
          className={
            collapsed
              ? "absolute right-1.5 top-1.5 min-w-[1.1rem] rounded-full bg-primary-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white"
              : "min-w-5 rounded-full bg-primary-500 px-2 py-0.5 text-center text-xs font-bold text-white"
          }
        >
          {badge}
        </span>
      )}
    </button>
  );
}
