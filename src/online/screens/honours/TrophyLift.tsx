import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";
import type { TrophyView } from "../../api";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { latestTitle } from "./honoursView";
import { TrophyIcon } from "./TrophyIcon";

/** The titles whose trophy-lift the coach has seen, on this device (C20-8). */
export const SEEN_KEY = "ofm.online.honours.liftSeen";

function seenTitles(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Remember the title as seen; a device that keeps nothing shows it again next time. */
function markSeen(id: string): boolean {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seenTitles(), id].slice(-20)));
    return true;
  } catch {
    return false;
  }
}

/**
 * The trophy-lift screen (Dtr-6, C20-8): once per title, the newest league title won under the
 * coach, with the way to the trophy room. Nothing shows when the server cannot say.
 */
export default function TrophyLift() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [title, setTitle] = useState<TrophyView>();

  useEffect(() => {
    let live = true;
    tracked(() => online.me.honours())
      .then((view) => {
        const latest = latestTitle(view.trophies);
        if (live && latest && !seenTitles().includes(latest.id)) setTitle(latest);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!title) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        markSeen(title.id);
        setTitle(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [title]);

  if (!title) return null;
  const close = (then?: () => void) => {
    markSeen(title.id);
    setTitle(undefined);
    then?.();
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trophy-lift-title"
        className="flex flex-col items-center gap-4 text-center"
      >
        <TrophyIcon level={title.place.level} className="h-24 w-24 motion-safe:animate-bounce" />
        <h3
          id="trophy-lift-title"
          className="font-heading text-2xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("online.honours.lift.title")}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("online.honours.lift.body", {
            club: title.club.name,
            level: title.place.level,
            season: title.place.seasonNumber,
          })}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => close()}>
            {t("online.honours.lift.close")}
          </Button>
          <Button type="button" size="sm" onClick={() => close(() => navigate("/online/honours"))}>
            {t("online.honours.open")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
