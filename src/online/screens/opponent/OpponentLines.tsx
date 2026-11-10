// (e) and (h) of the opponent profile (C-23a §6.4, §6.6): the two sides' strength line by line,
// and once the match is built, both locked line-ups.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui";
import type { MyClubView, ProjectedPlayer, ProjectedSide } from "../../api";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { MUTED, SideLineup, splitSide } from "./OpponentBlocks";
import { formatGap, formatTenth, type Line, lineStrength } from "./opponentView";
import { LINK } from "./PlayerLink";

const LINES: Line[] = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const DASH = "–";

type Player = { position: string; ovr: number };

/** The coach's own eleven as the line-up he will play: the one saved, or the XI assistant's. */
export function myEleven(club: MyClubView | null): Player[] {
  if (!club) return [];
  const byId = new Map(club.players.map((player) => [player.id, player]));
  return club.setup.startingXiIds.flatMap((id) => {
    const player = byId.get(id);
    return player ? [{ position: player.naturalPosition || player.position, ovr: player.ovr }] : [];
  });
}

/** The players a side has on the pitch, at the OVR they play at. */
export function onPitch(players: readonly ProjectedPlayer[]): Player[] {
  return splitSide(players).eleven;
}

/**
 * Each line's mean OVR for the opponent and for the coach, and how far the coach is ahead (+) or
 * behind (−). No total, no top 18, nothing about level caps (hidden rules).
 */
export function LinesTable({
  theirs,
  mine,
  theirLabel,
  myLabel,
}: {
  theirs: readonly Player[];
  mine: readonly Player[];
  theirLabel: string;
  myLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const them = lineStrength(theirs);
  const us = lineStrength(mine);
  const shown = LINES.filter((line) => them[line] !== undefined || us[line] !== undefined);
  const figure = (value: number | undefined) =>
    value === undefined ? DASH : formatTenth(value, i18n.language);
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
        <tr>
          <th scope="col" className="py-1 text-left font-semibold">
            <span className="sr-only">{t("online.opponent.line")}</span>
          </th>
          <th scope="col" className="py-1 text-right font-semibold">
            {theirLabel}
          </th>
          <th scope="col" className="py-1 text-right font-semibold">
            {myLabel}
          </th>
          <th scope="col" className="py-1 text-right font-semibold">
            {t("online.opponent.gap")}
          </th>
        </tr>
      </thead>
      <tbody>
        {shown.map((line) => {
          const theirMean = them[line];
          const myMean = us[line];
          const gap =
            theirMean === undefined || myMean === undefined
              ? DASH
              : formatGap(myMean - theirMean, i18n.language);
          return (
            <tr key={line} className="border-t border-gray-100 dark:border-navy-600">
              <th
                scope="row"
                className="py-1.5 text-left font-semibold text-gray-800 dark:text-gray-100"
              >
                {t(`common.positionGroups.${line}`)}
              </th>
              <td className="py-1.5 text-right tabular-nums">{figure(theirMean)}</td>
              <td className="py-1.5 text-right tabular-nums">{figure(myMean)}</td>
              <td className="py-1.5 text-right font-heading font-bold tabular-nums">{gap}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** (e) Their last eleven against the coach's, line by line. */
export function LinesBlock({
  lineup,
  theirName,
  club,
}: {
  lineup: ProjectedSide | undefined;
  theirName: string;
  club: MyClubView | null;
}) {
  const { t } = useTranslation();
  if (!lineup) return <p className={MUTED}>{t("online.opponent.noLines")}</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.opponent.linesHint")}</p>
      <LinesTable
        theirs={onPitch(lineup.players)}
        mine={myEleven(club)}
        theirLabel={theirName}
        myLabel={t("online.opponent.us")}
      />
    </div>
  );
}

/**
 * (h) The two line-ups as the match was built with them, locked: from the build until the final
 * whistle of a live match (Q-OS10). The coach's side is the one at his end of the fixture.
 */
export function KickoffBlock({
  matchId,
  myClubIsHome,
  pitch,
}: {
  matchId: string;
  myClubIsHome: boolean;
  pitch: boolean;
}) {
  const { t } = useTranslation();
  const { resource } = useOnlineResource(
    () => tracked(() => online.matches.byId(matchId)),
    [matchId],
  );
  if (resource.status !== "ready") {
    return resource.status === "loading" ? <p className={MUTED}>{t("online.loading")}</p> : null;
  }
  const match = resource.data;
  const mine = myClubIsHome ? match.home : match.away;
  const theirs = myClubIsHome ? match.away : match.home;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="primary" size="sm">
          {t("online.opponent.locked")}
        </Badge>
        {match.status === "live" && (
          <Link to={`/online/match/${matchId}`} className={LINK}>
            {t("online.fixture.enterMatch")}
          </Link>
        )}
      </div>
      <LinesTable
        theirs={onPitch(theirs.players)}
        mine={onPitch(mine.players)}
        theirLabel={theirs.name}
        myLabel={t("online.opponent.us")}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {[theirs, mine].map((side) => (
          <div key={side.name}>
            <p className="mb-1 font-heading text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-gray-100">
              {side.name}
            </p>
            <SideLineup players={side.players} formation={side.formation} pitch={pitch} />
          </div>
        ))}
      </div>
    </div>
  );
}
