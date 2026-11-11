import type { KeyboardEvent } from "react";

/**
 * A tab's place in the Tab order (ARIA tabs pattern, P5-5): only the chosen tab is reached with
 * Tab, and the arrow keys move between the others.
 */
export function tabIndexOf(selected: boolean): 0 | -1 {
  return selected ? 0 : -1;
}

/** The enabled tabs of `list` itself, in order, leaving out those of a tablist inside it. */
function tabsOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
    (tab) => tab.closest('[role="tablist"]') === list && !tab.hasAttribute("disabled"),
  );
}

function targetIndex(key: string, from: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The keyboard of a tablist (ARIA tabs pattern, P5-5), set as the tablist's `onKeyDown`: ← and →
 * move to the previous or next tab, wrapping at either end; Home and End to the first or last.
 * The tab reached takes focus and is chosen, as a tap would choose it.
 */
export function onTablistKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const tabs = tabsOf(event.currentTarget);
  const from = tabs.findIndex((tab) => tab === (event.target as Element).closest('[role="tab"]'));
  if (from < 0) return;
  const to = targetIndex(event.key, from, tabs.length);
  if (to === null) return;
  event.preventDefault();
  const next = tabs[to];
  next.focus();
  if (to !== from) next.click();
}
