import { useTranslation } from "react-i18next";
import { formatCount } from "../../../../lib/valueFormatting";
import type { ClubProfileView } from "../../../api";
import { useClubArt } from "./ClubArt";
import { stadiumStyleOf } from "./stadiumStyle";

/**
 * A club's stadium in that club's colours (c-27 §5.8, R49-8), for its public page and the
 * overview's club card: the style its stands' level reaches, its name on one line and its seats.
 * Nothing for a club whose season does not build its stands over time (no `standsLevel`); never
 * money or another building's level. `caption` false leaves the words to a card that has them.
 */
export function StadiumPicture({
  profile,
  caption = true,
  className = "",
}: {
  profile: ClubProfileView;
  caption?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const level = profile.standsLevel;
  const url = useClubArt(level === undefined ? null : stadiumStyleOf(level), profile);
  if (level === undefined) return null;
  const seats = t("online.club.seats", { capacity: formatCount(profile.stadiumCapacity) });
  return (
    <figure
      aria-label={t("online.club.stadiumPicture", {
        name: profile.stadiumName,
        capacity: formatCount(profile.stadiumCapacity),
      })}
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <div className="aspect-[16/10] overflow-hidden rounded-lg bg-gray-100 dark:bg-navy-900">
        {url && <img src={url} alt="" className="h-full w-full object-contain" draggable={false} />}
      </div>
      {caption && (
        <figcaption className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="truncate font-semibold text-gray-900 dark:text-gray-100">
            {profile.stadiumName}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
            · {seats}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
