import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { EventView, MissionView, RewardView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { refreshCoins, refreshEvents, refreshItems, tracked } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import { claimErrorText } from "./eventText";

const ALREADY_CLAIMED = "be.error.events.alreadyClaimed";
/** Codes after which the mission may have moved on the server: the events are read again. */
const READ_AGAIN = new Set([
  "be.error.events.notCompleted",
  "be.error.events.notFound",
  "be.error.events.disabled",
  "be.error.events.closed",
]);

const ignore = () => undefined;

/**
 * The claim (C-7 C7-54): no confirmation, as it spends nothing; one key a mission, kept over a
 * request that got no answer. After it the events are read again, and the items and coins it gave,
 * since giving an item rings nothing (C-7 §19.1). A failure is said through `onError`, `null`
 * clearing it as a new try starts.
 */
export function useMissionClaim({
  event,
  mission,
  onClaimed,
  onError,
}: {
  event: EventView;
  mission: MissionView;
  onClaimed: (rewards: RewardView[]) => void;
  onError: (text: string | null) => void;
}): { claim: () => Promise<void>; busy: boolean } {
  const { t, i18n } = useTranslation();
  const { run } = useActionKey();
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    setBusy(true);
    onError(null);
    try {
      const given = await run((key) =>
        tracked(() => online.events.claim(event.id, mission.code, key)),
      );
      onClaimed(given.rewards);
      if (given.rewards.some((reward) => reward.item !== undefined)) {
        void refreshItems().catch(ignore);
      }
      if (given.rewards.some((reward) => reward.coin !== undefined)) {
        void refreshCoins().catch(ignore);
      }
      void refreshEvents().catch(ignore);
    } catch (error) {
      const code = error instanceof OnlineApiError ? error.code : "";
      // Another device claimed it: the page catches up, with nothing to say.
      if (code !== ALREADY_CLAIMED) onError(claimErrorText(t, i18n.language, error));
      if (code === ALREADY_CLAIMED || READ_AGAIN.has(code)) void refreshEvents().catch(ignore);
    } finally {
      setBusy(false);
    }
  };

  return { claim, busy };
}
