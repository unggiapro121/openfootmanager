import { AlertTriangle } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ProgressBar } from "../../components/ui";
import type { CareerCapsView } from "../api";
import { formatTenths } from "../format";
import { useOnlineStore } from "../store/onlineStore";

/** A full squad: under it, empty places count in the buying strength but not in the squad's. */
const FULL_SQUAD = 18;

/**
 * The coach's level caps on his profile (C-7 C7-12): the highest OVR he may buy, and two
 * strengths, each on a bar of its own against its own mark, as they measure two things. The
 * buying strength is what a purchase may not take past the team cap; the squad strength (top 18)
 * is what forces him up at the season's end. A squad under 18 is warned before the season ends:
 * it can be forced up though it never bought past the caps (Qs16-8). Every number is the server's.
 */
export default function LevelCaps({ caps }: { caps: CareerCapsView }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const players = useOnlineStore((state) => state.club?.players.length);
  const squadSize = caps.squadSize ?? players;
  const short = squadSize !== undefined && squadSize < FULL_SQUAD;
  const strength = (tenths: number | undefined) =>
    tenths === undefined ? "–" : formatTenths(tenths, i18n.language);
  const over = caps.strengthTop18 !== undefined && caps.strengthTop18 > caps.forcedThreshold;

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-navy-600"
    >
      <h3 id={titleId} className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
        {t("online.roadmap.caps.title")}
      </h3>
      <p>
        {caps.playerCap === undefined
          ? t("online.roadmap.caps.noPlayerCap")
          : t("online.roadmap.caps.playerCap", { cap: caps.playerCap })}
      </p>
      <StrengthBar
        line={t("online.roadmap.caps.buyLine", {
          value: strength(caps.buyStrength),
          cap: strength(caps.squadBuyCap),
        })}
        use={t("online.roadmap.caps.buyUse")}
        tenths={caps.buyStrength}
        mark={caps.squadBuyCap}
        over={false}
      />
      {short && (
        <p
          role="note"
          className="flex items-start gap-2 rounded bg-accent-50 px-3 py-2 text-xs text-gray-800 dark:bg-accent-500/10 dark:text-gray-200"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-accent-700 dark:text-accent-400"
            aria-hidden
          />
          <span>
            {t("online.roadmap.shortSquad", { players: squadSize, empty: caps.emptySlotOvr })}
          </span>
        </p>
      )}
      <StrengthBar
        line={t("online.roadmap.caps.teamLine", {
          value: strength(caps.strengthTop18),
          threshold: strength(caps.forcedThreshold),
        })}
        use={t("online.roadmap.caps.teamUse", { jump: caps.maxForcedJump })}
        tenths={caps.strengthTop18}
        mark={caps.forcedThreshold}
        over={over}
      />
      {over && (
        <p className="text-xs font-semibold text-red-700 dark:text-red-400">
          {t("online.roadmap.caps.over", { jump: caps.maxForcedJump })}
        </p>
      )}
      {!short && <p className="text-xs">{t("online.roadmap.caps.fullSquad")}</p>}
    </section>
  );
}

/** One strength against its mark: the line with both numbers, a bar, and what the mark does. */
function StrengthBar({
  line,
  use,
  tenths,
  mark,
  over,
}: {
  line: string;
  use: string;
  tenths: number | undefined;
  mark: number;
  over: boolean;
}) {
  const share = tenths === undefined || mark <= 0 ? 0 : Math.round((tenths / mark) * 100);
  return (
    <div className="space-y-1">
      <p className={over ? "font-semibold text-red-700 dark:text-red-400" : ""}>{line}</p>
      <div
        role="progressbar"
        aria-label={line}
        aria-valuemin={0}
        aria-valuemax={mark / 10}
        aria-valuenow={tenths === undefined ? undefined : tenths / 10}
      >
        <ProgressBar value={share} variant={over ? "danger" : "primary"} size="sm" />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{use}</p>
    </div>
  );
}
