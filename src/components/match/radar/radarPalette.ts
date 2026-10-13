/**
 * The radar's colours and fonts. A canvas cannot take Tailwind classes, so the
 * component renders one hidden swatch per entry below, carrying the token
 * classes, and the canvas reads the colour each swatch resolves to. The tokens
 * and their `dark:` partners stay in Tailwind; switching theme switches the
 * swatches, and the next read picks it up. No colour is written here.
 */

export const PALETTE_CLASSES = {
  surround: "text-primary-700 dark:text-primary-900",
  stripe: "text-white/5 dark:text-white/5",
  line: "text-white/60 dark:text-white/45",
  spot: "text-white/70 dark:text-white/55",
  goalFill: "text-white/25 dark:text-white/15",
  goalStroke: "text-white dark:text-gray-200",
  ball: "text-white dark:text-gray-100",
  ballStroke: "text-navy-900 dark:text-navy-900",
  shadow: "text-navy-900/35 dark:text-navy-900/50",
  ring: "text-white/85 dark:text-white/70",
  ringHighlight: "text-accent-400 dark:text-accent-300",
  homeFallback: "text-primary-500 dark:text-primary-400",
  awayFallback: "text-indigo-500 dark:text-indigo-400",
  numberOnLight: "text-navy-900 dark:text-navy-900",
  numberOnDark: "text-white dark:text-white",
  name: "text-white dark:text-white",
  nameOutline: "text-navy-900/80 dark:text-navy-900/90",
  trail: "text-white/40 dark:text-white/30",
  cut: "text-red-500 dark:text-red-400",
  whistle: "text-white/90 dark:text-white/80",
  yellowCard: "text-accent-400 dark:text-accent-400",
  yellowCardEdge: "text-accent-700 dark:text-accent-700",
  redCard: "text-red-600 dark:text-red-500",
  redCardEdge: "text-red-900 dark:text-red-900",
  injury: "text-red-600 dark:text-red-500",
  injuryMark: "text-white dark:text-white",
  banner: "text-navy-900/75 dark:text-navy-900/85",
  bannerText: "text-accent-400 dark:text-accent-400",
} as const;

export const FONT_CLASSES = {
  heading: "font-heading",
  body: "font-sans",
} as const;

export type RadarPalette = Record<keyof typeof PALETTE_CLASSES, string> &
  Record<`${keyof typeof FONT_CLASSES}Font`, string>;

/** The colours and fonts the swatches under `root` resolve to now. */
export function readPalette(root: HTMLElement | null): RadarPalette {
  const resolve = (selector: string, read: (style: CSSStyleDeclaration) => string) => {
    const swatch = root?.querySelector<HTMLElement>(selector);
    return swatch ? read(getComputedStyle(swatch)) : "";
  };
  const colours = Object.fromEntries(
    Object.keys(PALETTE_CLASSES).map((key) => [
      key,
      resolve(`[data-radar-colour="${key}"]`, (style) => style.color),
    ]),
  );
  const fonts = Object.fromEntries(
    Object.keys(FONT_CLASSES).map((key) => [
      `${key}Font`,
      resolve(`[data-radar-font="${key}"]`, (style) => style.fontFamily) || "sans-serif",
    ]),
  );
  return { ...colours, ...fonts } as RadarPalette;
}
