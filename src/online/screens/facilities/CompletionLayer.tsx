import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import type { FacilitiesView, FacilityCompletedView } from "../../api";
import { ClubArt } from "./art/ClubArt";
import { stadiumStyleOf } from "./art/stadiumStyle";
import { FacilityEffects } from "./FacilityEffects";
import { cardArt, facilityName, styleName } from "./facilityText";

/** The confetti's colours, as token classes in both themes. */
const PIECE_COLOURS = [
  "bg-accent-400",
  "bg-primary-500",
  "bg-white dark:bg-gray-100",
  "bg-red-500",
];
const PIECES = 24;

/**
 * "Construction complete" (c-27 §5.6, T7): what the build made, over the page, once per
 * completion and for every facility, a speed-up's included. The stands show their style before
 * and after; another facility its picture and what it does now. Confetti falls once unless the
 * player asked for less motion. A press outside, Escape or "Great!" closes it.
 */
export function CompletionLayer({
  done,
  view,
  onClose,
}: {
  done: FacilityCompletedView;
  view: FacilitiesView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const item = view.items?.find((entry) => entry.facility === done.facility);
  const name = facilityName(t, done.facility);
  const stands = done.facility === "stands";
  const styleChanged = stands && stadiumStyleOf(done.level - 1) !== stadiumStyleOf(done.level);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-navy-900/70 motion-safe:animate-dim-in"
        onClick={onClose}
      />
      {!reduced && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden"
          aria-hidden="true"
          data-testid="confetti"
        >
          {Array.from({ length: PIECES }, (_, index) => (
            <i
              key={index}
              className={`absolute top-16 block h-3 w-2 animate-confetti-fall rounded-sm ${PIECE_COLOURS[index % PIECE_COLOURS.length]}`}
              style={{ left: `${(index * 41) % 100}%`, animationDelay: `${(index % 8) * 0.12}s` }}
            />
          ))}
        </div>
      )}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="relative flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white p-6 text-center shadow-2xl focus:outline-none dark:bg-navy-800"
      >
        <span className="font-heading text-xs font-bold uppercase tracking-wider text-accent-700 dark:text-accent-300">
          {t("online.facilities.completion.kicker")}
        </span>
        <h2
          id={titleId}
          className="font-heading text-2xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("online.facilities.completion.title", { facility: name, level: done.level })}
        </h2>
        {styleChanged ? (
          <div className="grid w-full grid-cols-2 gap-3">
            <figure className="space-y-1">
              <figcaption className="text-xs text-gray-500 dark:text-gray-400">
                {t("online.facilities.before")}
              </figcaption>
              <ClubArt
                art={stadiumStyleOf(done.level - 1)}
                className="aspect-[4/3] w-full rounded-lg"
              />
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {styleName(t, done.level - 1)}
              </span>
            </figure>
            <figure className="space-y-1">
              <figcaption className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                {t("online.facilities.after")}
              </figcaption>
              <ClubArt
                art={stadiumStyleOf(done.level)}
                className="aspect-[4/3] w-full rounded-lg"
              />
              <b className="text-xs text-gray-900 dark:text-gray-100">{styleName(t, done.level)}</b>
            </figure>
          </div>
        ) : (
          <ClubArt art={cardArt(done)} className="aspect-[4/3] w-48 rounded-lg" />
        )}
        {stands && view.capacity !== undefined && (
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {t("online.facilities.completion.capacity", {
              stadium: view.stadiumName ?? "",
              capacity: view.capacity.toLocaleString(),
              style: styleName(t, done.level),
            })}
          </p>
        )}
        {!stands && item && item.effects.length > 0 && (
          <div className="w-full text-left">
            <FacilityEffects effects={item.effects} compact />
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 w-full rounded-lg bg-accent-400 px-4 font-heading font-bold uppercase tracking-wider text-navy-900 hover:bg-accent-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
        >
          {t("online.facilities.completion.great")}
        </button>
      </div>
    </div>
  );
}
