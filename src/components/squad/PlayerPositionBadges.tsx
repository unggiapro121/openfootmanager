import { useTranslation } from "react-i18next";

import { positionBadgeVariant } from "../../lib/helpers";
import { Badge } from "../ui";
import { translatePositionAbbreviation, translatePositionLabel } from "./SquadTab.helpers";

interface PlayerPositionBadgesProps {
  /** The player's natural position, coloured by its line. */
  primaryPosition: string;
  /** Positions he can cover without being a natural there, shown in neutral grey. */
  alternatePositions?: string[];
}

/**
 * A player's positions as abbreviated badges (AM, CM, LM). Full names stay one
 * hover away; spelled out, two of them wrapped onto three lines in a header.
 * Renders a fragment so the badges flow inside the caller's own flex row.
 */
export function PlayerPositionBadges({
  primaryPosition,
  alternatePositions = [],
}: PlayerPositionBadgesProps) {
  const { t } = useTranslation();
  const positions = [
    { position: primaryPosition, isNatural: true },
    ...alternatePositions
      .filter((position) => position !== primaryPosition)
      .map((position) => ({ position, isNatural: false })),
  ];

  return (
    <>
      {positions.map(({ position, isNatural }) => (
        <Badge key={position} variant={isNatural ? positionBadgeVariant(position) : "neutral"}>
          <abbr title={translatePositionLabel(t, position)} className="no-underline">
            {translatePositionAbbreviation(t, position)}
          </abbr>
        </Badge>
      ))}
    </>
  );
}
