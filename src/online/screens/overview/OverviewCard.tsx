import { type ReactNode, useId } from "react";
import { Link } from "react-router-dom";

/** The top edge a card is marked with (design tong-quan.html): the next match green, the licence gold. */
const EDGE = {
  none: "",
  primary: "border-t-4 border-t-primary-500 dark:border-t-primary-500",
  accent: "border-t-4 border-t-accent-400 dark:border-t-accent-400",
};

/**
 * One card of the overview (design tong-quan.html): a section named by its title, with what sits
 * at the head's right (a badge, a link, a button) and its body below.
 */
export default function OverviewCard({
  title,
  action,
  edge = "none",
  className = "",
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  edge?: keyof typeof EDGE;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border max-md:flex-none border-gray-200 bg-white shadow-sm dark:border-navy-600 dark:bg-navy-700 dark:shadow-md ${EDGE[edge]} ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-3.5 max-md:gap-2 max-md:px-4 max-md:py-3 dark:border-navy-600">
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 max-md:text-base dark:text-gray-100"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A small uppercase badge of a card's head. */
export function CardBadge({
  tone,
  children,
}: {
  tone: "green" | "gold" | "red" | "plain";
  children: ReactNode;
}) {
  const colours = {
    green: "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
    gold: "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
    red: "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    plain: "bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-300",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-heading text-xs font-semibold uppercase tracking-wider ${colours}`}
    >
      {children}
    </span>
  );
}

/** The link at a card head's right: the full table, the whole schedule, the profile. */
export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded text-xs font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:hover:text-primary-300 dark:focus:ring-offset-navy-800"
    >
      {children}
    </Link>
  );
}

/** A small uppercase label over a figure or a group. */
export const LABEL =
  "font-heading text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400";
