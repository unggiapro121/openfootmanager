import type { TFunction } from "i18next";
import { useState } from "react";
import type { FacilitiesView } from "../../api";
import { OnlineApiError } from "../../errors";
import { refreshFinance, setFacilities, tracked } from "../../store/onlineStore";
import { resolveBackendError } from "../../../utils/backendI18n";
import { useActionKey } from "../useActionKey";

/**
 * One facility write from a dialog (c-27 §5.5, C27-12): sent with a key kept for a retry after no
 * answer came back (so a second press never pays twice), the view it answers put in the store,
 * the club's money read again.
 */
export function useFacilityWrite(send: (idempotencyKey: string) => Promise<FacilitiesView>) {
  const action = useActionKey();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<unknown>(null);

  /** `payload` names what is sent besides the route (a speed-up's count): another is a new action. */
  const run = async (payload = ""): Promise<FacilitiesView | null> => {
    setSending(true);
    setRefusal(null);
    try {
      const view = await action.run((key) => tracked(() => send(key)), payload);
      setFacilities(view);
      void refreshFinance().catch(() => undefined);
      return view;
    } catch (error) {
      setRefusal(error);
      return null;
    } finally {
      setSending(false);
    }
  };
  return { run, sending, refusal };
}

/** Codes whose own sentence is the dialog's (T3): the server's words for them already fit. */
const OWN_SENTENCE = new Set([
  "be.error.economy.insufficientFunds",
  "be.error.economy.facilityLevelLocked",
  "be.error.economy.facilityBuilderBusy",
  "be.error.economy.facilityNotBuilding",
  "be.error.economy.facilityAtBottom",
  "be.error.economy.facilityAtTop",
  "be.error.economy.facilityWrongRoute",
  "be.error.economy.disabled",
  "be.error.economy.clubLocked",
]);

/**
 * A refused write in one line (c-27 §5.5, T3): the server's sentence for the codes a dialog
 * expects, short of time skips, a downgrade inside a lineup lock (R27-2), no answer at all, and
 * one general sentence for anything else.
 */
export function refusalText(t: TFunction, refusal: unknown): string {
  if (!(refusal instanceof OnlineApiError)) return t("online.facilities.error.generic");
  if (refusal.status === 0) return t("online.facilities.error.network");
  if (refusal.code === "be.error.inventory.itemNotFound") {
    return t("online.facilities.error.noTimeSkips");
  }
  if (refusal.code === "be.error.club.lineupLocked") {
    return t("online.facilities.downgradeOff.lineupLocked");
  }
  if (OWN_SENTENCE.has(refusal.code)) return resolveBackendError(refusal);
  return t("online.facilities.error.generic");
}
