import { useTranslation } from "react-i18next";
import { Ticket, Users } from "lucide-react";
import { formatCount, formatPermille } from "../../../lib/valueFormatting";
import type { AtmosphereView, VenueView } from "../../api";

/** Each atmosphere's colours (c-27 §7.2): grey, neutral, the pitch's green, gold. */
const ATMOSPHERE_TONE: Record<AtmosphereView, string> = {
  quiet: "bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-400",
  normal: "bg-gray-100 text-gray-800 dark:bg-navy-700 dark:text-gray-100",
  lively: "bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300",
  electric: "bg-accent-100 text-accent-800 dark:bg-accent-500/20 dark:text-accent-300",
};

/**
 * What the crowd sounded like (Dfac-3, AC-5): a word and a colour from the label alone, never a
 * number, a bar or an arrow, so it cannot be read as a measure of the home advantage.
 */
export function AtmosphereLabel({ atmosphere }: { atmosphere: AtmosphereView }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="atmosphere"
      className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${ATMOSPHERE_TONE[atmosphere]}`}
    >
      {t(`online.match.attendance.atmosphere.${atmosphere}`)}
    </span>
  );
}

/**
 * A league match's ground and crowd at kick-off (c-27 §7.2, C27-20): "<stadium> · <n> spectators"
 * on one line, the stadium's full name kept for a screen reader. Nothing for a friendly.
 */
export function VenueLine({
  venue,
  className = "",
}: {
  venue: VenueView | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!venue) return null;
  const text = t("online.match.attendance.line", {
    stadium: venue.stadiumName,
    count: formatCount(venue.attendance),
  });
  return (
    <p className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate" title={text}>
        {text}
      </span>
    </p>
  );
}

/**
 * The crowd of a league match played (c-27 §7.2, C27-20), at full time and on the fixture's page:
 * the crowd of the capacity and the ground, how full, sold out and the fans the server says were
 * left outside, and the atmosphere's word, or the fill in its place when the season shows none.
 */
export function VenueBlock({
  venue,
  atmosphere,
  className = "",
}: {
  venue: VenueView | null | undefined;
  atmosphere?: AtmosphereView;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!venue) return null;
  const fillPermille =
    venue.capacity > 0 ? Math.min(1000, Math.round((venue.attendance / venue.capacity) * 1000)) : 0;
  return (
    <section
      aria-labelledby="match-venue-title"
      className={`flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-navy-600 dark:bg-navy-800 ${className}`}
    >
      <h3
        id="match-venue-title"
        className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
      >
        <Users className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        {t("online.match.attendance.title")}
      </h3>
      <p className="truncate text-sm tabular-nums text-gray-800 dark:text-gray-100">
        {t("online.match.attendance.count", {
          attendance: formatCount(venue.attendance),
          capacity: formatCount(venue.capacity),
          stadium: venue.stadiumName,
        })}
      </p>
      <div
        role="img"
        aria-label={t("online.match.attendance.fill", { percent: formatPermille(fillPermille) })}
        className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
      >
        <span
          className={`block h-full rounded-full ${venue.soldOut ? "bg-accent-400" : "bg-primary-500 dark:bg-primary-400"}`}
          style={{ width: `${fillPermille / 10}%` }}
        />
      </div>
      {venue.soldOut && (
        <p className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-gray-300">
          <Ticket
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600 dark:text-accent-400"
            aria-hidden="true"
          />
          <span>
            <b className="text-accent-700 dark:text-accent-300">
              {t("online.match.attendance.soldOut")}
            </b>{" "}
            {t("online.match.attendance.lockedOut", { count: formatCount(venue.lockedOut) })}
          </span>
        </p>
      )}
      <p className="flex min-h-6 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        {atmosphere ? (
          <>
            {t("online.match.attendance.atmosphereLine")}
            <AtmosphereLabel atmosphere={atmosphere} />
          </>
        ) : (
          t("online.match.attendance.fill", { percent: formatPermille(fillPermille) })
        )}
      </p>
    </section>
  );
}
