import type { ReactNode } from "react";

export type ChipTone = "green" | "gold" | "blue" | "red" | "plain";

const TONE: Record<ChipTone, { chip: string; dot: string }> = {
  green: {
    chip: "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
    dot: "bg-primary-500 dark:bg-primary-400",
  },
  gold: {
    chip: "bg-accent-50 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
    dot: "bg-accent-500 dark:bg-accent-400",
  },
  blue: {
    chip: "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  red: {
    chip: "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    dot: "bg-red-500 dark:bg-red-400",
  },
  plain: {
    chip: "bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-300",
    dot: "bg-gray-400 dark:bg-gray-500",
  },
};

/** A small round label of a state (design m-su-kien.html), with a dot before it when asked. */
export default function PhoneChip({
  tone,
  dot = false,
  children,
}: {
  tone: ChipTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.25 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase leading-normal tracking-wider ${TONE[tone].chip}`}
    >
      {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} />}
      {children}
    </span>
  );
}
