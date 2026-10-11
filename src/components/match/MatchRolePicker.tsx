import { useTranslation } from "react-i18next";

import { getRoleOptions } from "../../lib/playerRoles";
import type { PlayerRole } from "../../store/types";
import { Select } from "../ui";

interface MatchRolePickerProps {
  /** The position he plays now — the roles offered follow the slot. */
  position: string;
  role: string | null | undefined;
  onChange: (role: PlayerRole) => void;
  selectSize?: "xs" | "sm";
}

/**
 * The role picker of a match screen: on a pitch token or in a lineup row. Stops
 * clicks and drags from reaching the token or row it sits in.
 */
export function MatchRolePicker({
  position,
  role,
  onChange,
  selectSize = "sm",
}: MatchRolePickerProps) {
  const { t } = useTranslation();
  const current = role ?? "Standard";
  return (
    <div
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="w-full"
    >
      <Select
        selectSize={selectSize}
        variant="ghost"
        fullWidth
        aria-label={t("tactics.playerRoleLabel")}
        value={current}
        onChange={(e) => onChange(e.target.value as PlayerRole)}
      >
        {getRoleOptions(position, current).map((option) => (
          <option key={option} value={option}>
            {t(`tactics.playerRoles.${option}`, option)}
          </option>
        ))}
      </Select>
    </div>
  );
}
