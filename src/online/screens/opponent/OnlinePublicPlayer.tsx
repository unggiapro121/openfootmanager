import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import { Card, CardBody, CardHeader, CountryFlag } from "../../../components/ui";
import { countryName } from "../../../lib/countries";
import type { PublicPlayerPageView } from "../../api";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import PlayerPerformanceCards from "../squad/PlayerPerformanceCards";
import { AbsencesBlock } from "./OpponentBlocks";
import { LINK } from "./PlayerLink";

/**
 * Any player's page, read-only (C-23a §6.5, S-46a): who he is, where he plays, whether he is out,
 * and his season with its ranks and last matches. Nothing his own coach alone may see: no
 * attributes, condition, potential, wage or action.
 */
export default function OnlinePublicPlayer() {
  const { playerId = "" } = useParams();
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.players.byId(playerId)),
    [playerId],
  );
  return (
    <ResourceState resource={resource} reload={reload}>
      {(player) => <PublicPlayer player={player} />}
    </ResourceState>
  );
}

function PublicPlayer({ player }: { player: PublicPlayerPageView }) {
  const { t, i18n } = useTranslation();
  const absencesId = useId();
  return (
    <div className="space-y-6">
      <Card accent="primary">
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="font-heading text-4xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {player.ovr}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-heading text-2xl font-bold uppercase tracking-wide text-gray-900 dark:text-gray-100">
              {player.fullName}
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-semibold">
                {translatePositionAbbreviation(t, player.naturalPosition || player.position)}
              </span>
              <span>
                {t("common.age")} {player.age}
              </span>
              <span>
                <CountryFlag
                  code={player.nationality}
                  locale={i18n.language}
                  className="mr-1 text-sm leading-none"
                />
                {countryName(player.nationality, i18n.language)}
              </span>
              {player.shirtNumber !== undefined && (
                <span>{t("online.publicPlayer.shirt", { number: player.shirtNumber })}</span>
              )}
              {player.club ? (
                <Link to={`/online/clubs/${player.club.id}`} className={LINK}>
                  {player.club.name}
                </Link>
              ) : (
                <span>{t("online.publicPlayer.freeAgent")}</span>
              )}
            </p>
          </div>
        </CardBody>
      </Card>
      <section aria-labelledby={absencesId}>
        <Card>
          <CardHeader>
            <span id={absencesId}>{t("online.opponent.absences")}</span>
          </CardHeader>
          <CardBody>
            <AbsencesBlock absences={player.absence} named={false} />
          </CardBody>
        </Card>
      </section>
      <PlayerPerformanceCards player={{ id: player.id, season: player.season }} />
    </div>
  );
}
