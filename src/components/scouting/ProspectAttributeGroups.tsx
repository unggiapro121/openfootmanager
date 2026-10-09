import { useTranslation } from "react-i18next";

import { getAttributeColors } from "../../lib/playerAttributeDisplay";
import type { AttributeRead } from "../../store/types";
import { buildReadAttributeGroups } from "../playerProfile/PlayerProfile.attributes";
import { getAttributeColorClass } from "../playerProfile/PlayerProfile.helpers";
import { placeholderWidth } from "../playerProfile/PlayerProfileAttributesCard";
import { ProgressBar } from "../ui";

interface ProspectAttributeGroupsProps {
  reads: AttributeRead[];
  isKeeper: boolean;
}

/**
 * Every attribute of a youth prospect in the profile's groups: the scout's
 * figure for those he has read, "??" for the rest. An unread bar's width comes
 * from the attribute's name, never its value, so it gives nothing away.
 */
export default function ProspectAttributeGroups({ reads, isKeeper }: ProspectAttributeGroupsProps) {
  const { t } = useTranslation();
  const groups = buildReadAttributeGroups(reads, isKeeper, t);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((group) => (
        <div key={group.label}>
          <h5 className="mb-2 border-b border-gray-200 pb-1 text-xs font-heading font-bold uppercase tracking-wider text-gray-600 dark:border-navy-600 dark:text-gray-300">
            {group.label}
          </h5>
          <div className="space-y-1.5">
            {group.attrs.map((attr) => (
              <div
                key={attr.key}
                data-testid={`prospect-attr-${attr.key}`}
                className="grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-2 text-xs"
              >
                <span className="truncate text-gray-600 dark:text-gray-300">{attr.name}</span>
                {attr.value === null ? (
                  <>
                    <ProgressBar value={placeholderWidth(attr.name)} variant="muted" size="sm" />
                    <span className="text-right font-heading font-bold text-gray-400">??</span>
                  </>
                ) : (
                  <>
                    <ProgressBar
                      value={attr.value}
                      variant={getAttributeColors(attr.value).barVariant}
                      size="sm"
                    />
                    <span
                      className={`text-right font-heading font-bold tabular-nums ${getAttributeColorClass(attr.value)}`}
                    >
                      {attr.value}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
