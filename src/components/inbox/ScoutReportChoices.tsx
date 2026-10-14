import { useTranslation } from "react-i18next";

import type { MessageAction } from "../../store/gameStore";
import { Button } from "../ui";
import { isChooseOptionAction } from "./inboxHelpers";

interface ScoutReportChoicesProps {
  /** The choice on one scouted player: sign, watch, discard — whichever the report offers. */
  action: MessageAction | undefined;
  onChoose: (actionId: string, optionId: string) => void;
}

/**
 * The buttons under a scouted player's card, one per option, or a note once
 * the manager has chosen. Youth and player scout reports both use it, so Watch
 * looks and behaves the same in either.
 */
export default function ScoutReportChoices({ action, onChoose }: ScoutReportChoicesProps) {
  const { t } = useTranslation();

  if (!action) return null;
  if (action.resolved) {
    return (
      <div className="mt-3 text-xs font-heading font-bold uppercase tracking-wider text-primary-500">
        {t("inbox.responded")}
      </div>
    );
  }
  if (!isChooseOptionAction(action.action_type)) return null;
  const options = action.action_type.ChooseOption.options;
  if (options.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={option.id === "discard" ? "outline" : "primary"}
          onClick={() => onChoose(action.id, option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
