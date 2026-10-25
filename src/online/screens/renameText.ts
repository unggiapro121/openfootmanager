import type { TFunction } from "i18next";
import { resolveBackendError } from "../../utils/backendI18n";
import { OnlineApiError } from "../errors";

const ITEM_REQUIRED = "be.error.rename.itemRequired";

/**
 * A failed rename as the player reads it (S-14). A second rename needs a card the server names by
 * its code (`clubRename`, `playerRename`): the card is spelled out here rather than shown as a
 * bare code inside the shared message.
 */
export function renameErrorText(t: TFunction, error: unknown): string {
  if (error instanceof OnlineApiError && error.code === ITEM_REQUIRED) {
    const item = error.params.item;
    if (item === "playerRename" || item === "clubRename") {
      return t(`online.rename.itemRequired.${item}`);
    }
  }
  return resolveBackendError(error);
}
