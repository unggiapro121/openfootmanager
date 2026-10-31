import { useTranslation } from "react-i18next";

/** The five panels of the ball, from the pentagon's corners to the rim (design LogoESBall). */
const SEAMS = [
  "M50 36.9 L50 23",
  "M59.6 43.9 L72.8 39.6",
  "M55.9 55.2 L64.1 66.4",
  "M44.1 55.2 L35.9 66.4",
  "M40.4 43.9 L27.2 39.6",
] as const;

/**
 * The Eleven Saga symbol, a ball on a shield (design "Logo Eleven Saga – Khiên bóng"): a navy
 * shield outlined in gold, a gold ball with navy panels, a gold bar under it. The colours are the
 * brand's own in both themes, so it reads the same on navy and on white. Decorative unless
 * `label` names it.
 */
export function BrandSymbol({ className = "", label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M50 5 L89 17 V47 C89 72 72 88 50 96 C28 88 11 72 11 47 V17 Z"
        className="fill-navy-900 stroke-accent-400"
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <circle
        cx={50}
        cy={47}
        r={24}
        className="fill-accent-400 stroke-navy-900"
        strokeWidth={1.9}
      />
      <polygon points="50,36.9 59.6,43.9 55.9,55.2 44.1,55.2 40.4,43.9" className="fill-navy-900" />
      {SEAMS.map((seam) => (
        <path
          key={seam}
          d={seam}
          className="stroke-navy-900"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      ))}
      <path d="M38 80 H62" className="stroke-accent-400" strokeWidth={4} strokeLinecap="round" />
    </svg>
  );
}

/**
 * The name as the brand writes it: "Eleven" in the text colour, "Saga" in gold. `onDark` keeps
 * the dark-background colours in both themes, for surfaces that stay navy (the sidebars);
 * `stacked` puts "Saga" under "Eleven", as the sidebars do.
 */
export function BrandWordmark({
  className = "",
  onDark = false,
  stacked = false,
}: {
  className?: string;
  onDark?: boolean;
  stacked?: boolean;
}) {
  const { t } = useTranslation();
  const [first, ...rest] = t("app.name").split(" ");
  return (
    <span
      className={`font-heading font-bold uppercase leading-[0.95] tracking-[0.06em] whitespace-nowrap ${
        stacked ? "flex flex-col gap-0.5" : ""
      } ${className}`}
    >
      <span className={onDark ? "text-white" : "text-navy-900 dark:text-white"}>{first}</span>
      {rest.length > 0 && (
        <>
          {/* Inside a stacked (flex) name the space shows nothing but keeps "Eleven Saga" read as two words. */}{" "}
          <span className={onDark ? "text-accent-400" : "text-accent-700 dark:text-accent-400"}>
            {rest.join(" ")}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * The symbol with the name, side by side or stacked, and the tagline under the name when asked
 * (design "Logo Eleven Saga – Khiên bóng": horizontal and vertical lockups).
 */
export function BrandLockup({
  layout = "horizontal",
  tagline = false,
  onDark = false,
  symbolClassName,
  nameClassName,
}: {
  layout?: "horizontal" | "vertical";
  tagline?: boolean;
  onDark?: boolean;
  symbolClassName: string;
  nameClassName: string;
}) {
  const { t } = useTranslation();
  const vertical = layout === "vertical";
  return (
    <span
      className={`flex ${vertical ? "flex-col items-center gap-3 text-center" : "items-center gap-3"}`}
    >
      <BrandSymbol className={symbolClassName} />
      <span className={`flex flex-col gap-1.5 ${vertical ? "items-center" : ""}`}>
        <BrandWordmark className={nameClassName} onDark={onDark} />
        {tagline && (
          <span
            className={`text-sm ${onDark ? "text-gray-400" : "text-gray-600 dark:text-gray-400"}`}
          >
            {t("app.tagline")}
          </span>
        )}
      </span>
    </span>
  );
}
