import { useTranslation } from "react-i18next";

import ContextMenu from "../ContextMenu";
import {
  buildViewProfileMenuItem,
  buildViewTeamMenuItem,
} from "../playerActions/playerContextMenuItems";
import { Card, CardHeader, CardBody } from "../ui";
import type { LeaderEntryData } from "../../services/competitionsService";

interface TournamentsLeaderboardProps {
  title: string;
  emptyText: string;
  entries: LeaderEntryData[];
  /** Prefix for each row's test id, followed by the player id. */
  testIdPrefix: string;
  onSelectTeam: (id: string) => void;
  onSelectPlayer?: (id: string) => void;
}

/** One ranked board of a competition: scorers, assists or cards. */
export default function TournamentsLeaderboard({
  title,
  emptyText,
  entries,
  testIdPrefix,
  onSelectTeam,
  onSelectPlayer,
}: TournamentsLeaderboardProps) {
  const { t } = useTranslation();

  const menuItems = (playerId: string, teamId: string | null) => {
    const items = [];

    if (typeof onSelectPlayer === "function") {
      items.push(buildViewProfileMenuItem(t, () => onSelectPlayer(playerId)));
    }

    if (teamId) {
      items.push(buildViewTeamMenuItem(t, () => onSelectTeam(teamId)));
    }

    return items;
  };

  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <CardBody className="p-0">
        {entries.length === 0 ? (
          <p className="p-4 text-sm text-gray-400 dark:text-gray-500 text-center">{emptyText}</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-navy-600">
            {entries.map((entry, i) => (
              <ContextMenu items={menuItems(entry.playerId, entry.teamId)} key={entry.playerId}>
                <div
                  className="flex items-center px-4 py-2.5 gap-3"
                  data-testid={`${testIdPrefix}-${entry.playerId}`}
                >
                  <span className="font-heading font-bold text-sm text-gray-400 dark:text-gray-500 w-5 text-center">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                      {entry.fullName}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {entry.teamName ?? entry.teamId ?? ""}
                    </p>
                  </div>
                  <span className="font-heading font-bold text-lg text-accent-500 dark:text-accent-400 tabular-nums">
                    {entry.value}
                  </span>
                </div>
              </ContextMenu>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
