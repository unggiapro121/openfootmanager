import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchTeamsDirectory, type TeamsDirectory } from "../../services/teamsService";
import { buildDirectoryTree, type DirectoryRegion } from "./TeamsListTab.helpers";

/**
 * The club directory as region → country → league → clubs, for pickers that
 * narrow by competition. Loaded once per mount. It only feeds pickers, so a
 * failed fetch leaves an empty tree — the pickers keep just their "all" option —
 * rather than blocking the screen.
 */
export function useDirectoryTree(): DirectoryRegion[] {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState<TeamsDirectory | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchTeamsDirectory({ search: null })
      .then((result) => {
        if (!cancelled) setDirectory(result);
      })
      .catch(() => {
        if (!cancelled) setDirectory(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return useMemo(
    () => (directory?.regions ? buildDirectoryTree(directory, t) : []),
    [directory, t],
  );
}
