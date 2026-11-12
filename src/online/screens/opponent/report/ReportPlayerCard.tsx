import { useTranslation } from "react-i18next";
import PlayerProfileAttributesCard from "../../../../components/playerProfile/PlayerProfileAttributesCard";
import {
  buildPlayerAttributeGroups,
  isGoalkeeper,
} from "../../../../components/playerProfile/PlayerProfile.attributes";
import { translatePositionAbbreviation } from "../../../../components/squad/SquadTab.helpers";
import { CountryFlag } from "../../../../components/ui";
import type { ReportPlayer } from "../../../api";
import PositionRatingChips from "../../PositionRatingChips";
import { BAND_DOT, bandKey, naturalOvr } from "./reportParts";

/**
 * One man of a report (C-24 C24-4): where he comes from, his own position and age, the slot the
 * report put him in with his OVR there and his band, his OVR by position as the market shows it,
 * and his attributes as the player profile draws them. No potential, trait, morale or condition
 * figure: the report has none of them.
 */
export default function ReportPlayerCard({ player }: { player: ReportPlayer }) {
  const { t, i18n } = useTranslation();
  const profile = {
    attributes: player.attributes,
    natural_position: player.naturalPosition,
    position: player.naturalPosition,
  };
  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        <p className="flex flex-wrap items-center gap-2">
          <CountryFlag code={player.nationality} locale={i18n.language} />
          {translatePositionAbbreviation(t, player.naturalPosition)} · {t("common.age")}{" "}
          {player.age}
          {player.shirtNumber !== undefined && (
            <> · {t("online.opponentReport.shirt", { number: player.shirtNumber })}</>
          )}
        </p>
        {player.slotPosition && player.slotOvr !== undefined && (
          <p>
            {t("online.opponentReport.inSlot", {
              position: translatePositionAbbreviation(t, player.slotPosition),
              ovr: player.slotOvr,
            })}
          </p>
        )}
        <p className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${BAND_DOT[player.conditionBand]}`}
          />
          {t("online.opponentReport.bandLine", { band: t(bandKey(player.conditionBand)) })}
        </p>
        <PositionRatingChips ratings={player.positionRatings} />
      </div>
      <PlayerProfileAttributesCard
        attrGroups={buildPlayerAttributeGroups(profile, t)}
        player={profile}
        isOwnClub
        isGk={isGoalkeeper(profile)}
        title={t("playerProfile.attributes")}
        ovr={naturalOvr(player)}
        ovrLabel={t("common.ovr")}
        averageLabel={t("common.average")}
        hiddenTitle={t("playerProfile.attributesHidden")}
        hiddenBody={t("playerProfile.scoutToView")}
        listLabel={t("common.listView")}
        radarLabel={t("common.radarView")}
      />
    </div>
  );
}
