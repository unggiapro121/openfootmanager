import { useEffect, useState } from "react";

import { getPlayerProjection } from "../services/scoutingService";
import type { PlayerProjection } from "../store/types";

export interface PlayerProjectionState {
  projection: PlayerProjection | null;
  /** The backend's reason when it has none, as a translation key. */
  error: string | null;
}

/**
 * The club's projection of `playerId`, asked again whenever `refreshKey`
 * changes (the date, or who judges the club's players). `null` asks nothing.
 */
export function usePlayerProjection(
  playerId: string | null,
  refreshKey: string,
): PlayerProjectionState {
  const [state, setState] = useState<PlayerProjectionState>({ projection: null, error: null });

  useEffect(() => {
    setState({ projection: null, error: null });
    if (!playerId) {
      return;
    }
    let current = true;
    getPlayerProjection(playerId)
      .then((projection) => {
        if (current) setState({ projection, error: null });
      })
      .catch((error: unknown) => {
        if (current) setState({ projection: null, error: String(error) });
      });
    return () => {
      current = false;
    };
  }, [playerId, refreshKey]);

  return state;
}
