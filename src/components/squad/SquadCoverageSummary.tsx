import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

import { Badge } from "../ui";
import { type SquadRoleCoverage, translatePositionAbbreviation } from "./SquadTab.helpers";

interface SquadCoverageSummaryProps {
  roleCoverage: SquadRoleCoverage[];
}

/**
 * Role coverage as one line: the verdict, with each role's starters and bench
 * folded away until asked for. The full list ran to two rows of badges over the
 * roster; the verdict already says how many roles are short.
 */
export default function SquadCoverageSummary({ roleCoverage }: SquadCoverageSummaryProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const thinCoverageCount = roleCoverage.filter((coverage) => coverage.status !== "covered").length;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-fit items-center gap-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
      >
        <span className="text-xs font-heading font-bold uppercase tracking-wider text-gray-300">
          {t("squad.coverageTitle")}
        </span>
        <Badge variant={thinCoverageCount > 0 ? "danger" : "success"} size="sm">
          {thinCoverageCount > 0
            ? t("squad.coverageNeedsAttention", { count: thinCoverageCount })
            : t("squad.coverageStable")}
        </Badge>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 text-gray-400 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        <div id={detailId} className="flex flex-wrap gap-2">
          {roleCoverage.map((coverage) => (
            <Badge
              key={coverage.role}
              variant={
                coverage.status === "covered"
                  ? "success"
                  : coverage.status === "thin"
                    ? "accent"
                    : "danger"
              }
              size="sm"
              className="gap-1"
            >
              <span>{translatePositionAbbreviation(t, coverage.role)}</span>
              <span>
                {t("squad.coverageBadge", {
                  starters: coverage.naturalStarters,
                  required: coverage.requiredSlots,
                  bench: coverage.benchOptions,
                })}
              </span>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
