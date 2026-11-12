import { invoke } from "./transport";

/** The day an account asked to be deleted goes, unless cancelled at login before (ISO UTC). */
export interface AccountDeletion {
  deleteAt: string;
}

/**
 * Ask for the playing account to be deleted, confirmed with its password (M3c1). It goes through
 * the session, not the online proxy, because the session must forget the token it keeps. A retry
 * after no answer passes the same `idempotencyKey`, and the session sends the same token with it.
 * A refusal rejects with the backend key (`be.error.coach.offline` when no answer came).
 */
export async function requestAccountDeletion(
  password: string,
  idempotencyKey: string,
): Promise<AccountDeletion> {
  return invoke<AccountDeletion>("request_coach_account_deletion", { password, idempotencyKey });
}
