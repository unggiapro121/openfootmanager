import { useEffect, useState } from "react";
import type { ClubProfileView } from "../../../api";
import { useOnlineStore } from "../../../store/onlineStore";
import { artUrls } from "./artFiles";
import type { ArtKey } from "./artKeys";
import { clubArtColors } from "./clubArtColors";
import { tintedArt } from "./tint";

/**
 * Art `key` in the club's colours (c-27 §4.2): its plain base first, then the painted one in the
 * same frame once it is made, so nothing jumps. Painting that fails leaves the base.
 */
export function useClubArt(
  key: ArtKey | null,
  profile: ClubProfileView | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const colours = profile ? clubArtColors(profile) : null;
  const c1 = colours?.c1;
  const c2 = colours?.c2;

  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    let live = true;
    artUrls(key)
      .then((urls) => {
        if (live) setUrl(urls.base);
        return c1 && c2 ? tintedArt(key, c1, c2) : null;
      })
      .then((painted) => {
        if (live && painted) setUrl(painted);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, c1, c2]);
  return url;
}

/** A facility's picture in the coach's club colours; decorative, as its card names it. */
export function ClubArt({
  art,
  className,
  dimmed = false,
}: {
  art: ArtKey | null;
  className?: string;
  /** The empty plot of a building not built yet (design: opacity 0.55). */
  dimmed?: boolean;
}) {
  const profile = useOnlineStore((state) => state.club?.club);
  const url = useClubArt(art, profile);
  return (
    <div
      className={`overflow-hidden bg-gray-100 dark:bg-navy-800 ${className ?? ""}`}
      aria-hidden="true"
    >
      {url && (
        <img
          src={url}
          alt=""
          className={`h-full w-full object-contain ${dimmed ? "opacity-55" : ""}`}
          draggable={false}
        />
      )}
    </div>
  );
}
