import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { translatePositionAbbreviation } from "../../components/squad/SquadTab.helpers";
import { Card, CardBody, CardHeader } from "../../components/ui";
import type { PublicClubView } from "../api";
import { online } from "../client";
import { tracked } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import ClubCrestMark from "./ClubCrestMark";
import ResourceState from "./ResourceState";
import { sortSquad } from "./OnlineSquad";

/**
 * A club's public page (C-2 §3.5, S-7 §3.11): where it plays, who runs it, its shape and its
 * players' name, age, position and OVR. Nothing more is public: no potential, condition or
 * tactics.
 */
export default function OnlinePublicClub() {
  const { clubId = "" } = useParams();
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.clubs.byId(clubId)),
    [clubId],
  );
  return (
    <ResourceState resource={resource} reload={reload}>
      {(club) => <PublicClub club={club} />}
    </ResourceState>
  );
}

function PublicClub({ club }: { club: PublicClubView }) {
  const { t } = useTranslation();
  const profile = club.club;
  const players = sortSquad(club.players);

  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Card accent="primary">
        <CardHeader>
          <span className="flex items-center gap-3">
            <span className="h-12 w-12 shrink-0">
              <ClubCrestMark profile={profile} />
            </span>
            {profile.name}
          </span>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <p>
            {profile.city} · {t(`coach.regions.${profile.region}`)}
          </p>
          <p>
            {t("online.club.stadium", {
              name: profile.stadiumName,
              capacity: profile.stadiumCapacity,
            })}
          </p>
          <p>{t("online.publicClub.formation", { formation: club.formation })}</p>
          <p>
            {club.coach
              ? t("online.publicClub.coach", { name: club.coach.fullName })
              : t("online.publicClub.botCoach")}
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader>{t("online.squad.title", { players: players.length })}</CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-navy-600 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-4 py-2">
                  {t("common.name")}
                </th>
                <th scope="col" className="px-2 py-2">
                  {t("common.position")}
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("common.age")}
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("common.ovr")}
                </th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id} className="border-b border-gray-100 dark:border-navy-600">
                  <td className="px-4 py-2 font-semibold text-gray-900 dark:text-gray-100">
                    {player.fullName}
                  </td>
                  <td className="px-2 py-2">
                    {translatePositionAbbreviation(t, player.naturalPosition)}
                  </td>
                  <td className="px-2 py-2 text-right">{player.age}</td>
                  <td className="px-2 py-2 text-right font-heading font-bold">{player.ovr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
