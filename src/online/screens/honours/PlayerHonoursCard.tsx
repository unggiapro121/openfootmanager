import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { AwardList } from "./HonoursSections";

/** A player's awards and champion's medals (C20-6), hidden while he has none. */
export default function PlayerHonoursCard({ playerId }: { playerId: string }) {
  const { t } = useTranslation();
  const { resource } = useOnlineResource(
    () => tracked(() => online.players.honours(playerId)),
    [playerId],
  );
  if (resource.status !== "ready" || resource.data.honours.length === 0) return null;
  return (
    <Card>
      <CardHeader>{t("online.honours.playerTitle")}</CardHeader>
      <CardBody>
        <AwardList awards={resource.data.honours} showClub />
      </CardBody>
    </Card>
  );
}
